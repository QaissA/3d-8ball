import { expect, test } from 'vitest';
import { Ball } from '../../src/physics/Ball';
import { World } from '../../src/physics/World';
import { PHYSICS } from '../../src/config/physics';

test('right english squirts the cue ball left and spins it clockwise-from-above', () => {
  const world = new World([new Ball(0, 0, 0)]);
  world.strike(0, { angle: 0, speed: 2, side: 1 });
  const b = world.balls[0]!;
  expect(Math.atan2(b.vz, b.vx)).toBeCloseTo(-PHYSICS.squirt, 6);
  expect(b.wy).toBeGreaterThan(0);
});

test('off-centre hits come out slower than centre hits', () => {
  const centre = new World([new Ball(0, 0, 0)]);
  const draw = new World([new Ball(0, 0, 0)]);
  centre.strike(0, { angle: 0, speed: 2 });
  draw.strike(0, { angle: 0, speed: 2, top: -1 });
  expect(centre.balls[0]!.vx).toBeCloseTo(2, 9);
  expect(draw.balls[0]!.vx).toBeLessThan(2);
});
