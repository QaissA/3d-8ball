import { BALL_RADIUS, FOOT_SPOT_X, HEAD_SPOT_X } from '../config/table';

export interface BallPlacement {
  number: number; // 0 = cue ball
  x: number;
  z: number;
}

// Row by row from the apex: 8 in the centre, a solid (7) and a stripe (9) in the back corners.
// shortcut: fixed order, randomise the others when the Phase 4 rules land.
const ORDER = [1, 10, 2, 3, 8, 11, 12, 4, 13, 5, 9, 6, 14, 15, 7];

export function triangleRack(r = BALL_RADIUS): BallPlacement[] {
  const balls: BallPlacement[] = [{ number: 0, x: HEAD_SPOT_X, z: 0 }];
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      balls.push({
        number: ORDER[k++]!,
        x: FOOT_SPOT_X + row * r * Math.sqrt(3),
        z: (j - row / 2) * 2 * r,
      });
    }
  }
  return balls;
}
