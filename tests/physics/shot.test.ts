import { expect, test } from 'vitest';
import { Ball } from '../../src/physics/Ball';
import { World } from '../../src/physics/World';
import { predictAim } from '../../src/physics/aim';
import { BALL_RADIUS as R, TABLE } from '../../src/config/table';
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

test('aim prediction: ghost ball touches the object ball, direction along line of centres', () => {
  const balls = [new Ball(0, -0.5, 0), new Ball(3, 0, R)]; // half-ball hit
  const p = predictAim(balls, 0, 0)!;
  expect(p.ball).toBe(3);
  expect(Math.hypot(p.x - 0, p.z - R)).toBeCloseTo(2 * R, 9);
  expect(p.dirX).toBeCloseTo(Math.cos(Math.PI / 6), 6);
  expect(p.dirZ).toBeCloseTo(Math.sin(Math.PI / 6), 6);
});

test('aim prediction matches where the simulation actually makes contact', () => {
  const balls = [new Ball(0, -0.5, 0.1), new Ball(5, 0.3, 0.13)];
  const angle = 0.02;
  const p = predictAim(balls, 0, angle)!;
  const world = new World(balls);
  let contact: [number, number] | null = null;
  world.on((e) => {
    if (e.type === 'ballBall' && !contact) contact = [world.balls[0]!.x, world.balls[0]!.z];
  });
  world.strike(0, { angle, speed: 1 });
  while (world.isMoving() && !contact) world.step();
  // a centre hit travels straight, so the real contact point equals the prediction
  expect(contact![0]).toBeCloseTo(p.x, 6);
  expect(contact![1]).toBeCloseTo(p.z, 6);
});

test('aim prediction into an empty cushion stops one radius short of it', () => {
  const p = predictAim([new Ball(0, 0, 0.2)], 0, 0)!;
  expect(p.ball).toBeUndefined();
  expect(p.x).toBeCloseTo(TABLE.length / 2 - R, 9);
});
