// World: metres, cloth surface at y = 0, long axis = x (head rail at -x, foot rail at +x).
// Playing-surface size measured from public/models/table.glb (a 7 ft table) so physics matches the visuals.
export const BALL_RADIUS = 0.028575;
export const BALL_MASS = 0.17;

export const TABLE = {
  length: 1.96, // cushion nose to cushion nose
  width: 0.984,
  cushionHeight: 0.036, // nose height used for physics (the model's visual nose sits higher)
  cornerPocketMouth: 0.116,
  sidePocketMouth: 0.13,
  /** y of the cloth in the GLB's own coordinates; the model is shifted down by this. */
  modelClothY: 0.795,
} as const;

export const HEAD_SPOT_X = -TABLE.length / 4;
export const FOOT_SPOT_X = TABLE.length / 4;
