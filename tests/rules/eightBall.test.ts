import { describe, expect, test } from 'vitest';
import { judge, legalTargets, newGame, type RulesState } from '../../src/rules/EightBallRules';
import { ShotRecorder, type ShotResult } from '../../src/rules/ShotResult';

const shot = (o: Partial<ShotResult> = {}): ShotResult => ({
  firstContact: 1,
  pocketed: [],
  cushionAfterContact: true,
  objectBallsToCushion: 0,
  ...o,
});

/** Mid-game: player 0 solids, player 1 stripes. */
const midGame = (o: Partial<RulesState> = {}): RulesState => ({
  ...newGame(0),
  isBreak: false,
  groups: ['solids', 'stripes'],
  ...o,
});

describe('break', () => {
  test('potting a ball keeps the turn and leaves the table open', () => {
    const o = judge(newGame(0), shot({ pocketed: [3, 12] }));
    expect(o.state.current).toBe(0);
    expect(o.state.groups).toEqual([null, null]);
    expect(o.state.isBreak).toBe(false);
    expect(o.state.onTable).not.toContain(3);
  });

  test('nothing potted but 4 balls to a cushion is legal; turn passes', () => {
    const o = judge(newGame(0), shot({ objectBallsToCushion: 4 }));
    expect(o.foul).toBeNull();
    expect(o.rerack).toBe(false);
    expect(o.state.current).toBe(1);
  });

  test('fewer than 4 balls to a cushion and nothing potted: illegal, opponent re-breaks', () => {
    const o = judge(newGame(0), shot({ objectBallsToCushion: 3 }));
    expect(o.rerack).toBe(true);
    expect(o.state).toEqual(newGame(1));
  });

  test('8 on the break wins by default', () => {
    const o = judge(newGame(0), shot({ pocketed: [8] }));
    expect(o.state.winner).toBe(0);
  });

  test('8 on the break re-spots when configured, shooter continues', () => {
    const o = judge(newGame(0), shot({ pocketed: [8] }), {
      eightOnBreak: 'respot',
      scratchOnBreak: 'kitchen',
    });
    expect(o.state.winner).toBeNull();
    expect(o.respotEight).toBe(true);
    expect(o.state.onTable).toContain(8);
    expect(o.state.current).toBe(0);
  });

  test('8 and a scratch on the break: re-spot the 8, opponent has ball in hand behind the line', () => {
    const o = judge(newGame(0), shot({ pocketed: [8, 0] }));
    expect(o.state.winner).toBeNull();
    expect(o.respotEight).toBe(true);
    expect(o.foul).toBe('Scratch on the break');
    expect(o.ballInHand).toBe('kitchen');
    expect(o.state.current).toBe(1);
  });

  test('scratch on the break: ball in hand behind the head string (or anywhere, if configured)', () => {
    expect(judge(newGame(0), shot({ pocketed: [0] })).ballInHand).toBe('kitchen');
    const o = judge(newGame(0), shot({ pocketed: [0] }), {
      eightOnBreak: 'win',
      scratchOnBreak: 'anywhere',
    });
    expect(o.ballInHand).toBe('anywhere');
  });
});

describe('open table', () => {
  const open = midGame({ groups: [null, null] });

  test('first legally potted ball assigns groups', () => {
    const o = judge({ ...open, current: 1 }, shot({ firstContact: 2, pocketed: [10, 3] }));
    expect(o.state.groups).toEqual(['solids', 'stripes']);
    expect(o.state.current).toBe(1);
    expect(o.note).toBe('Takes stripes');
  });

  test('any solid or stripe may be hit first', () => {
    expect(judge(open, shot({ firstContact: 13 })).foul).toBeNull();
  });

  test('hitting the 8 first is a foul', () => {
    expect(judge(open, shot({ firstContact: 8 })).foul).toBe('Hit the 8 first');
  });

  test('a foul does not assign groups', () => {
    const o = judge(open, shot({ pocketed: [3, 0] }));
    expect(o.state.groups).toEqual([null, null]);
  });
});

describe('fouls give the opponent ball in hand anywhere', () => {
  const cases: [string, Partial<ShotResult>, string][] = [
    ['scratch', { pocketed: [0] }, 'Scratch'],
    ['no contact', { firstContact: null, cushionAfterContact: false }, 'No ball hit'],
    ['wrong group first', { firstContact: 12 }, 'Wrong ball hit first'],
    ['8 first while group remains', { firstContact: 8 }, 'Hit the 8 first'],
    ['no cushion after contact', { cushionAfterContact: false }, 'No cushion after contact'],
  ];
  for (const [name, s, foul] of cases)
    test(name, () => {
      const o = judge(midGame(), shot(s));
      expect(o.foul).toBe(foul);
      expect(o.ballInHand).toBe('anywhere');
      expect(o.state.current).toBe(1);
    });

  test('potting a ball counts instead of a cushion', () => {
    expect(judge(midGame(), shot({ cushionAfterContact: false, pocketed: [2] })).foul).toBeNull();
  });

  test('potted balls stay down even on a foul', () => {
    expect(judge(midGame(), shot({ pocketed: [2, 0] })).state.onTable).not.toContain(2);
  });
});

describe('turns', () => {
  test('potting your own ball keeps the turn', () => {
    expect(judge(midGame(), shot({ pocketed: [4] })).state.current).toBe(0);
  });

  test("potting only the opponent's ball passes the turn (no foul)", () => {
    const o = judge(midGame(), shot({ pocketed: [9] }));
    expect(o.foul).toBeNull();
    expect(o.state.current).toBe(1);
  });

  test('a legal miss passes the turn', () => {
    expect(judge(midGame(), shot()).state.current).toBe(1);
  });
});

describe('the 8', () => {
  const onEight = midGame({ onTable: [8, 9, 10] }); // player 0 has cleared the solids

  test('once the group is cleared, the 8 is the only legal target', () => {
    expect(legalTargets(onEight)).toEqual([8]);
    expect(judge(onEight, shot({ firstContact: 9 })).foul).toBe('Wrong ball hit first');
  });

  test('legally potting the 8 wins', () => {
    const o = judge(onEight, shot({ firstContact: 8, pocketed: [8] }));
    expect(o.state.winner).toBe(0);
  });

  test('potting the 8 and scratching loses', () => {
    const o = judge(onEight, shot({ firstContact: 8, pocketed: [8, 0] }));
    expect(o.state.winner).toBe(1);
  });

  test('potting the 8 early loses', () => {
    const o = judge(midGame(), shot({ pocketed: [8] }));
    expect(o.state.winner).toBe(1);
    expect(o.note).toBe('Potted the 8 early');
  });

  test('potting the last group ball and the 8 together loses', () => {
    const o = judge(midGame({ onTable: [7, 8, 9] }), shot({ firstContact: 7, pocketed: [7, 8] }));
    expect(o.state.winner).toBe(1);
  });

  test('potting the 8 on an open table loses', () => {
    const o = judge(midGame({ groups: [null, null] }), shot({ pocketed: [8] }));
    expect(o.state.winner).toBe(1);
  });
});

describe('ShotRecorder', () => {
  test('builds a result from physics events', () => {
    const r = new ShotRecorder();
    r.record({ type: 'cueHit', ball: 0, speed: 3 });
    r.record({ type: 'ballCushion', ball: 0, speed: 1 }); // before contact: not counted
    r.record({ type: 'ballBall', a: 5, b: 0, speed: 2 });
    r.record({ type: 'ballBall', a: 5, b: 6, speed: 1 });
    r.record({ type: 'ballCushion', ball: 6, speed: 1 });
    r.record({ type: 'ballCushion', ball: 6, speed: 1 });
    r.record({ type: 'pocketed', ball: 5, pocket: 2 });
    expect(r.result).toEqual({
      firstContact: 5,
      pocketed: [5],
      cushionAfterContact: true,
      objectBallsToCushion: 1,
    });
    r.reset();
    expect(r.result.firstContact).toBeNull();
  });
});
