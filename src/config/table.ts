// World: metres, cloth surface at y = 0, long axis = x (head rail at -x, foot rail at +x).
// All geometry measured from public/models/table.glb (a 7 ft table) by slicing the mesh at
// cushion-contact height (~38 mm above the cloth), so physics matches the visuals.
export const BALL_RADIUS = 0.028575;

export const TABLE = {
  length: 1.982, // cushion line to cushion line
  width: 1.0056,
  /** y of the cloth in the GLB's own coordinates; the model is shifted down by this. */
  modelClothY: 0.795,
} as const;

export const HEAD_SPOT_X = -TABLE.length / 4;
export const FOOT_SPOT_X = TABLE.length / 4;

const HX = TABLE.length / 2;
const HZ = TABLE.width / 2;
// face: where the straight cushion face ends (from the corner / from the side-pocket centre)
// jawRun/jawDepth: jaw end relative to the face end, along the rail toward the pocket / behind the cushion line
// hole: pocket hole centre offset behind the cushion line(s); holeR: its radius
const CORNER = { face: 0.085, jawRun: 0.035, jawDepth: 0.035, hole: 0.0115, holeR: 0.054 };
const SIDE = { face: 0.078, jawRun: 0.014, jawDepth: 0.038, hole: 0.038, holeR: 0.051 };

export type Point = readonly [x: number, z: number];

/** Long cushion in the +x,+z quarter, from the corner jaw to the side jaw. */
const LONG: Point[] = [
  [HX - CORNER.face + CORNER.jawRun, HZ + CORNER.jawDepth],
  [HX - CORNER.face, HZ],
  [SIDE.face, HZ],
  [SIDE.face - SIDE.jawRun, HZ + SIDE.jawDepth],
];
/** Short cushion at +x. */
const SHORT: Point[] = [
  [HX + CORNER.jawDepth, HZ - CORNER.face + CORNER.jawRun],
  [HX, HZ - CORNER.face],
  [HX, -(HZ - CORNER.face)],
  [HX + CORNER.jawDepth, -(HZ - CORNER.face + CORNER.jawRun)],
];
const mirror = (pl: Point[], sx: number, sz: number): Point[] =>
  pl.map(([x, z]) => [x * sx, z * sz] as const);

/** Six cushions as polylines; balls collide with every segment and vertex. */
export const CUSHIONS: Point[][] = [
  mirror(LONG, 1, 1),
  mirror(LONG, -1, 1),
  mirror(LONG, 1, -1),
  mirror(LONG, -1, -1),
  mirror(SHORT, 1, 1),
  mirror(SHORT, -1, 1),
];

export interface Pocket {
  x: number;
  z: number;
  r: number;
}
/** A ball is pocketed once its centre is over the hole. Corners first, then sides. */
export const POCKETS: Pocket[] = [
  ...[
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ].map(([sx, sz]) => ({
    x: sx! * (HX + CORNER.hole),
    z: sz! * (HZ + CORNER.hole),
    r: CORNER.holeR,
  })),
  { x: 0, z: HZ + SIDE.hole, r: SIDE.holeR },
  { x: 0, z: -(HZ + SIDE.hole), r: SIDE.holeR },
];
