import { BALL_RADIUS as R, FOOT_SPOT_X, HEAD_SPOT_X, POCKETS } from '../config/table';
import { Ball } from '../physics/Ball';
import { World } from '../physics/World';
import type { Shot } from '../physics/cueStrike';
import {
  type BallInHand,
  groupOf,
  judge,
  legalTargets,
  type RulesOptions,
  type RulesState,
} from '../rules/EightBallRules';
import { ShotRecorder } from '../rules/ShotResult';
import { isLegalPlacement } from '../game/placement';
import { mulberry32 } from '../game/Rack';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface BallState {
  id: number;
  x: number;
  z: number;
  pocketed: boolean;
}

export interface PlanRequest {
  balls: BallState[];
  rules: RulesState;
  options: RulesOptions;
  inHand: BallInHand;
  difficulty: Difficulty;
  seed: number;
}

export interface Plan {
  shot: Shot;
  /** Where to put the cue ball first, when it's in hand. */
  place?: [number, number];
}

/**
 * Difficulty = how many options it considers and how accurately it executes the chosen one.
 * Variants are [cue-ball speed m/s, top spin].
 */
const LEVELS: Record<
  Difficulty,
  {
    aimNoise: number;
    powerNoise: number;
    candidates: number;
    variants: [number, number][];
    /** Directions tried when nothing is pottable (escapes, kicks); finer finds more legal hits. */
    fan: number;
    /** How many top options are re-checked against execution error (0 = trust the first). */
    robust: number;
  }
> = {
  easy: {
    aimNoise: 0.035,
    powerNoise: 0.15,
    candidates: 4,
    variants: [[2.5, 0]],
    fan: 24,
    robust: 0,
  },
  medium: {
    aimNoise: 0.012,
    powerNoise: 0.08,
    candidates: 10,
    fan: 72,
    robust: 4,
    variants: [
      [1.8, 0],
      [3, 0],
      [3, -0.5],
      [3, 0.5],
    ],
  },
  hard: {
    aimNoise: 0.003,
    powerNoise: 0.03,
    candidates: 16,
    fan: 120,
    robust: 6,
    variants: [
      [1.5, 0],
      [2.5, 0],
      [4, 0],
      [2.5, -0.6],
      [2.5, 0.6],
      [4, -0.6],
    ],
  },
};

const MAX_CUT = Math.cos((75 * Math.PI) / 180);
const SIM_STEPS = 240 * 6; // 6 s of play: enough to judge almost any shot
const BREAK_SPEED = 9;

interface Candidate {
  angle: number;
  ease: number;
}

/** Choose a shot (and a ball-in-hand spot) for the player to move. Pure and deterministic per seed. */
export function plan(req: PlanRequest): Plan {
  const rand = mulberry32(req.seed);
  const level = LEVELS[req.difficulty];
  const noisy = (s: Shot): Shot => ({
    ...s,
    angle: s.angle + gaussian(rand) * level.aimNoise,
    speed: s.speed * Math.max(0.3, 1 + gaussian(rand) * level.powerNoise),
  });

  if (req.rules.isBreak) {
    const place = placeOrFallback(req, [HEAD_SPOT_X, 0]);
    return {
      place,
      shot: noisy({ angle: Math.atan2(-place[1], FOOT_SPOT_X - place[0]), speed: BREAK_SPEED }),
    };
  }

  let balls = req.balls;
  let place: [number, number] | undefined;
  if (req.inHand !== 'none') {
    place = choosePlacement(req, rand);
    balls = withCueAt(balls, place);
  }

  // 1) score options assuming perfect execution: pots first; if none is even legal, a direct hit
  //    on each target; only if that fails too, a fan of directions for kicks/escapes (expensive)
  const r = { ...req, balls };
  const score = (s: Shot) => ({ s, score: scoreShot(r, s) });
  const anyLegal = (l: { score: number }[]) => l.some((x) => x.score > -1000);
  const targets = legalTargets(req.rules);
  const cue = balls.find((b) => b.id === 0)!;
  const scored = potCandidates(balls, targets)
    .slice(0, level.candidates)
    .flatMap((c) => level.variants.map(([speed, top]) => score({ angle: c.angle, speed, top })));
  if (!anyLegal(scored))
    for (const t of balls.filter((b) => targets.includes(b.id) && !b.pocketed))
      for (const speed of [1.5, 3])
        scored.push(score({ angle: Math.atan2(t.z - cue.z, t.x - cue.x), speed }));
  if (!anyLegal(scored))
    for (let i = 0; i < level.fan; i++)
      for (const speed of [2, 4])
        scored.push(score({ angle: (i / level.fan) * 2 * Math.PI, speed }));
  const ranked = scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, level.robust));
  // 2) re-score the best few under this level's own aim/power error and keep the best average,
  //    so it prefers wide-margin shots over ones that only work when hit perfectly
  const { aimNoise: a, powerNoise: p } = level;
  const jitters = [
    [0, 1],
    [a, 1],
    [-a, 1],
    [0, 1 + p],
    [0, 1 - p],
  ];
  let best = ranked[0]!.s;
  let bestAvg = -Infinity;
  for (const { s, score } of ranked) {
    let total = score;
    if (level.robust === 0) break;
    for (const [da, k] of jitters.slice(1))
      total += scoreShot(r, { ...s, angle: s.angle + da!, speed: s.speed * k! });
    if (total / jitters.length > bestAvg) {
      bestAvg = total / jitters.length;
      best = s;
    }
  }
  return { place, shot: noisy(best) };
}

/** Simulate the shot to rest and rate the outcome for the shooter (exported for tests). */
export function scoreShot(req: PlanRequest, shot: Shot): number {
  const me = req.rules.current;
  const world = new World(
    req.balls.map((b) => {
      const n = new Ball(b.id, b.x, b.z);
      if (b.pocketed) n.state = 'pocketed';
      return n;
    }),
  );
  const rec = new ShotRecorder();
  world.on((e) => rec.record(e));
  world.strike(0, shot);
  const targets = legalTargets(req.rules);
  for (let n = 0; n < SIM_STEPS && world.isMoving(); n++) {
    world.step();
    // hitting the wrong ball first is a foul whatever happens next; stop early (most fallback
    // directions end this way). Not for the 8: it could still drop, which loses the game.
    const first = rec.result.firstContact;
    if (first !== null && first !== 8 && !targets.includes(first) && !req.rules.isBreak)
      return -1000;
  }

  const o = judge(req.rules, rec.result, req.options);
  if (o.state.winner !== null) return o.state.winner === me ? 1e5 : -1e5;
  if (o.foul) return -1000;
  if (o.state.current !== me) return -100; // legal miss
  // kept the turn: reward balls potted and how many easy shots the cue ball is left with
  const after = world.balls.map((b) => ({
    id: b.id,
    x: b.x,
    z: b.z,
    pocketed: b.state === 'pocketed',
  }));
  const mine = o.state.groups[me];
  const potted = rec.result.pocketed.filter((n) => mine && groupOf(n) === mine).length;
  const next = potCandidates(after, legalTargets(o.state)).filter((c) => c.ease > 0.5).length;
  return 500 + 100 * potted + 40 * Math.min(next, 5);
}

/** Ghost-ball pots with a clear path, easiest first (straighter and shorter is easier). */
export function potCandidates(balls: BallState[], targets: number[]): Candidate[] {
  const cue = balls.find((b) => b.id === 0)!;
  const live = balls.filter((b) => !b.pocketed);
  const out: Candidate[] = [];
  for (const t of live) {
    if (!targets.includes(t.id)) continue;
    for (const p of POCKETS) {
      const d2 = Math.hypot(p.x - t.x, p.z - t.z);
      const ux = (p.x - t.x) / d2;
      const uz = (p.z - t.z) / d2;
      const gx = t.x - ux * 2 * R;
      const gz = t.z - uz * 2 * R;
      const d1 = Math.hypot(gx - cue.x, gz - cue.z);
      if (d1 < 1e-6) continue;
      const cut = ((gx - cue.x) * ux + (gz - cue.z) * uz) / d1;
      if (cut < MAX_CUT) continue;
      const blocked = live.some(
        (o) =>
          o.id !== t.id &&
          o.id !== 0 &&
          (segDist(cue.x, cue.z, gx, gz, o.x, o.z) < 2 * R ||
            segDist(t.x, t.z, p.x, p.z, o.x, o.z) < 2 * R),
      );
      if (blocked) continue;
      out.push({ angle: Math.atan2(gz - cue.z, gx - cue.x), ease: cut / (1 + d1 + d2) });
    }
  }
  return out.sort((a, b) => b.ease - a.ease);
}

/** Ball in hand: set up a straight pot from ~25 cm behind the ghost ball, else any legal spot. */
function choosePlacement(req: PlanRequest, rand: () => number): [number, number] {
  const live = req.balls.filter((b) => !b.pocketed && b.id !== 0);
  const targets = legalTargets(req.rules);
  let best: [number, number] | null = null;
  let bestEase = -Infinity;
  for (const t of live) {
    if (!targets.includes(t.id)) continue;
    for (const p of POCKETS) {
      const d = Math.hypot(p.x - t.x, p.z - t.z);
      const ux = (p.x - t.x) / d;
      const uz = (p.z - t.z) / d;
      const x = t.x - ux * (2 * R + 0.25);
      const z = t.z - uz * (2 * R + 0.25);
      if (!isLegalPlacement(req.balls, x, z, req.inHand)) continue;
      const balls = withCueAt(req.balls, [x, z]);
      const c = potCandidates(balls, targets).find(
        (c) => Math.abs(c.angle - Math.atan2(uz, ux)) < 1e-6,
      );
      if (c && c.ease > bestEase) {
        bestEase = c.ease;
        best = [x, z];
      }
    }
  }
  return best ?? placeOrFallback(req, [HEAD_SPOT_X, 0], rand);
}

/** The preferred spot if legal, otherwise the first legal random spot (head spot as last resort). */
function placeOrFallback(
  req: PlanRequest,
  preferred: [number, number],
  rand = mulberry32(req.seed),
): [number, number] {
  if (isLegalPlacement(req.balls, ...preferred, req.inHand)) return preferred;
  for (let i = 0; i < 200; i++) {
    const x = (rand() * 2 - 1) * 0.95;
    const z = (rand() * 2 - 1) * 0.47;
    if (isLegalPlacement(req.balls, x, z, req.inHand)) return [x, z];
  }
  return preferred;
}

function withCueAt(balls: BallState[], [x, z]: [number, number]): BallState[] {
  return balls.map((b) => (b.id === 0 ? { ...b, x, z, pocketed: false } : b));
}

/** Distance from point (px, pz) to segment a→b. */
function segDist(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(ax + t * dx - px, az + t * dz - pz);
}

/** Standard normal sample (Box–Muller). */
function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}
