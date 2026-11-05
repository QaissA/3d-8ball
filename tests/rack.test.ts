import { expect, test } from 'vitest';
import { triangleRack } from '../src/game/Rack';
import { BALL_RADIUS, FOOT_SPOT_X, TABLE } from '../src/config/table';

const rack = triangleRack();
const objectBalls = rack.filter((b) => b.number !== 0);

test('16 unique balls, apex on the foot spot', () => {
  expect(new Set(rack.map((b) => b.number)).size).toBe(16);
  expect(objectBalls[0]).toMatchObject({ x: FOOT_SPOT_X, z: 0 });
});

test('8 in centre, one solid and one stripe in back corners', () => {
  expect(objectBalls[4]!.number).toBe(8);
  const corners = [objectBalls[10]!.number, objectBalls[14]!.number];
  expect(corners.filter((n) => n < 8)).toHaveLength(1);
  expect(corners.filter((n) => n > 8)).toHaveLength(1);
});

test('seeded racks: random but reproducible, always 8 centre and mixed corners', () => {
  const orders = new Set<string>();
  for (let seed = 1; seed <= 50; seed++) {
    const balls = triangleRack(seed).filter((b) => b.number !== 0);
    expect(new Set(balls.map((b) => b.number)).size).toBe(15);
    expect(balls[4]!.number).toBe(8);
    const corners = [balls[10]!.number, balls[14]!.number];
    expect(corners.filter((n) => n < 8)).toHaveLength(1);
    expect(corners.filter((n) => n > 8)).toHaveLength(1);
    orders.add(balls.map((b) => b.number).join());
  }
  expect(orders.size).toBeGreaterThan(45);
  expect(triangleRack(7)).toEqual(triangleRack(7));
});

test('no overlaps, all on the table', () => {
  for (const a of rack) {
    expect(Math.abs(a.x)).toBeLessThan(TABLE.length / 2 - BALL_RADIUS);
    expect(Math.abs(a.z)).toBeLessThan(TABLE.width / 2 - BALL_RADIUS);
    for (const b of rack) {
      if (a !== b)
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2 * BALL_RADIUS - 1e-9);
    }
  }
});
