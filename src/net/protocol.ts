// Messages between the game client and the room server, and their validators.
// Shared by both sides: no runtime imports, so Node can run it with type stripping.

export type Seat = 0 | 1;

export const CODE_LENGTH = 5;
/** No 0/O, 1/I/L: codes are read aloud and typed by hand. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const NAME_MAX = 20;

export interface AimMsg {
  angle: number;
  power: number;
  side: number;
  top: number;
}
/** Shot inputs plus where the cue ball is (covers ball in hand). */
export interface ShotMsg extends AimMsg {
  cue: [x: number, z: number];
}
export interface PlaceMsg {
  x: number;
  z: number;
}

export interface BallSnap {
  id: number;
  x: number;
  z: number;
  pocketed: boolean;
}
export interface RulesSnap {
  current: Seat;
  groups: ['solids' | 'stripes' | null, 'solids' | 'stripes' | null];
  isBreak: boolean;
  onTable: number[];
  winner: Seat | null;
}
/** Table and rules after a shot, from the shooter (the other client snaps to it). */
export interface Snapshot {
  balls: BallSnap[];
  rules: RulesSnap;
  phase: 'ballInHand' | 'aiming' | 'gameOver';
  inHand: 'none' | 'kitchen' | 'anywhere';
  message: string;
}

/** Sent to each player when a game (or rematch) starts. */
export interface ReadyMsg {
  seat: Seat;
  names: [string, string];
  seed: number;
  breaker: Seat;
}
export interface ResumeMsg {
  ready: ReadyMsg;
  /** Last agreed table, or null if no shot has been settled yet (rebuild the rack from the seed). */
  snapshot: Snapshot | null;
}
export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// ---- validators (the server trusts nothing; the client re-checks what it receives) ----

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const TABLE_X = 1.2; // m: a little beyond the cushions; balls never sit further out
const TABLE_Z = 0.7;

/** Trimmed, control characters removed, at most NAME_MAX; null if nothing is left. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, NAME_MAX);
  return s || null;
}

export function cleanCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  if (s.length !== CODE_LENGTH) return null;
  for (const c of s) if (!CODE_ALPHABET.includes(c)) return null;
  return s;
}

export function isAim(v: unknown): v is AimMsg {
  return (
    isObj(v) &&
    num(v.angle, -10, 10) &&
    num(v.power, 0, 1) &&
    num(v.side, -1, 1) &&
    num(v.top, -1, 1) &&
    Math.hypot(v.side, v.top) <= 1 + 1e-9
  );
}

export function isShot(v: unknown): v is ShotMsg {
  return (
    isAim(v) &&
    (v as ShotMsg).power > 0 &&
    Array.isArray((v as ShotMsg).cue) &&
    (v as ShotMsg).cue.length === 2 &&
    num((v as ShotMsg).cue[0], -TABLE_X, TABLE_X) &&
    num((v as ShotMsg).cue[1], -TABLE_Z, TABLE_Z)
  );
}

export function isPlace(v: unknown): v is PlaceMsg {
  return isObj(v) && num(v.x, -TABLE_X, TABLE_X) && num(v.z, -TABLE_Z, TABLE_Z);
}

const isSeat = (v: unknown): v is Seat => v === 0 || v === 1;
const isGroup = (v: unknown) => v === null || v === 'solids' || v === 'stripes';

export function isSnapshot(v: unknown): v is Snapshot {
  if (!isObj(v) || !Array.isArray(v.balls) || v.balls.length !== 16) return false;
  const ids = new Set<number>();
  for (const b of v.balls) {
    if (!isObj(b) || !Number.isInteger(b.id) || !num(b.id, 0, 15) || ids.has(b.id as number))
      return false;
    ids.add(b.id as number);
    if (typeof b.pocketed !== 'boolean') return false;
    if (b.pocketed ? !num(b.x, -100, 100) || !num(b.z, -100, 100) : !isPlace(b)) return false;
  }
  const r = v.rules;
  if (
    !isObj(r) ||
    !isSeat(r.current) ||
    !(r.winner === null || isSeat(r.winner)) ||
    typeof r.isBreak !== 'boolean' ||
    !Array.isArray(r.groups) ||
    r.groups.length !== 2 ||
    !r.groups.every(isGroup) ||
    !Array.isArray(r.onTable) ||
    r.onTable.length > 15 ||
    !r.onTable.every((n) => Number.isInteger(n) && num(n, 1, 15))
  )
    return false;
  return (
    ['ballInHand', 'aiming', 'gameOver'].includes(v.phase as string) &&
    ['none', 'kitchen', 'anywhere'].includes(v.inHand as string) &&
    typeof v.message === 'string' &&
    v.message.length <= 300
  );
}
