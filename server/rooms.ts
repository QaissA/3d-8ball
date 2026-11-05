import { CODE_ALPHABET, CODE_LENGTH, type Seat, type Snapshot } from '../src/net/protocol';

export const RECONNECT_GRACE_MS = 60_000;
export const WAITING_MAX_MS = 10 * 60_000; // a room nobody joined
export const ROOM_MAX_MS = 2 * 60 * 60_000;

export interface Player {
  name: string;
  token: string;
  connected: boolean;
  leftAt: number;
}

/** One room's state. Plain data: the Durable Object stores it as is. */
export interface Room {
  code: string;
  players: [Player, Player | null];
  createdAt: number;
  seed: number;
  breaker: Seat;
  /** Whose shot it is, as last agreed (start of game, or the shooter's settled snapshot). */
  turn: Seat;
  /** A shot was taken; nobody may act until the shooter reports where the balls stopped. */
  awaitingSettle: boolean;
  snapshot: Snapshot | null;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

// Web Crypto: available in Workers and in Node
const random32 = () => crypto.getRandomValues(new Uint32Array(1))[0]!;
const newToken = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** shortcut: modulo bias of 2^32 % 31 is ~1e-8, irrelevant for room codes. */
export const newCode = () =>
  Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[random32() % CODE_ALPHABET.length]).join(
    '',
  );

const player = (name: string): Player => ({ name, token: newToken(), connected: true, leftAt: 0 });

export function createRoom(code: string, name: string, now: number): Room {
  return {
    code,
    players: [player(name), null],
    createdAt: now,
    seed: 0,
    breaker: 1, // newRack alternates, so the host breaks first
    turn: 0,
    awaitingSettle: false,
    snapshot: null,
  };
}

export function joinRoom(room: Room, name: string): Result<{ token: string }> {
  if (room.players[1]) return { ok: false, error: 'That room is full' };
  const p = player(name);
  room.players[1] = p;
  newRack(room);
  return { ok: true, token: p.token };
}

/** Seat that owns this reconnect token, or null. */
export function seatOfToken(room: Room, token: string): Seat | null {
  const i = room.players.findIndex((p) => p !== null && p.token === token);
  return i < 0 ? null : (i as Seat);
}

/** New game in the room: fresh seed, breaks alternate. */
export function newRack(room: Room): void {
  room.seed = random32();
  room.breaker = room.breaker === 0 ? 1 : 0;
  room.turn = room.breaker;
  room.awaitingSettle = false;
  room.snapshot = null;
}

/** Aim, place and shoot are only for the player whose turn it is, between shots. */
export function canAct(room: Room, seat: Seat): boolean {
  return room.players[1] !== null && room.turn === seat && !room.awaitingSettle;
}

export function shoot(room: Room, seat: Seat): boolean {
  if (!canAct(room, seat)) return false;
  room.awaitingSettle = true;
  return true;
}

/** The shooter reports the result; the turn passes as their rules decided. */
export function settle(room: Room, seat: Seat, snapshot: Snapshot): boolean {
  if (!room.awaitingSettle || room.turn !== seat) return false;
  room.snapshot = snapshot;
  room.turn = snapshot.rules.current;
  room.awaitingSettle = false;
  return true;
}

export function setConnected(room: Room, seat: Seat, connected: boolean, now: number): void {
  const p = room.players[seat]!;
  p.connected = connected;
  if (!connected) p.leftAt = now;
}

/** When the room must close: too old, nobody joined in time, or a player gone past the grace period. */
export function closesAt(room: Room): number {
  let t = room.createdAt + ROOM_MAX_MS;
  if (!room.players[1]) t = Math.min(t, room.createdAt + WAITING_MAX_MS);
  for (const p of room.players)
    if (p && !p.connected) t = Math.min(t, p.leftAt + RECONNECT_GRACE_MS);
  return t;
}
