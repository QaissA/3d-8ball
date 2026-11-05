import { BALL_RADIUS as R, FOOT_SPOT_X, HEAD_SPOT_X, TABLE } from '../config/table';
import { Ball } from '../physics/Ball';
import { World } from '../physics/World';
import type { Shot } from '../physics/cueStrike';
import {
  type BallInHand,
  DEFAULT_OPTIONS,
  judge,
  newGame,
  type Player,
  type RulesState,
} from '../rules/EightBallRules';
import { ShotRecorder } from '../rules/ShotResult';
import { triangleRack } from './Rack';

export type Phase = 'ballInHand' | 'aiming' | 'rolling' | 'gameOver';
export const PLAYER_NAMES = ['Player 1', 'Player 2'] as const;

/**
 * Turn flow: ballInHand (break is placed behind the head string) → aiming → rolling → rules
 * decide → next turn / ball in hand / game over. Illegal break → re-rack, opponent breaks.
 */
export class Game {
  world!: World;
  rules!: RulesState;
  phase: Phase = 'ballInHand';
  inHand: BallInHand = 'kitchen';
  message = '';
  /** Seed of the current rack (reproducible racks for replays). */
  seed = 0;
  readonly options = { ...DEFAULT_OPTIONS };
  /** Called whenever a new World is created, so the renderer can resync. */
  onNewWorld: (w: World) => void = () => {};
  private recorder = new ShotRecorder();
  private breaker: Player = 0;

  constructor(private makeSeed: () => number = () => (Math.random() * 2 ** 32) >>> 0) {
    this.newRack(0);
  }

  get cueBall(): Ball {
    return this.world.balls.find((b) => b.id === 0)!;
  }

  newGame(): void {
    this.newRack(this.breaker === 0 ? 1 : 0); // alternate breaks
  }

  newRack(breaker: Player): void {
    this.breaker = breaker;
    this.seed = this.makeSeed();
    this.world = new World(triangleRack(this.seed).map((p) => new Ball(p.number, p.x, p.z)));
    this.world.on((e) => this.recorder.record(e));
    this.rules = newGame(breaker);
    this.phase = 'ballInHand';
    this.inHand = 'kitchen';
    this.message = `${PLAYER_NAMES[breaker]} to break: place the cue ball behind the line`;
    this.onNewWorld(this.world);
  }

  /** Legal ball-in-hand spot: on the cloth, behind the head string if required, not touching a ball. */
  canPlace(x: number, z: number): boolean {
    if (Math.abs(x) > TABLE.length / 2 - R || Math.abs(z) > TABLE.width / 2 - R) return false;
    if (this.inHand === 'kitchen' && x > HEAD_SPOT_X) return false;
    return !this.overlaps(x, z, 0);
  }

  /** Clamp a requested ball-in-hand position into the allowed area. */
  clampPlacement(x: number, z: number): [number, number] {
    const maxX = this.inHand === 'kitchen' ? HEAD_SPOT_X : TABLE.length / 2 - R;
    return [
      Math.min(Math.max(x, -TABLE.length / 2 + R), maxX),
      Math.min(Math.max(z, -TABLE.width / 2 + R), TABLE.width / 2 - R),
    ];
  }

  /** Move the cue ball while it's in hand (preview); returns whether the spot is legal. */
  moveCueBall(x: number, z: number): boolean {
    if (this.phase !== 'ballInHand') return false;
    [x, z] = this.clampPlacement(x, z);
    const b = this.cueBall;
    b.x = x;
    b.z = z;
    b.state = 'stationary';
    return this.canPlace(x, z);
  }

  placeCueBall(): boolean {
    if (this.phase !== 'ballInHand' || !this.canPlace(this.cueBall.x, this.cueBall.z)) return false;
    this.phase = 'aiming';
    if (this.rules.isBreak) this.message = `${PLAYER_NAMES[this.rules.current]} to break`;
    return true;
  }

  shoot(shot: Shot): void {
    if (this.phase !== 'aiming') return;
    this.recorder.reset();
    this.world.strike(0, shot);
    this.phase = 'rolling';
    this.message = '';
  }

  /** Call after stepping physics. */
  update(): void {
    if (this.phase === 'rolling' && !this.world.isMoving()) this.resolve();
  }

  private resolve(): void {
    const shooter = PLAYER_NAMES[this.rules.current];
    const o = judge(this.rules, this.recorder.result, this.options);
    if (o.rerack) {
      this.newRack(o.state.current);
      this.message = `Illegal break by ${shooter}. ${PLAYER_NAMES[o.state.current]} re-breaks`;
      return;
    }
    this.rules = o.state;
    if (o.respotEight)
      this.spot(
        this.world.balls.find((b) => b.id === 8)!,
        FOOT_SPOT_X,
        1,
      );

    if (this.rules.winner !== null) {
      this.phase = 'gameOver';
      this.message = `${PLAYER_NAMES[this.rules.winner]} wins! (${shooter}: ${o.note})`;
      return;
    }
    const next = PLAYER_NAMES[this.rules.current];
    const parts = [
      o.foul && `Foul by ${shooter}: ${o.foul}.`,
      o.note && `${shooter}: ${o.note}.`,
      `${next} to shoot${o.ballInHand !== 'none' ? ' with ball in hand' : ''}.`,
    ];
    this.message = parts.filter(Boolean).join(' ');

    if (o.ballInHand === 'none') {
      this.phase = 'aiming';
      return;
    }
    this.phase = 'ballInHand';
    this.inHand = o.ballInHand;
    if (this.cueBall.state === 'pocketed') this.spot(this.cueBall, HEAD_SPOT_X, -1);
  }

  /** Put a ball back on the long string at x, sliding along it (dir ±1) to the first free spot. */
  private spot(b: Ball, x: number, dir: 1 | -1): void {
    b.state = 'stationary';
    b.vx = b.vz = b.wx = b.wy = b.wz = 0;
    b.z = 0;
    for (const d of [dir, -dir]) {
      b.x = x;
      while (this.overlaps(b.x, 0, b.id) && Math.abs(b.x) < TABLE.length / 2 - R) b.x += d * 0.002;
      if (!this.overlaps(b.x, 0, b.id)) return;
    }
  }

  private overlaps(x: number, z: number, self: number): boolean {
    return this.world.balls.some(
      (o) => o.id !== self && o.state !== 'pocketed' && Math.hypot(o.x - x, o.z - z) < 2 * R,
    );
  }
}
