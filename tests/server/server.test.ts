import { afterAll, beforeAll, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { createGameServer } from '../../server/server.ts';
import { Rooms, RECONNECT_GRACE_MS, WAITING_MAX_MS } from '../../server/rooms.ts';
import { isSnapshot, type ReadyMsg, type Snapshot } from '../../src/net/protocol.ts';

const snapshot = (current: 0 | 1): Snapshot => ({
  balls: Array.from({ length: 16 }, (_, id) => ({ id, x: id * 0.05 - 0.4, z: 0, pocketed: false })),
  rules: { current, groups: [null, null], isBreak: false, onTable: [1, 2, 3], winner: null },
  phase: 'aiming',
  inHand: 'none',
  message: '',
});

test('rooms: turn order, settle passes the turn, expiry', () => {
  const rooms = new Rooms();
  const r = rooms.create('Ann', 'a', 0);
  expect(r.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}$/);
  expect(rooms.canAct(r, 0)).toBe(false); // nobody joined yet
  expect(rooms.join(r.code, 'Bob', 'b').ok).toBe(true);
  expect(rooms.join(r.code, 'Cy', 'c')).toEqual({ ok: false, error: 'That room is full' });
  expect(r.turn).toBe(0); // host breaks first
  expect(rooms.shoot(r, 1)).toBe(false);
  expect(rooms.shoot(r, 0)).toBe(true);
  expect(rooms.shoot(r, 0)).toBe(false); // waiting for the result
  expect(rooms.settle(r, 1, snapshot(1))).toBe(false); // only the shooter reports
  expect(rooms.settle(r, 0, snapshot(1))).toBe(true);
  expect(rooms.canAct(r, 1)).toBe(true);
  rooms.newRack(r);
  expect(r.turn).toBe(1); // breaks alternate

  expect(rooms.resume(r.code, 'wrong', 'x').ok).toBe(false);
  rooms.disconnect(r, 1, 1000);
  expect(rooms.expired(1000 + RECONNECT_GRACE_MS - 1)).toEqual([]);
  expect(rooms.resume(r.code, r.players[1]!.token, 'b2').ok).toBe(true);
  expect(rooms.expired(1000 + RECONNECT_GRACE_MS + 1)).toEqual([]);

  const waiting = rooms.create('Dee', 'd', 0);
  expect(rooms.expired(WAITING_MAX_MS + 1)).toEqual([waiting]);
});

test('snapshot validation rejects bad tables', () => {
  expect(isSnapshot(snapshot(0))).toBe(true);
  const s = snapshot(0);
  s.balls[3]!.x = 5; // off the table but not pocketed
  expect(isSnapshot(s)).toBe(false);
  expect(isSnapshot({ ...snapshot(0), balls: snapshot(0).balls.slice(1) })).toBe(false);
  expect(isSnapshot({ ...snapshot(0), rules: { ...snapshot(0).rules, current: 2 } })).toBe(false);
});

// ---- end to end over real sockets ----

let server: ReturnType<typeof createGameServer>;
let url = '';
const sockets: Socket[] = [];
beforeAll(async () => {
  server = createGameServer({ origins: [] });
  await new Promise<void>((r) => server.http.listen(0, r));
  url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
});
afterAll(() => {
  sockets.forEach((s) => s.close());
  server.close();
});

const client = async () => {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  await new Promise<void>((r) => s.once('connect', () => r()));
  return s;
};
const next = <T>(s: Socket, event: string, ms = 1000) =>
  new Promise<T | 'timeout'>((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms);
    s.once(event, (m: T) => {
      clearTimeout(t);
      resolve(m);
    });
  });
const call = (s: Socket, event: string, msg: unknown) =>
  s.timeout(1000).emitWithAck(event, msg) as Promise<Record<string, unknown>>;

test('two players: create, join, turn-checked relay, settle, disconnect', async () => {
  const a = await client();
  const b = await client();
  const created = await call(a, 'room:create', { name: '  Ann\u0007 ' });
  expect(created.ok).toBe(true);
  const code = created.code as string;

  expect(await call(b, 'room:join', { code: 'ZZZZZ', name: 'Bob' })).toMatchObject({ ok: false });
  expect(await call(b, 'room:join', { code, name: '' })).toMatchObject({ ok: false });
  const readyA = next<ReadyMsg>(a, 'room:ready');
  const readyB = next<ReadyMsg>(b, 'room:ready');
  expect(await call(b, 'room:join', { code: code.toLowerCase(), name: 'Bob' })).toMatchObject({
    ok: true,
  });
  const [ra, rb] = (await Promise.all([readyA, readyB])) as ReadyMsg[];
  expect(ra).toMatchObject({ seat: 0, names: ['Ann', 'Bob'], breaker: 0 });
  expect(rb).toMatchObject({ seat: 1, seed: ra!.seed });

  const shot = { angle: 0.1, power: 0.8, side: 0, top: 0.2, cue: [-0.5, 0] };
  // not B's turn: dropped
  const nothing = next(a, 'game:shoot', 200);
  b.emit('game:shoot', shot);
  expect(await nothing).toBe('timeout');
  // invalid payload from A: dropped
  const invalid = next(b, 'game:shoot', 200);
  a.emit('game:shoot', { ...shot, power: 7 });
  expect(await invalid).toBe('timeout');
  // A aims and shoots: relayed
  const aim = next(b, 'game:aim');
  a.emit('game:aim', { angle: 1, power: 0, side: 0, top: 0 });
  expect(await aim).toMatchObject({ angle: 1 });
  const got = next(b, 'game:shoot');
  a.emit('game:shoot', shot);
  expect(await got).toEqual(shot);
  // a second shot before the result is in: dropped
  const again = next(b, 'game:shoot', 200);
  a.emit('game:shoot', shot);
  expect(await again).toBe('timeout');
  // A reports the result, the turn passes to B
  const settled = next(b, 'game:settled');
  a.emit('game:settled', snapshot(1));
  expect(await settled).toMatchObject({ rules: { current: 1 } });
  const bShot = next(a, 'game:shoot');
  b.emit('game:shoot', shot);
  expect(await bShot).toEqual(shot);

  // a third player can't get in
  const c = await client();
  expect(await call(c, 'room:join', { code, name: 'Cy' })).toMatchObject({ ok: false });
  expect(await call(c, 'room:resume', { code, token: 'nope' })).toMatchObject({ ok: false });

  const left = next(a, 'room:opponentLeft');
  b.close();
  expect(await left).toMatchObject({ graceMs: RECONNECT_GRACE_MS });
});

test('origin allowlist also applies to websocket connections', async () => {
  const strict = createGameServer({ origins: ['https://game.example'] });
  await new Promise<void>((r) => strict.http.listen(0, r));
  const base = `http://localhost:${(strict.http.address() as AddressInfo).port}`;
  const attempt = (origin: string) =>
    new Promise<string>((resolve) => {
      const s = connect(base, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        extraHeaders: { origin },
      });
      s.on('connect', () => (s.close(), resolve('connected')));
      s.on('connect_error', () => (s.close(), resolve('refused')));
    });
  expect(await attempt('https://evil.example')).toBe('refused');
  expect(await attempt('https://game.example')).toBe('connected');
  strict.close();
});
