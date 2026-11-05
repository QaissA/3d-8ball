import { expect, test } from 'vitest';
import { type BallState, plan, type PlanRequest, scoreShot } from '../../src/ai/ShotPlanner';
import { DEFAULT_OPTIONS, judge, newGame, type RulesState } from '../../src/rules/EightBallRules';
import { ShotRecorder } from '../../src/rules/ShotResult';
import { Ball } from '../../src/physics/Ball';
import { World } from '../../src/physics/World';
import { HEAD_SPOT_X, POCKETS } from '../../src/config/table';
import { triangleRack } from '../../src/game/Rack';
import { isLegalPlacement } from '../../src/game/placement';

const midGame: RulesState = {
  ...newGame(0),
  isBreak: false,
  groups: ['solids', 'stripes'],
};

const req = (balls: BallState[], o: Partial<PlanRequest> = {}): PlanRequest => ({
  balls,
  rules: midGame,
  options: DEFAULT_OPTIONS,
  inHand: 'none',
  difficulty: 'hard',
  seed: 1,
  ...o,
});

/** Play the plan with the real engine; returns pocketed ids. */
function execute(balls: BallState[], p: ReturnType<typeof plan>): number[] {
  const world = new World(
    balls.map((b) => {
      const n = new Ball(b.id, b.x, b.z);
      if (b.id === 0 && p.place) [n.x, n.z] = p.place;
      else if (b.pocketed) n.state = 'pocketed';
      return n;
    }),
  );
  const potted: number[] = [];
  world.on((e) => e.type === 'pocketed' && potted.push(e.ball));
  world.strike(0, p.shot);
  while (world.isMoving()) world.step();
  return potted;
}

const pocket = POCKETS[0]!; // +x,+z corner

test('pots an easy ball of its own group', () => {
  const balls: BallState[] = [
    { id: 0, x: 0.3, z: 0.1, pocketed: false },
    { id: 3, x: pocket.x - 0.25, z: pocket.z - 0.2, pocketed: false },
    { id: 12, x: -0.6, z: -0.3, pocketed: false }, // opponent's ball, out of the way
    { id: 8, x: -0.7, z: 0.3, pocketed: false },
  ];
  const potted = execute(balls, plan(req(balls)));
  expect(potted).toContain(3);
  expect(potted).not.toContain(0);
  expect(potted).not.toContain(8);
});

test('does not pot the opponent ball when its own is available', () => {
  const balls: BallState[] = [
    { id: 0, x: 0, z: 0, pocketed: false },
    { id: 2, x: -0.5, z: -0.3, pocketed: false },
    { id: 11, x: pocket.x - 0.2, z: pocket.z - 0.15, pocketed: false }, // tempting stripe
    { id: 8, x: -0.7, z: 0.3, pocketed: false },
  ];
  const potted = execute(balls, plan(req(balls)));
  expect(potted).not.toContain(11);
  expect(potted).not.toContain(8);
});

test('ball in hand: places legally and pots', () => {
  const balls: BallState[] = [
    { id: 0, x: 0, z: 0, pocketed: true },
    { id: 5, x: 0.2, z: -0.25, pocketed: false },
    { id: 13, x: -0.2, z: 0.3, pocketed: false },
    { id: 8, x: -0.6, z: -0.2, pocketed: false },
  ];
  const p = plan(req(balls, { inHand: 'anywhere' }));
  expect(p.place).toBeDefined();
  expect(isLegalPlacement(balls, ...p.place!, 'anywhere')).toBe(true);
  expect(execute(balls, p)).toContain(5);
});

test('on the 8 with the group cleared: pots the 8 to win', () => {
  const balls: BallState[] = [
    { id: 0, x: 0.2, z: 0.15, pocketed: false },
    { id: 8, x: pocket.x - 0.3, z: pocket.z - 0.25, pocketed: false },
    { id: 10, x: -0.6, z: -0.3, pocketed: false },
  ];
  const potted = execute(balls, plan(req(balls, { rules: { ...midGame, onTable: [8, 10] } })));
  expect(potted).toContain(8);
  expect(potted).not.toContain(0);
});

test('frozen against the 8 with no clean escape: never picks a shot that loses the game', () => {
  // most ways out of here drive the 8 into a pocket (a loss); a foul is the lesser evil
  const balls: BallState[] = [
    { id: 0, x: 0.6, z: 0, pocketed: false },
    { id: 8, x: 0.6 - 2 * 0.028575 - 0.003, z: 0, pocketed: false },
    { id: 2, x: -0.6, z: 0, pocketed: false }, // only own ball, straight behind the 8
    { id: 10, x: -0.2, z: 0.35, pocketed: false },
    { id: 12, x: 0.1, z: -0.38, pocketed: false },
  ];
  const rules = { ...midGame, onTable: [2, 8, 10, 12] };
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const p = plan(req(balls, { rules, difficulty, seed: 3 }));
    const world = new World(balls.map((b) => new Ball(b.id, b.x, b.z)));
    const rec = new ShotRecorder();
    world.on((e) => rec.record(e));
    world.strike(0, p.shot);
    while (world.isMoving()) world.step();
    expect(scoreShot(req(balls, { rules }), p.shot)).toBeGreaterThan(-1e5); // chosen shot is not a loss
    expect(judge(rules, rec.result).state.winner).not.toBe(1);
  }
});

test('break: places behind the head string and hits hard at the rack', () => {
  const balls = triangleRack(9).map((b) => ({ id: b.number, x: b.x, z: b.z, pocketed: false }));
  const p = plan(req(balls, { rules: newGame(1), inHand: 'kitchen' }));
  expect(p.place![0]).toBeLessThanOrEqual(HEAD_SPOT_X);
  expect(p.shot.speed).toBeGreaterThan(7);
});

test('a full mid-game rack plans in reasonable time', () => {
  const balls = triangleRack(4).map((b) => ({ id: b.number, x: b.x, z: b.z, pocketed: false }));
  balls[0]!.x = -0.2; // spread a little so there are real options
  const t0 = performance.now();
  plan(req(balls, { rules: { ...midGame, groups: [null, null] } }));
  expect(performance.now() - t0).toBeLessThan(4000);
});
