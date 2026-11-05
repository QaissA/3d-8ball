import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  type Ack,
  cleanCode,
  cleanName,
  isAim,
  isPlace,
  isShot,
  isSnapshot,
  type ReadyMsg,
  type ResumeMsg,
  type Seat,
} from '../src/net/protocol.ts';
import { RECONNECT_GRACE_MS, type Room, Rooms } from './rooms.ts';

const MAX_MESSAGE_BYTES = 16_000; // a snapshot is ~2 KB
const BURST = 40; // messages
const PER_SECOND = 20; // sustained; aim and place updates are sent at ~10 Hz
const ROOM_OPS_PER_MINUTE = 20; // create/join/resume per IP: stops code guessing
const SWEEP_MS = 5_000;

type AckFn = (a: Ack<Record<string, unknown>>) => void;

/** Room server: creates/joins rooms by code and relays one game's messages between two players. */
export function createGameServer(opts: { origins: string[]; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const rooms = new Rooms();
  const http = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size }));
      return;
    }
    res.writeHead(404).end();
  });
  const io = new Server(http, {
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    cors: { origin: opts.origins.length ? opts.origins : true },
  });

  const roomOps = new Map<string, { n: number; since: number }>();
  const allowRoomOp = (ip: string) => {
    const t = now();
    const e = roomOps.get(ip);
    if (!e || t - e.since > 60_000) {
      roomOps.set(ip, { n: 1, since: t });
      return true;
    }
    return ++e.n <= ROOM_OPS_PER_MINUTE;
  };

  const ready = (room: Room, seat: Seat): ReadyMsg => ({
    seat,
    names: [room.players[0].name, room.players[1]?.name ?? ''],
    seed: room.seed,
    breaker: room.breaker,
  });
  const toSeat = (room: Room, seat: Seat, event: string, payload?: unknown) => {
    const id = room.players[seat]?.socketId;
    if (id) io.to(id).emit(event, payload);
  };
  const startGame = (room: Room) => {
    toSeat(room, 0, 'room:ready', ready(room, 0));
    toSeat(room, 1, 'room:ready', ready(room, 1));
  };
  const close = (room: Room, reason: string, except?: Seat) => {
    for (const s of [0, 1] as const) if (s !== except) toSeat(room, s, 'room:closed', { reason });
    rooms.rooms.delete(room.code);
  };

  io.on('connection', (socket: Socket) => {
    const ip = socket.handshake.address;
    let room: Room | null = null;
    let tokens = BURST;
    let lastRefill = now();
    socket.use((_packet, next) => {
      const t = now();
      tokens = Math.min(BURST, tokens + ((t - lastRefill) / 1000) * PER_SECOND);
      lastRefill = t;
      if (--tokens < 0) return void socket.disconnect(true); // flooding
      next();
    });

    const mySeat = () => (room ? rooms.seatOf(room, socket.id) : null);
    const leaveCurrent = () => {
      if (!room) return;
      const seat = mySeat();
      if (seat !== null) close(room, 'Your opponent left the game', seat);
      room = null;
    };
    /** Room ops: the ack must be a function and the IP within its rate limit. */
    const roomOp =
      (fn: (msg: Record<string, unknown>, ack: AckFn) => void) => (msg: unknown, ack: unknown) => {
        if (typeof ack !== 'function') return;
        if (!allowRoomOp(ip))
          return void ack({ ok: false, error: 'Too many attempts, wait a minute' });
        fn(
          typeof msg === 'object' && msg !== null ? (msg as Record<string, unknown>) : {},
          ack as AckFn,
        );
      };

    socket.on(
      'room:create',
      roomOp((msg, ack) => {
        const name = cleanName(msg.name);
        if (!name) return ack({ ok: false, error: 'Enter a name' });
        leaveCurrent();
        room = rooms.create(name, socket.id, now());
        ack({ ok: true, code: room.code, token: room.players[0].token });
      }),
    );

    socket.on(
      'room:join',
      roomOp((msg, ack) => {
        const name = cleanName(msg.name);
        const code = cleanCode(msg.code);
        if (!name) return ack({ ok: false, error: 'Enter a name' });
        if (!code) return ack({ ok: false, error: 'Room codes are 5 letters or digits' });
        const r = rooms.rooms.get(code);
        if (r && r.players[0].socketId === socket.id)
          return ack({ ok: false, error: 'That is your own room' });
        leaveCurrent();
        const res = rooms.join(code, name, socket.id);
        if (!res.ok) return ack(res);
        room = res.room;
        ack({ ok: true, token: room.players[1]!.token });
        startGame(room);
      }),
    );

    socket.on(
      'room:resume',
      roomOp((msg, ack) => {
        const code = cleanCode(msg.code);
        if (!code || typeof msg.token !== 'string')
          return ack({ ok: false, error: 'Game not found' });
        const res = rooms.resume(code, msg.token, socket.id);
        if (!res.ok) return ack(res);
        room = res.room;
        const other: Seat = res.seat === 0 ? 1 : 0;
        // a shot in flight when someone dropped is discarded: both go back to the last agreed table
        const resync = room.awaitingSettle;
        room.awaitingSettle = false;
        const resume = (s: Seat): ResumeMsg => ({
          ready: ready(room!, s),
          snapshot: room!.snapshot,
        });
        ack({ ok: true, ...resume(res.seat) });
        toSeat(room, other, 'room:opponentBack');
        if (resync) toSeat(room, other, 'room:resync', resume(other));
      }),
    );

    socket.on('room:leave', leaveCurrent);

    /** Game messages: only in a full room, only from the player whose turn it is. */
    const relay = (event: string, valid: (v: unknown) => boolean, act?: (seat: Seat) => boolean) =>
      socket.on(event, (msg: unknown) => {
        const seat = mySeat();
        if (!room || seat === null || !valid(msg)) return;
        if (act ? !act(seat) : !rooms.canAct(room, seat)) return;
        toSeat(room, seat === 0 ? 1 : 0, event, msg);
      });
    relay('game:aim', isAim);
    relay('game:place', isPlace);
    relay('game:shoot', isShot, (seat) => rooms.shoot(room!, seat));
    socket.on('game:settled', (msg: unknown) => {
      const seat = mySeat();
      if (!room || seat === null || !isSnapshot(msg) || !rooms.settle(room, seat, msg)) return;
      toSeat(room, seat === 0 ? 1 : 0, 'game:settled', msg);
    });
    socket.on('game:rematch', () => {
      if (!room?.players[1] || mySeat() === null || room.awaitingSettle) return;
      rooms.newRack(room);
      startGame(room);
    });

    socket.on('disconnect', () => {
      const seat = mySeat();
      if (!room || seat === null) return;
      if (!room.players[1]) return void rooms.rooms.delete(room.code); // nobody joined yet
      rooms.disconnect(room, seat, now());
      toSeat(room, seat === 0 ? 1 : 0, 'room:opponentLeft', { graceMs: RECONNECT_GRACE_MS });
    });
  });

  const sweep = setInterval(() => {
    for (const r of rooms.expired(now())) close(r, 'The game ended: a player did not come back');
  }, SWEEP_MS);

  return {
    http,
    io,
    rooms,
    close: () => {
      clearInterval(sweep);
      io.close();
    },
  };
}
