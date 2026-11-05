import { expect, test } from 'vitest';
import { Ball } from '../../src/physics/Ball';
import { World } from '../../src/physics/World';
import { predictShot, type Vec2 } from '../../src/physics/aim';
import { BALL_RADIUS as R, TABLE } from '../../src/config/table';

const heading = (path: Vec2[], from: number) => {
  const [x1, z1] = path[from]!;
  const [x2, z2] = path[from + 1]!;
  return Math.atan2(z2 - z1, x2 - x1);
};
const last = (path: Vec2[]) => path[path.length - 1]!;

test('ghost ball touches the object ball; object leaves along the line of centres', () => {
  const balls = [new Ball(0, -0.5, 0), new Ball(3, 0, R)]; // half-ball hit
  const p = predictShot(balls, 0, { angle: 0, speed: 1 });
  expect(p.objectId).toBe(3);
  const [gx, gz] = p.ghost!;
  expect(Math.hypot(gx, gz - R)).toBeCloseTo(2 * R, 6);
  // line of centres is 30° for a half-ball hit; throw cuts it by a few degrees
  const a = heading(p.objectPath, 0);
  expect(a).toBeLessThan(Math.PI / 6);
  expect(a).toBeGreaterThan(Math.PI / 6 - 0.1);
});

test('straight-on shot sends the object ball straight down the line', () => {
  const p = predictShot([new Ball(0, -0.5, 0), new Ball(1, 0, 0)], 0, { angle: 0, speed: 1 });
  expect(p.objectId).toBe(1);
  for (const [, z] of p.objectPath) expect(Math.abs(z)).toBeLessThan(1e-9);
});

test('stun cut: cue ball leaves at ~90° to the object ball; follow bends it forward', () => {
  const balls = () => [new Ball(0, -0.5, 0), new Ball(3, 0, R)];
  // stun: slide into the ball (enough draw that it arrives without roll over 0.5 m)
  const stun = predictShot(balls(), 0, { angle: 0, speed: 1.5, top: -0.35 });
  const follow = predictShot(balls(), 0, { angle: 0, speed: 1.5, top: 0.8 });
  const objAngle = heading(stun.objectPath, 0);
  const cueAngle = heading(stun.cueAfter, 0);
  expect(Math.abs(Math.abs(objAngle - cueAngle) - Math.PI / 2)).toBeLessThan(0.15);
  // follow: the cue ball's path curves toward the shot line, ending further along +x
  expect(last(follow.cueAfter)[0]).toBeGreaterThan(last(stun.cueAfter)[0]);
});

test('a shot into a cushion shows the rebound point and a reflected path', () => {
  // angled at the +z long cushion, no balls to hit
  const p = predictShot([new Ball(0, -0.4, 0)], 0, { angle: Math.PI / 4, speed: 1.5 });
  expect(p.objectId).toBeUndefined();
  const [, rz] = p.rebounds[0]!;
  expect(rz).toBeCloseTo(TABLE.width / 2 - R, 3);
  // the path after the rebound heads away from that cushion
  expect(last(p.cuePath)[1]).toBeLessThan(rz - 0.05);
});

test('object ball into a pocket is flagged with that pocket', () => {
  // corner pocket 0 is at +x,+z; object ball 10 cm out on the diagonal, cue behind it
  const d = Math.SQRT1_2;
  const ox = TABLE.length / 2 - 0.15;
  const oz = TABLE.width / 2 - 0.15;
  const balls = [new Ball(0, ox - 0.4 * d, oz - 0.4 * d), new Ball(2, ox, oz)];
  const p = predictShot(balls, 0, { angle: Math.PI / 4, speed: 1.5 });
  expect(p.objectId).toBe(2);
  expect(p.objectPocket).toBe(0);
});

test('preview matches the real simulation and does not touch the real balls', () => {
  const balls = [new Ball(0, -0.5, 0.1), new Ball(5, 0.3, 0.13)];
  const before = JSON.stringify(balls);
  const shot = { angle: 0.02, speed: 1.2, side: 0.3, top: 0.4 };
  const p = predictShot(balls, 0, shot);
  expect(JSON.stringify(balls)).toBe(before);

  const world = new World(balls);
  let contact: Vec2 | null = null;
  world.on((e) => {
    if (e.type === 'ballBall' && !contact) contact = [balls[0]!.x, balls[0]!.z];
  });
  world.strike(0, shot);
  while (world.isMoving() && !contact) world.step();
  expect(contact![0]).toBeCloseTo(p.ghost![0], 9);
  expect(contact![1]).toBeCloseTo(p.ghost![1], 9);
});

test('a full rack preview (the break) stays cheap', () => {
  const balls = [new Ball(0, -0.5, 0)];
  for (let row = 0, n = 1; row < 5; row++)
    for (let k = 0; k <= row; k++)
      balls.push(new Ball(n++, 0.5 + row * 2 * R * 0.87, (k - row / 2) * 2 * R));
  const t = performance.now();
  for (let i = 0; i < 10; i++) predictShot(balls, 0, { angle: 0, speed: 10 });
  expect((performance.now() - t) / 10).toBeLessThan(10);
});
