import { DT } from '../config/physics';
import { POCKETS, TABLE } from '../config/table';
import { Ball, classify } from './Ball';
import { applyFriction } from './motion';
import { resolveBallBall, timeToBallBall } from './collisions/ballBall';
import {
  type Hit,
  resolveCushion,
  SEGMENTS,
  timeToSegment,
  timeToVertex,
  VERTICES,
} from './collisions/ballCushion';
import { pocketBall, timeToPocket } from './collisions/ballPocket';
import { applyCueStrike, type Shot } from './cueStrike';

export type PhysicsEvent =
  | { type: 'cueHit'; ball: number; speed: number }
  | { type: 'ballBall'; a: number; b: number; speed: number }
  | { type: 'ballCushion'; ball: number; speed: number }
  | { type: 'pocketed'; ball: number; pocket: number }
  | { type: 'allStopped' };

/** Safety cap on collisions handled within one step (a tight cluster resolves in a few dozen). */
const MAX_EVENTS_PER_STEP = 2000;

export type NextEvent =
  | { kind: 'ball'; t: number; i: number; j: number }
  | { kind: 'cushion'; t: number; i: number; nx: number; nz: number }
  | { kind: 'pocket'; t: number; i: number; p: number };

/**
 * Deterministic billiards simulation: fixed steps, friction applied per step, then motion advanced
 * collision by collision (earliest time of impact first), so fast balls cannot tunnel.
 */
export class World {
  time = 0;
  /** Balls that left the table without being caught by a pocket. Should stay 0; tests assert it. */
  escapes = 0;
  private listeners: ((e: PhysicsEvent) => void)[] = [];
  private hit: Hit = { t: 0, nx: 0, nz: 0 };

  constructor(readonly balls: Ball[]) {}

  on(fn: (e: PhysicsEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: PhysicsEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  strike(id: number, shot: Shot): void {
    const b = this.balls.find((x) => x.id === id);
    if (!b || b.state === 'pocketed') return;
    applyCueStrike(b, shot);
    b.state = classify(b);
    this.emit({ type: 'cueHit', ball: id, speed: shot.speed });
  }

  isMoving(): boolean {
    return this.balls.some((b) => b.state !== 'stationary' && b.state !== 'pocketed');
  }

  step(dt = DT): void {
    if (!this.isMoving()) return;
    for (const b of this.balls) applyFriction(b, dt);
    this.advance(dt);
    for (const b of this.balls) b.state = classify(b);
    this.time += dt;
    if (!this.isMoving()) this.emit({ type: 'allStopped' });
  }

  private advance(dt: number): void {
    let remaining = dt;
    for (let n = 0; remaining > 0; n++) {
      const ev = n < MAX_EVENTS_PER_STEP ? this.nextEvent(remaining) : null;
      const t = ev ? ev.t : remaining;
      for (const b of this.balls) {
        b.x += b.vx * t;
        b.z += b.vz * t;
      }
      remaining -= t;
      if (!ev) break;
      this.resolve(ev);
    }
    this.catchEscapes();
  }

  /** Earliest collision or pocket entry within maxT, given current velocities (also used for aim prediction). */
  nextEvent(maxT: number): NextEvent | null {
    let best: NextEvent | null = null;
    let bestT = maxT;
    const balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i]!;
      if (a.state === 'pocketed') continue;
      const aMoving = a.vx !== 0 || a.vz !== 0;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j]!;
        if (b.state === 'pocketed' || (!aMoving && b.vx === 0 && b.vz === 0)) continue;
        const t = timeToBallBall(a, b);
        if (t < bestT) {
          bestT = t;
          best = { kind: 'ball', t, i, j };
        }
      }
      if (!aMoving) continue;
      for (const s of SEGMENTS) {
        if (timeToSegment(a, s, this.hit) && this.hit.t < bestT) {
          bestT = this.hit.t;
          best = { kind: 'cushion', t: bestT, i, nx: this.hit.nx, nz: this.hit.nz };
        }
      }
      for (const [vx, vz] of VERTICES) {
        const t = timeToVertex(a, vx, vz);
        if (t < bestT) {
          bestT = t;
          const d = Math.hypot(a.x + a.vx * t - vx, a.z + a.vz * t - vz);
          best = {
            kind: 'cushion',
            t,
            i,
            nx: (a.x + a.vx * t - vx) / d,
            nz: (a.z + a.vz * t - vz) / d,
          };
        }
      }
      for (let p = 0; p < POCKETS.length; p++) {
        const t = timeToPocket(a, POCKETS[p]!);
        if (t < bestT) {
          bestT = t;
          best = { kind: 'pocket', t, i, p };
        }
      }
    }
    return best;
  }

  private resolve(ev: NextEvent): void {
    const a = this.balls[ev.i]!;
    if (ev.kind === 'ball') {
      const b = this.balls[ev.j]!;
      const speed = resolveBallBall(a, b);
      if (speed > 0) this.emit({ type: 'ballBall', a: a.id, b: b.id, speed });
    } else if (ev.kind === 'cushion') {
      const speed = resolveCushion(a, ev.nx, ev.nz);
      if (speed > 0) this.emit({ type: 'ballCushion', ball: a.id, speed });
    } else {
      pocketBall(a);
      this.emit({ type: 'pocketed', ball: a.id, pocket: ev.p });
    }
  }

  /** Safety net: a ball beyond the rails is dropped into the nearest pocket rather than lost. */
  private catchEscapes(): void {
    for (const b of this.balls) {
      if (b.state === 'pocketed') continue;
      if (Math.abs(b.x) < TABLE.length / 2 + 0.1 && Math.abs(b.z) < TABLE.width / 2 + 0.1) continue;
      let p = 0;
      POCKETS.forEach((q, k) => {
        if (Math.hypot(b.x - q.x, b.z - q.z) < Math.hypot(b.x - POCKETS[p]!.x, b.z - POCKETS[p]!.z))
          p = k;
      });
      this.escapes++;
      pocketBall(b);
      this.emit({ type: 'pocketed', ball: b.id, pocket: p });
    }
  }
}
