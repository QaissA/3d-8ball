import type { Pocket } from '../../config/table';
import type { Ball } from '../Ball';
import { timeToCircle } from './timeToCircle';

/** Time until the ball's centre is over the hole (0 if it already is). */
export function timeToPocket(b: Ball, p: Pocket): number {
  const dx = b.x - p.x;
  const dz = b.z - p.z;
  if (dx * dx + dz * dz <= p.r * p.r) return 0;
  return timeToCircle(dx, dz, b.vx, b.vz, p.r);
}

export function pocketBall(b: Ball): void {
  b.state = 'pocketed';
  b.vx = b.vz = b.wx = b.wy = b.wz = 0;
}
