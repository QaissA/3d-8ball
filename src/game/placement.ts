import { BALL_RADIUS as R, HEAD_SPOT_X, TABLE } from '../config/table';
import type { BallInHand } from '../rules/EightBallRules';

interface Placed {
  id: number;
  x: number;
  z: number;
  state?: string;
}

/** Ball-in-hand spot is legal: on the cloth, behind the head string if required, touching no ball. */
export function isLegalPlacement(
  balls: Placed[],
  x: number,
  z: number,
  inHand: BallInHand,
): boolean {
  if (Math.abs(x) > TABLE.length / 2 - R || Math.abs(z) > TABLE.width / 2 - R) return false;
  if (inHand === 'kitchen' && x > HEAD_SPOT_X) return false;
  return !balls.some(
    (o) => o.id !== 0 && o.state !== 'pocketed' && Math.hypot(o.x - x, o.z - z) < 2 * R,
  );
}

/** Clamp a requested position into the area ball in hand allows. */
export function clampPlacement(x: number, z: number, inHand: BallInHand): [number, number] {
  const maxX = inHand === 'kitchen' ? HEAD_SPOT_X : TABLE.length / 2 - R;
  return [
    Math.min(Math.max(x, -TABLE.length / 2 + R), maxX),
    Math.min(Math.max(z, -TABLE.width / 2 + R), TABLE.width / 2 - R),
  ];
}
