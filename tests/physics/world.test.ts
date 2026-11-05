import { describe, expect, test } from 'vitest';
import { Ball, kineticEnergy } from '../../src/physics/Ball';
import { World, type PhysicsEvent } from '../../src/physics/World';
import { triangleRack } from '../../src/game/Rack';
import { BALL_RADIUS as R, TABLE } from '../../src/config/table';
import { PHYSICS } from '../../src/config/physics';

const MAX_STEPS = 240 * 60; // one minute of simulated time

function runToRest(world: World, onStep?: () => void): number {
  let n = 0;
  while (world.isMoving() && n < MAX_STEPS) {
    world.step();
    onStep?.();
    n++;
  }
  return n;
}

function rackWorld(): World {
  return new World(triangleRack().map((p) => new Ball(p.number, p.x, p.z)));
}

const BREAK = { angle: 0.003, speed: 9 };

/** Ball state as a sliding contact with no spin (a stun hit), velocity along +x. */
function stunBall(id: number, x: number, z: number, speed: number): Ball {
  const b = new Ball(id, x, z);
  b.vx = speed;
  b.state = 'sliding';
  return b;
}

function assertNoOverlaps(world: World) {
  const live = world.balls.filter((b) => b.state !== 'pocketed');
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const d = Math.hypot(live[i]!.x - live[j]!.x, live[i]!.z - live[j]!.z);
      expect(d).toBeGreaterThan(2 * R - 1e-7);
    }
}

describe('ball-ball', () => {
  test('stun shot: cue ball stops dead on a full hit', () => {
    const cue = stunBall(0, -0.5, 0, 2);
    const obj = new Ball(1, -0.5 + 2 * R + 0.001, 0);
    const world = new World([cue, obj]);
    let objSpeed = 0;
    world.on((e) => {
      if (e.type === 'ballBall') objSpeed = obj.vx;
    });
    runToRest(world);
    // keeps (1-e)/2 = 2.5% of its speed and rolls on ~1 cm
    expect(Math.abs(cue.x - -0.5)).toBeLessThan(0.02);
    expect(objSpeed).toBeGreaterThan(1.9); // object ball took the rest
  });

  test('90° rule: on a stun cut the balls separate at ~90°', () => {
    const cue = stunBall(0, -0.5, 0, 2);
    const obj = new Ball(1, -0.5 + Math.sqrt(3) * R + 0.001, R); // half-ball hit (30° cut)
    const world = new World([cue, obj]);
    let angle = NaN;
    world.on((e) => {
      if (e.type === 'ballBall')
        angle = Math.abs(Math.atan2(cue.vz, cue.vx) - Math.atan2(obj.vz, obj.vx)) * (180 / Math.PI);
    });
    world.step();
    // 90° minus throw (~3.4°) minus the restitution loss (~2.8°) = 83.8° analytically
    expect(angle).toBeGreaterThan(82);
    expect(angle).toBeLessThan(90);
  });

  test('30° rule: a rolling cue ball on a half-ball hit deflects ~30°', () => {
    const cue = new Ball(0, -0.3, 0);
    cue.vx = 0.8;
    cue.wz = -0.8 / R; // natural roll
    cue.state = 'rolling';
    const obj = new Ball(1, 0, R);
    const world = new World([cue, obj]);
    let hit = false;
    world.on((e) => {
      if (e.type === 'ballBall') hit = true;
    });
    for (let n = 0; n < MAX_STEPS && !(hit && cue.state === 'rolling'); n++) world.step();
    const deflection = Math.abs(Math.atan2(cue.vz, cue.vx)) * (180 / Math.PI);
    expect(deflection).toBeGreaterThan(26);
    expect(deflection).toBeLessThan(36);
  });

  test('draw: max backspin brings the cue ball back toward the shooter', () => {
    const world = new World([new Ball(0, -0.5, 0), new Ball(1, -0.2, 0)]);
    world.strike(0, { angle: 0, speed: 3, top: -1 });
    runToRest(world);
    expect(world.balls[0]!.x).toBeLessThan(-0.5 - 0.1);
  });

  test('no tunnelling: a max-speed shot always hits the ball in its path', () => {
    const world = new World([new Ball(0, -0.9, 0), new Ball(1, 0.5, 0)]);
    const events: PhysicsEvent[] = [];
    world.on((e) => events.push(e));
    world.strike(0, { angle: 0, speed: PHYSICS.maxCueSpeed * 1.5 });
    world.step();
    world.step();
    world.step();
    world.step(); // 1.4 m at 15 m/s needs ~22 steps of 1/240 s; run a few and then the rest
    runToRest(world);
    expect(events.some((e) => e.type === 'ballBall')).toBe(true);
  });
});

describe('cushions & pockets', () => {
  test('straight into a cushion: rebounds with restitution, stays on the table', () => {
    const b = stunBall(0, 0.5, 0.2, 2);
    const world = new World([b]);
    let speed = 0;
    world.on((e) => {
      if (e.type === 'ballCushion') speed = e.speed;
    });
    runToRest(world);
    expect(speed).toBeGreaterThan(1.4); // cloth friction over the 0.46 m run
    expect(speed).toBeLessThan(2);
    expect(b.x).toBeLessThan(TABLE.length / 2 - R + 1e-9);
    expect(world.escapes).toBe(0);
  });

  test('a ball sent at a corner pocket drops', () => {
    const world = new World([new Ball(0, 0, 0)]);
    const pockets: number[] = [];
    world.on((e) => {
      if (e.type === 'pocketed') pockets.push(e.pocket);
    });
    world.strike(0, { angle: Math.atan2(TABLE.width / 2, TABLE.length / 2), speed: 2 });
    runToRest(world);
    expect(pockets).toEqual([0]);
  });

  test('a ball rolling along the long cushion past the side pocket does not drop', () => {
    const world = new World([new Ball(0, -0.6, TABLE.width / 2 - R - 0.0005)]);
    const pockets: number[] = [];
    world.on((e) => {
      if (e.type === 'pocketed') pockets.push(e.pocket);
    });
    world.strike(0, { angle: 0, speed: 1.5, top: 0.8 });
    runToRest(world);
    expect(pockets).toEqual([0]); // rolls past the side (4) into the far corner (0)
  });
});

describe('whole-table invariants', () => {
  test('break: everything comes to rest, nothing overlaps or escapes', () => {
    const world = rackWorld();
    world.strike(0, BREAK);
    const steps = runToRest(world, () => assertNoOverlaps(world));
    expect(steps).toBeLessThan(MAX_STEPS);
    expect(world.escapes).toBe(0);
    const moved = world.balls.filter((b) => {
      const start = triangleRack().find((p) => p.number === b.id)!;
      return b.state === 'pocketed' || Math.hypot(b.x - start.x, b.z - start.z) > 0.1;
    });
    expect(moved.length).toBeGreaterThan(10);
  });

  test('energy never increases', () => {
    const world = rackWorld();
    world.strike(0, BREAK);
    let prev = world.balls.reduce((s, b) => s + kineticEnergy(b), 0);
    runToRest(world, () => {
      const e = world.balls.reduce((s, b) => s + kineticEnergy(b), 0);
      expect(e).toBeLessThanOrEqual(prev + 1e-9);
      prev = e;
    });
  });

  test('determinism: the same break twice gives identical results', () => {
    const snap = () => {
      const w = rackWorld();
      let events = 0;
      w.on(() => events++);
      w.strike(0, BREAK);
      runToRest(w);
      return JSON.stringify({ balls: w.balls, events, time: w.time });
    };
    expect(snap()).toBe(snap());
  });

  test('stress: random max-power shots with spin never tunnel or escape', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
    for (let k = 0; k < 15; k++) {
      const world = rackWorld();
      world.strike(0, {
        angle: rand() * Math.PI,
        speed: PHYSICS.maxCueSpeed,
        side: rand(),
        top: rand(),
      });
      runToRest(world, () => assertNoOverlaps(world));
      expect(world.escapes).toBe(0);
      for (const b of world.balls)
        if (b.state !== 'pocketed') {
          expect(Math.abs(b.x)).toBeLessThan(TABLE.length / 2);
          expect(Math.abs(b.z)).toBeLessThan(TABLE.width / 2);
        }
    }
  });
});
