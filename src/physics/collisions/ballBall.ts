import { BALL_RADIUS as R } from '../../config/table';
import { PHYSICS } from '../../config/physics';
import type { Ball } from '../Ball';
import { timeToCircle } from './timeToCircle';

export function timeToBallBall(a: Ball, b: Ball): number {
  return timeToCircle(b.x - a.x, b.z - a.z, b.vx - a.vx, b.vz - a.vz, 2 * R);
}

/**
 * Equal-mass impulse along the line of centres, plus friction from the tangential slip at the contact
 * (cut angle and side spin), which throws the object ball. Returns the approach speed.
 */
export function resolveBallBall(a: Ball, b: Ball): number {
  let nx = b.x - a.x;
  let nz = b.z - a.z;
  const d = Math.hypot(nx, nz);
  nx /= d;
  nz /= d;
  const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (vn <= 0) return 0;

  const jn = 0.5 * (1 + PHYSICS.ballRestitution) * vn;
  a.vx -= jn * nx;
  a.vz -= jn * nz;
  b.vx += jn * nx;
  b.vz += jn * nz;

  // horizontal tangential slip; 1/7 is the impulse that would stop it (two balls, I = 2/5 R²)
  const tx = -nz;
  const tz = nx;
  const vt = (a.vx - b.vx) * tx + (a.vz - b.vz) * tz - R * (a.wy + b.wy);
  const jt = Math.min(PHYSICS.ballFriction * jn, Math.abs(vt) / 7) * Math.sign(vt);
  a.vx -= jt * tx;
  a.vz -= jt * tz;
  b.vx += jt * tx;
  b.vz += jt * tz;
  a.wy += (2.5 * jt) / R;
  b.wy += (2.5 * jt) / R;
  return vn;
}
