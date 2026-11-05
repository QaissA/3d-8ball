import { BALL_RADIUS, FOOT_SPOT_X, HEAD_SPOT_X } from '../config/table';

export interface BallPlacement {
  number: number; // 0 = cue ball
  x: number;
  z: number;
}

// Row by row from the apex: 8 in the centre, a solid (7) and a stripe (9) in the back corners.
const FIXED_ORDER = [1, 10, 2, 3, 8, 11, 12, 4, 13, 5, 9, 6, 14, 15, 7];
const EIGHT = 4;
const CORNERS = [10, 14];

/** Small seeded PRNG (mulberry32) so a rack can be reproduced from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** WPA rack: 8 in the centre, one solid and one stripe in the back corners, the rest random. */
function randomOrder(rand: () => number): number[] {
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7], rand);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15], rand);
  const corners = rand() < 0.5 ? [solids.pop()!, stripes.pop()!] : [stripes.pop()!, solids.pop()!];
  const rest = shuffle([...solids, ...stripes], rand);
  return Array.from({ length: 15 }, (_, i) =>
    i === EIGHT ? 8 : i === CORNERS[0] ? corners[0]! : i === CORNERS[1] ? corners[1]! : rest.pop()!,
  );
}

/** Cue ball on the head spot, rack apex on the foot spot. A seed gives a random (reproducible) order. */
export function triangleRack(seed?: number): BallPlacement[] {
  const order = seed === undefined ? FIXED_ORDER : randomOrder(mulberry32(seed));
  const r = BALL_RADIUS;
  const balls: BallPlacement[] = [{ number: 0, x: HEAD_SPOT_X, z: 0 }];
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      balls.push({
        number: order[k++]!,
        x: FOOT_SPOT_X + row * r * Math.sqrt(3),
        z: (j - row / 2) * 2 * r,
      });
    }
  }
  return balls;
}
