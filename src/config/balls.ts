/** Colours for balls 1–8 (9–15 reuse 1–7 as stripes). Shared by the 3D balls and HUD icons. */
export const BALL_COLORS = [
  '#f2c200',
  '#1a4fc4',
  '#d42020',
  '#5b2a86',
  '#f07a12',
  '#127a3a',
  '#7a1a1a',
  '#111111',
];
export const IVORY = '#f4f1e8';
export const ballColor = (n: number) => (n === 0 ? IVORY : BALL_COLORS[(n - 1) % 8]!);
