import { BALL_RADIUS as R } from '../config/table';
import { PHYSICS } from '../config/physics';
import type { Ball } from './Ball';

export interface Shot {
  /** Aim direction in radians on the cloth plane: 0 = +x, π/2 = +z (increasing = turning right). */
  angle: number;
  /** Cue-ball speed for a centre hit (m/s); off-centre hits come out slower. */
  speed: number;
  /** Tip offset as a fraction of the miscue limit: side +right/−left, top +follow/−draw. */
  side?: number;
  top?: number;
}

/** Furthest the tip can land from centre before a miscue, as a fraction of R. */
const MAX_OFFSET = 0.5;
/** Ball mass / cue mass (0.17 kg / 0.54 kg). */
const MASS_RATIO = 0.31;

/**
 * Impulse J = m·v along the aim through the tip contact point r gives ω = (r × J) / I.
 * Top offset 0.4R produces natural roll.
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
  // off-centre hits transfer less speed: v ∝ 1 / (1 + m/M + 5/2·(d/R)²), normalised to a centre hit
  const speed =
    (shot.speed * (1 + MASS_RATIO)) / (1 + MASS_RATIO + (2.5 * (a * a + h * h)) / (R * R));
  // squirt: side spin pushes the cue ball off the aim line, away from the side struck
  const angle = shot.angle - PHYSICS.squirt * side;
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const k = (2.5 * speed) / (R * R);
  b.vx = speed * dx;
  b.vz = speed * dz;
  b.wx = k * h * dz;
  b.wy = k * a;
  b.wz = -k * h * dx;
}
