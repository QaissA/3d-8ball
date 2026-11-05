import { expect, test } from 'vitest';
import { Game } from '../../src/game/GameStateMachine';
import { BALL_RADIUS as R, FOOT_SPOT_X, HEAD_SPOT_X, POCKETS } from '../../src/config/table';

function settle(game: Game) {
  for (let n = 0; n < 240 * 60 && game.phase === 'rolling'; n++) {
    game.world.step();
    game.update();
  }
}

test('break: must place behind the head string first, then the shot is judged', () => {
  const game = new Game(() => 42);
  expect(game.phase).toBe('ballInHand');
  expect(game.moveCueBall(0, 0)).toBe(true); // clamped back to the head string
  expect(game.cueBall.x).toBeCloseTo(HEAD_SPOT_X, 9);
  game.moveCueBall(HEAD_SPOT_X - 0.1, 0.1);
  expect(game.placeCueBall()).toBe(true);
  game.shoot({ angle: Math.atan2(-0.1, FOOT_SPOT_X - HEAD_SPOT_X + 0.1), speed: 9 });
  expect(game.phase).toBe('rolling');
  settle(game);
  expect(['aiming', 'ballInHand', 'gameOver']).toContain(game.phase);
  expect(game.rules.isBreak).toBe(false);
  expect(game.message).not.toBe('');
});

test('cannot place the cue ball on top of another ball', () => {
  const game = new Game(() => 1);
  game.inHand = 'anywhere';
  expect(game.moveCueBall(FOOT_SPOT_X + 0.01, 0)).toBe(false);
  expect(game.placeCueBall()).toBe(false);
  expect(game.phase).toBe('ballInHand');
});

test('weak break that reaches no cushion: re-rack, opponent breaks', () => {
  const game = new Game(() => 3);
  game.placeCueBall();
  game.shoot({ angle: 0, speed: 0.6 }); // just nudges the rack
  settle(game);
  expect(game.phase).toBe('ballInHand');
  expect(game.rules.isBreak).toBe(true);
  expect(game.rules.current).toBe(1);
  expect(game.message).toMatch(/Illegal break/);
});

test('scratch: opponent gets ball in hand anywhere and the cue ball is back on the table', () => {
  const game = new Game(() => 5);
  game.rules = { ...game.rules, isBreak: false, groups: ['solids', 'stripes'] };
  game.phase = 'aiming';
  // send the cue ball straight into the bottom-left corner pocket, clear of the rack
  const p = POCKETS[3]!;
  game.cueBall.x = p.x + 0.3;
  game.cueBall.z = p.z + 0.3;
  game.shoot({ angle: Math.atan2(-0.3, -0.3), speed: 2 });
  settle(game);
  expect(game.phase).toBe('ballInHand');
  expect(game.inHand).toBe('anywhere');
  expect(game.rules.current).toBe(1);
  expect(game.cueBall.state).toBe('stationary');
  expect(game.message).toMatch(/Foul by Player 1: Scratch/);
  // re-spotted cue ball is clear of other balls
  for (const b of game.world.balls)
    if (b.id !== 0 && b.state !== 'pocketed')
      expect(Math.hypot(b.x - game.cueBall.x, b.z - game.cueBall.z)).toBeGreaterThanOrEqual(2 * R);
});

test('practice: a scratch keeps the turn (with ball in hand) and re-racks stay with player 1', () => {
  const game = new Game(() => 5);
  game.practice = true;
  game.rules = { ...game.rules, isBreak: false, groups: ['solids', 'stripes'] };
  game.phase = 'aiming';
  const p = POCKETS[3]!;
  game.cueBall.x = p.x + 0.3;
  game.cueBall.z = p.z + 0.3;
  game.shoot({ angle: Math.atan2(-0.3, -0.3), speed: 2 });
  settle(game);
  expect(game.phase).toBe('ballInHand');
  expect(game.rules.current).toBe(0);
  game.newGame();
  game.newGame();
  expect(game.rules.current).toBe(0);
  expect(game.rules.isBreak).toBe(true);
});

test('snapshot / restore round trip (what the other player receives online)', () => {
  const game = new Game(() => 9);
  game.placeCueBall();
  game.shoot({ angle: 0.02, speed: 8 });
  settle(game);
  const snap = game.snapshot();
  const other = new Game(() => 9); // same seed: same rack
  other.restore(JSON.parse(JSON.stringify(snap)));
  expect(other.snapshot()).toEqual(snap);
  // restore copies, so later changes don't leak back into the snapshot
  other.rules.onTable.pop();
  expect(other.snapshot()).not.toEqual(snap);
  expect(game.snapshot()).toEqual(snap);
});
