import type { ShotResult } from './ShotResult';

export type Group = 'solids' | 'stripes';
export type Player = 0 | 1;
export type BallInHand = 'none' | 'kitchen' | 'anywhere';

export const groupOf = (n: number): Group | null =>
  n >= 1 && n <= 7 ? 'solids' : n >= 9 && n <= 15 ? 'stripes' : null;

export interface RulesState {
  current: Player;
  /** Per player; null while the table is open. */
  groups: [Group | null, Group | null];
  isBreak: boolean;
  /** Object balls still on the table. */
  onTable: number[];
  winner: Player | null;
}

export interface RulesOptions {
  eightOnBreak: 'win' | 'respot';
  scratchOnBreak: 'kitchen' | 'anywhere';
}
export const DEFAULT_OPTIONS: RulesOptions = { eightOnBreak: 'win', scratchOnBreak: 'kitchen' };

export interface Outcome {
  state: RulesState;
  ballInHand: BallInHand;
  /** Foul committed by the shooter, if any. */
  foul: string | null;
  /** Short description of anything else notable (groups assigned, game end reason). */
  note: string | null;
  respotEight: boolean;
  /** Illegal break: re-rack, and the opponent breaks. */
  rerack: boolean;
}

export function newGame(breaker: Player = 0): RulesState {
  return {
    current: breaker,
    groups: [null, null],
    isBreak: true,
    onTable: Array.from({ length: 15 }, (_, i) => i + 1),
    winner: null,
  };
}

/** Balls the shooter may hit first: their group, the 8 once that's cleared, any but the 8 when open. */
export function legalTargets(s: RulesState): number[] {
  const g = s.groups[s.current];
  if (!g) return s.onTable.filter((n) => n !== 8);
  const mine = s.onTable.filter((n) => groupOf(n) === g);
  return mine.length ? mine : [8];
}

const other = (g: Group): Group => (g === 'solids' ? 'stripes' : 'solids');

/** WPA-style 8-ball (no call-pocket): decide the shot's consequences. */
export function judge(s: RulesState, shot: ShotResult, opts = DEFAULT_OPTIONS): Outcome {
  const p = s.current;
  const opp: Player = p === 0 ? 1 : 0;
  const scratch = shot.pocketed.includes(0);
  const potted = shot.pocketed.filter((n) => n !== 0);
  const next: RulesState = {
    ...s,
    groups: [...s.groups],
    isBreak: false,
    onTable: s.onTable.filter((n) => !potted.includes(n)),
  };
  const out = (o: Partial<Outcome>): Outcome => ({
    state: next,
    ballInHand: 'none',
    foul: null,
    note: null,
    respotEight: false,
    rerack: false,
    ...o,
  });
  const gameOver = (winner: Player, note: string) => {
    next.winner = winner;
    return out({ note });
  };

  if (s.isBreak) {
    let respotEight = false;
    if (potted.includes(8)) {
      if (!scratch && opts.eightOnBreak === 'win') return gameOver(p, '8 on the break');
      next.onTable.push(8);
      respotEight = true;
    }
    if (scratch) {
      next.current = opp;
      return out({ foul: 'Scratch on the break', ballInHand: opts.scratchOnBreak, respotEight });
    }
    if (potted.length === 0 && shot.objectBallsToCushion < 4) {
      return out({ state: newGame(opp), rerack: true, foul: 'Illegal break' });
    }
    // the table stays open after the break; potting anything keeps the turn
    next.current = potted.length > 0 ? p : opp;
    return out({ respotEight, note: respotEight ? '8 re-spotted' : null });
  }

  const targets = legalTargets(s);
  const onEight = s.groups[p] !== null && targets[0] === 8;
  let foul: string | null = null;
  if (scratch) foul = 'Scratch';
  else if (shot.firstContact === null) foul = 'No ball hit';
  else if (!targets.includes(shot.firstContact))
    foul = shot.firstContact === 8 ? 'Hit the 8 first' : 'Wrong ball hit first';
  else if (potted.length === 0 && !shot.cushionAfterContact) foul = 'No cushion after contact';

  if (potted.includes(8)) {
    if (onEight && !foul) return gameOver(p, 'Potted the 8');
    return gameOver(opp, foul ? `Fouled on the 8 (${foul.toLowerCase()})` : 'Potted the 8 early');
  }

  if (foul) {
    next.current = opp;
    return out({ foul, ballInHand: 'anywhere' });
  }

  let note: string | null = null;
  if (!next.groups[p]) {
    const first = potted.map(groupOf).find((g) => g !== null);
    if (first) {
      next.groups = p === 0 ? [first, other(first)] : [other(first), first];
      note = `Takes ${first}`;
    }
  }
  const mine = next.groups[p];
  next.current = mine && potted.some((n) => groupOf(n) === mine) ? p : opp;
  return out({ note });
}
