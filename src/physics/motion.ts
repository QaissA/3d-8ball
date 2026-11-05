import { BALL_RADIUS as R } from '../config/table';
import { PHYSICS } from '../config/physics';
import { EPS, type Ball } from './Ball';

/**
 * Cloth friction for one step. Sliding: friction opposes the contact slip u and drives it to zero
 * (u changes 7/2 times faster than v, since friction also torques the ball). Rolling: v = ω × r,
 * decelerated by rolling resistance. Vertical-axis spin decays on its own.
 */
export function applyFriction(b: Ball, dt: number): void {
  if (b.state === 'pocketed') return;
  const g = PHYSICS.gravity;
  const ux = b.vx + R * b.wz;
  const uz = b.vz - R * b.wx;
  const u = Math.hypot(ux, uz);

  if (u > EPS) {
    if (3.5 * PHYSICS.muSlide * g * dt >= u) {
      // reaches pure rolling within this step: remove the slip exactly
      b.vx -= (2 / 7) * ux;
      b.vz -= (2 / 7) * uz;
      b.wz -= ((5 / 7) * ux) / R;
      b.wx += ((5 / 7) * uz) / R;
    } else {
      const k = (PHYSICS.muSlide * g * dt) / u;
      b.vx -= k * ux;
      b.vz -= k * uz;
      b.wz -= (2.5 * k * ux) / R;
      b.wx += (2.5 * k * uz) / R;
    }
  } else {
    const v = Math.hypot(b.vx, b.vz);
    const dv = PHYSICS.muRoll * g * dt;
    const s = v <= dv ? 0 : (v - dv) / v;
    b.vx *= s;
    b.vz *= s;
    b.wx = b.vz / R;
    b.wz = -b.vx / R;
  }

  const dw = PHYSICS.spinDecel * dt;
  b.wy = Math.abs(b.wy) <= dw ? 0 : b.wy - Math.sign(b.wy) * dw;
}
