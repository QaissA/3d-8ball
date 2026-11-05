import { afterAll, beforeAll, expect, test } from 'vitest';
import { startWorker } from '../server/worker';
import { Game } from '../../src/game/GameStateMachine';
import type { ShotInput } from '../../src/input/ShotInput';
import { OnlineGame } from '../../src/net/OnlineGame';
import type { ReadyMsg } from '../../src/net/protocol';
import { PHYSICS } from '../../src/config/physics';

// Two full clients (game + online session) against the real server, with a stand-in for the
// mouse/keyboard input and the render loop.

let server: Awaited<ReturnType<typeof startWorker>>;
let url = '';
beforeAll(async () => {
  server = await startWorker();
  url = server.url;
}, 60_000);
afterAll(() => server?.worker.stop());

interface Player {
  game: Game;
  input: ShotInput;
  online: OnlineGame;
  ready: ReadyMsg | null;
}

function player(): Player {
  const game = new Game();
  const input = { angle: 0, power: 0, side: 0, top: 0, phase: 'aiming', onRelease() {} };
  const p: Player = { game, input: input as unknown as ShotInput, online: null!, ready: null };
  p.online = new OnlineGame(url, game, p.input, {
    onReady(r) {
      p.ready = r;
      game.newRack(r.breaker, r.seed);
    },
    afterRestore() {},
    onStatus() {},
    onClosed() {},
  });
  return p;
}

/** One frame of main.ts's loop, minus rendering: physics, rules, network, strike. */
function frame(p: Player, now: number) {
  for (let i = 0; i < 40 && p.game.world.isMoving(); i++) p.game.world.step();
  p.game.update();
  p.online.tick(now);
  if (p.input.phase === 'striking') {
    p.game.shoot({
      angle: p.input.angle,
      speed: PHYSICS.maxCueSpeed * p.input.power ** 1.5,
      side: p.input.side,
      top: p.input.top,
    });
    p.input.phase = 'aiming';
    p.input.power = 0;
  }
}

async function runUntil(players: Player[], done: () => boolean, ms = 20_000) {
  const start = Date.now();
  let now = 0;
  while (!done()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    for (const p of players) frame(p, (now += 16));
    await new Promise((r) => setTimeout(r, 2));
  }
}

const table = (g: Game) => JSON.stringify(g.snapshot());
const idle = (p: Player) => p.game.phase !== 'rolling' && p.input.phase !== 'striking';

test('online: both clients play the same game shot by shot', async () => {
  const a = player();
  const b = player();
  const code = await a.online.create('Ann');
  await b.online.join(code, 'Bob');
  await runUntil([a, b], () => a.ready !== null && b.ready !== null);
  expect(a.ready!.seat).toBe(0);
  expect(b.ready!.seat).toBe(1);
  expect(table(a.game)).toBe(table(b.game)); // same seed, same rack

  // A breaks: place the cue ball, take the shot as main.ts does
  expect(a.online.myTurn).toBe(true);
  expect(b.online.myTurn).toBe(false);
  a.game.placeCueBall();
  Object.assign(a.input, { angle: 0.01, power: 0.9, side: 0, top: 0, phase: 'striking' });
  a.online.sendShot();
  frame(a, 0);
  expect(a.game.phase).toBe('rolling');

  // both tables come to rest identically and the turn agrees on both sides
  await runUntil(
    [a, b],
    () =>
      idle(a) &&
      idle(b) &&
      !a.online.myTurn === !!b.online.myTurn &&
      table(a.game) === table(b.game),
  );
  expect(b.game.rules.current).toBe(a.game.rules.current);
  expect(b.game.rules.isBreak).toBe(false); // B simulated the break itself (divergences stay 0)

  let shots = 0;

  // a few more shots by whoever is up, straight down the table at moderate power
  for (let shot = 0; shot < 3 && a.game.phase !== 'gameOver'; shot++) {
    const p = a.online.myTurn ? a : b;
    const other = p === a ? b : a;
    if (p.game.phase === 'ballInHand') {
      p.game.moveCueBall(-0.5, 0.1);
      p.game.placeCueBall();
    }
    Object.assign(p.input, {
      angle: 0.3 * shot,
      power: 0.5,
      side: 0.2,
      top: -0.3,
      phase: 'striking',
    });
    p.online.sendShot();
    frame(p, 0);
    await runUntil(
      [a, b],
      () =>
        idle(a) &&
        idle(b) &&
        (a.online.myTurn || b.online.myTurn || a.game.phase === 'gameOver') &&
        table(a.game) === table(b.game),
    );
    expect(other.game.rules.current).toBe(p.game.rules.current);
    shots++;
  }
  expect(shots).toBeGreaterThan(0);
  // same engine on both sides: never needed a correction
  expect(a.online.divergences + b.online.divergences).toBe(0);

  a.online.leave();
  b.online.leave();
}, 60_000);
