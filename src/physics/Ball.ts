import { BALL_RADIUS as R } from '../config/table';

export type BallState = 'stationary' | 'sliding' | 'rolling' | 'spinning' | 'pocketed';

/** Below this (m/s), slip and speed count as zero. */
export const EPS = 1e-6;

/**
 * Position on the cloth plane (x, z), velocity (vx, vz), angular velocity (wx, wy, wz) with y up.
 * Unit mass is used throughout: every ball has the same mass, so it cancels out.
 */
export class Ball {
  vx = 0;
  vz = 0;
  wx = 0;
  wy = 0;
  wz = 0;
  state: BallState = 'stationary';

  constructor(
    readonly id: number,
    public x: number,
    public z: number,
  ) {}
}

export function classify(b: Ball): BallState {
  if (b.state === 'pocketed') return 'pocketed';
  // contact-point velocity on the cloth: u = v + ω × (0, -R, 0)
  const ux = b.vx + R * b.wz;
  const uz = b.vz - R * b.wx;
  if (ux * ux + uz * uz > EPS * EPS) return 'sliding';
  if (b.vx * b.vx + b.vz * b.vz > EPS * EPS) return 'rolling';
  if (b.wy !== 0) return 'spinning';
  return 'stationary';
}

/** Kinetic energy per unit mass (I = 2/5 R²). */
export function kineticEnergy(b: Ball): number {
  if (b.state === 'pocketed') return 0;
  return (
    0.5 * (b.vx * b.vx + b.vz * b.vz) + 0.2 * R * R * (b.wx * b.wx + b.wy * b.wy + b.wz * b.wz)
  );
}
