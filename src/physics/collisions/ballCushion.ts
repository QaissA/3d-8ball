import { BALL_RADIUS as R, CUSHIONS } from '../../config/table';
import { PHYSICS } from '../../config/physics';
import type { Ball } from '../Ball';
import { timeToCircle } from './timeToCircle';

interface Segment {
  ax: number;
  az: number;
  dx: number;
  dz: number;
  len2: number;
  nx: number;
  nz: number;
}

export const SEGMENTS: Segment[] = CUSHIONS.flatMap((pl) =>
  pl.slice(1).map(([bx, bz], i) => {
    const [ax, az] = pl[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    return { ax, az, dx, dz, len2: len * len, nx: -dz / len, nz: dx / len };
  }),
);
export const VERTICES = CUSHIONS.flat();

export interface Hit {
  t: number;
  nx: number; // contact normal, pointing from the cushion to the ball
  nz: number;
}

/** Time until the ball touches the segment's straight part (ends are handled as vertices). */
export function timeToSegment(b: Ball, s: Segment, out: Hit): boolean {
  const d0 = (b.x - s.ax) * s.nx + (b.z - s.az) * s.nz;
  const sgn = d0 >= 0 ? 1 : -1;
  const vn = (b.vx * s.nx + b.vz * s.nz) * sgn;
  if (vn >= 0) return false;
  const gap = d0 * sgn - R;
  const t = gap <= 0 ? 0 : gap / -vn;
  const lam = ((b.x + b.vx * t - s.ax) * s.dx + (b.z + b.vz * t - s.az) * s.dz) / s.len2;
  if (lam < 0 || lam > 1) return false;
  out.t = t;
  out.nx = s.nx * sgn;
  out.nz = s.nz * sgn;
  return true;
}

export function timeToVertex(b: Ball, vx: number, vz: number): number {
  return timeToCircle(b.x - vx, b.z - vz, b.vx, b.vz, R);
}

/**
 * Restitution along the normal, plus cushion friction against the tangential slip (side spin
 * changes the rebound angle). Returns the normal approach speed.
 */
export function resolveCushion(b: Ball, nx: number, nz: number): number {
  const vn = b.vx * nx + b.vz * nz;
  if (vn >= 0) return 0;
  const jn = -(1 + PHYSICS.cushionRestitution) * vn;
  b.vx += jn * nx;
  b.vz += jn * nz;
  const tx = -nz;
  const tz = nx;
  const vt = b.vx * tx + b.vz * tz + R * b.wy;
  const jt = Math.min(PHYSICS.cushionFriction * jn, Math.abs(vt) / 3.5) * Math.sign(vt);
  b.vx -= jt * tx;
  b.vz -= jt * tz;
  b.wy -= (2.5 * jt) / R;
  return -vn;
}
