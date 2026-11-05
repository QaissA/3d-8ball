import { BALL_RADIUS as R } from '../config/table';
import type { Ball } from './Ball';

export interface Shot {
  /** Aim direction in radians on the cloth plane: 0 = +x, π/2 = +z. */
  angle: number;
  /** Cue-ball speed right after the hit (m/s). */
  speed: number;
  /** Tip offset as a fraction of the miscue limit: side +right/−left, top +follow/−draw. */
  side?: number;
  top?: number;
}

/** Furthest the tip can land from centre before a miscue, as a fraction of R. */
const MAX_OFFSET = 0.5;

/**
 * Impulse J = m·v along the aim through the tip contact point r gives ω = (r × J) / I.
 * Top offset 0.4R produces natural roll. Squirt and speed loss on off-centre hits come in Phase 3.
 */
export function applyCueStrike(b: Ball, shot: Shot): void {
  let side = shot.side ?? 0;
  let top = shot.top ?? 0;
  const m = Math.hypot(side, top);
  if (m > 1) {
    side /= m;
    top /= m;
  }
  const a = side * MAX_OFFSET * R;
  const h = top * MAX_OFFSET * R;
  const dx = Math.cos(shot.angle);
  const dz = Math.sin(shot.angle);
  const k = (2.5 * shot.speed) / (R * R);
  b.vx = shot.speed * dx;
  b.vz = shot.speed * dz;
  b.wx = k * h * dz;
  b.wy = k * a;
  b.wz = -k * h * dx;
}
