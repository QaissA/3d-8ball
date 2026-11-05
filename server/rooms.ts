import { randomBytes, randomInt } from 'node:crypto';
import { CODE_ALPHABET, CODE_LENGTH, type Seat, type Snapshot } from '../src/net/protocol.ts';

export const RECONNECT_GRACE_MS = 60_000;
export const WAITING_MAX_MS = 10 * 60_000; // a room nobody joined
export const ROOM_MAX_MS = 2 * 60 * 60_000;

export interface Player {
  name: string;
  token: string;
  socketId: string | null; // null while disconnected
  leftAt: number;
}

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

const newToken = () => randomBytes(16).toString('hex');
const newSeed = () => randomInt(2 ** 32 - 1);

/** In-memory rooms: codes, seats, reconnect tokens and turn order. No sockets here. */
export class Rooms {
  readonly rooms = new Map<string, Room>();

  create(name: string, socketId: string, now: number): Room {
    let code: string;
    do {
      code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      players: [{ name, token: newToken(), socketId, leftAt: 0 }, null],
      createdAt: now,
      seed: 0,
      breaker: 1, // newRack alternates, so the host breaks first
      turn: 0,
      awaitingSettle: false,
      snapshot: null,
    };
    this.rooms.set(code, room);
    return room;
  }

  join(code: string, name: string, socketId: string): Result<{ room: Room }> {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'No room with that code' };
    if (room.players[1]) return { ok: false, error: 'That room is full' };
    room.players[1] = { name, token: newToken(), socketId, leftAt: 0 };
    this.newRack(room);
    return { ok: true, room };
  }

  resume(code: string, token: string, socketId: string): Result<{ room: Room; seat: Seat }> {
    const room = this.rooms.get(code);
    const seat = room?.players.findIndex((p) => p?.token === token);
    if (!room || seat === undefined || seat < 0) return { ok: false, error: 'Game not found' };
    room.players[seat]!.socketId = socketId;
    return { ok: true, room, seat: seat as Seat };
  }

  /** New game in the room: fresh seed, breaks alternate. */
  newRack(room: Room): void {
    room.seed = newSeed();
    room.breaker = room.breaker === 0 ? 1 : 0;
    room.turn = room.breaker;
    room.awaitingSettle = false;
    room.snapshot = null;
  }

  seatOf(room: Room, socketId: string): Seat | null {
    const i = room.players.findIndex((p) => p?.socketId === socketId);
    return i < 0 ? null : (i as Seat);
  }

  /** Aim, place and shoot are only for the player whose turn it is, between shots. */
  canAct(room: Room, seat: Seat): boolean {
    return room.players[1] !== null && room.turn === seat && !room.awaitingSettle;
  }

  shoot(room: Room, seat: Seat): boolean {
    if (!this.canAct(room, seat)) return false;
    room.awaitingSettle = true;
    return true;
  }

  /** The shooter reports the result; the turn passes as their rules decided. */
  settle(room: Room, seat: Seat, snapshot: Snapshot): boolean {
    if (!room.awaitingSettle || room.turn !== seat) return false;
    room.snapshot = snapshot;
    room.turn = snapshot.rules.current;
    room.awaitingSettle = false;
    return true;
  }

  disconnect(room: Room, seat: Seat, now: number): void {
    const p = room.players[seat]!;
    p.socketId = null;
    p.leftAt = now;
  }

  /** Rooms to close: a player gone past the grace period, nobody joined in time, or too old. */
  expired(now: number): Room[] {
    return [...this.rooms.values()].filter(
      (r) =>
        now - r.createdAt > ROOM_MAX_MS ||
        (!r.players[1] && now - r.createdAt > WAITING_MAX_MS) ||
        r.players.some((p) => p && p.socketId === null && now - p.leftAt > RECONNECT_GRACE_MS),
    );
  }
}
