import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  canAct,
  closesAt,
  createRoom,
  joinRoom,
  newCode,
  newRack,
  RECONNECT_GRACE_MS,
  seatOfToken,
  setConnected,
  settle,
  shoot,
  WAITING_MAX_MS,
} from '../../server/rooms';
import { isSnapshot, type ReadyMsg, type Snapshot } from '../../src/net/protocol';
import { startWorker } from './worker';

const snapshot = (current: 0 | 1): Snapshot => ({
  balls: Array.from({ length: 16 }, (_, id) => ({ id, x: id * 0.05 - 0.4, z: 0, pocketed: false })),
  rules: { current, groups: [null, null], isBreak: false, onTable: [1, 2, 3], winner: null },
  phase: 'aiming',
  inHand: 'none',
  message: '',
});

test('room rules: turn order, settle passes the turn, expiry', () => {
  expect(newCode()).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}$/);
  const r = createRoom('ABCDE', 'Ann', 0);
  expect(canAct(r, 0)).toBe(false); // nobody joined yet
  expect(closesAt(r)).toBe(WAITING_MAX_MS);
  const joined = joinRoom(r, 'Bob');
  expect(joined.ok).toBe(true);
  expect(joinRoom(r, 'Cy')).toEqual({ ok: false, error: 'That room is full' });
  expect(r.turn).toBe(0); // host breaks first
  expect(shoot(r, 1)).toBe(false);
  expect(shoot(r, 0)).toBe(true);
  expect(shoot(r, 0)).toBe(false); // waiting for the result
  expect(settle(r, 1, snapshot(1))).toBe(false); // only the shooter reports
  expect(settle(r, 0, snapshot(1))).toBe(true);
  expect(canAct(r, 1)).toBe(true);
  newRack(r);
  expect(r.turn).toBe(1); // breaks alternate

  expect(seatOfToken(r, 'wrong')).toBeNull();
  expect(seatOfToken(r, joined.ok ? joined.token : '')).toBe(1);
  setConnected(r, 1, false, 1000);
  expect(closesAt(r)).toBe(1000 + RECONNECT_GRACE_MS);
  setConnected(r, 1, true, 2000);
  expect(closesAt(r)).toBeGreaterThan(1000 + RECONNECT_GRACE_MS);
});

test('snapshot validation rejects bad tables', () => {
  expect(isSnapshot(snapshot(0))).toBe(true);
  const s = snapshot(0);
  s.balls[3]!.x = 5; // off the table but not pocketed
  expect(isSnapshot(s)).toBe(false);
  expect(isSnapshot({ ...snapshot(0), balls: snapshot(0).balls.slice(1) })).toBe(false);
  expect(isSnapshot({ ...snapshot(0), rules: { ...snapshot(0).rules, current: 2 } })).toBe(false);
});

// ---- the real worker, over real websockets ----

let server: Awaited<ReturnType<typeof startWorker>>;
beforeAll(async () => {
  server = await startWorker();
}, 60_000);
afterAll(() => server?.worker.stop());

interface Client {
  ws: WebSocket;
  next: (type: string, ms?: number) => Promise<unknown>;
  send: (type: string, data?: unknown) => void;
}

/** Connect, send the hello, and collect messages by type. */
function client(path: string, hello: object): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(server.url + path);
    const inbox: { type: string; data: unknown }[] = [];
    const waiters: (() => void)[] = [];
    ws.onmessage = (e) => {
      inbox.push(JSON.parse(String(e.data)));
      waiters.splice(0).forEach((w) => w());
    };
    ws.onerror = () => reject(new Error('socket error'));
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', data: hello }));
      resolve({
        ws,
        send: (type, data) => ws.send(JSON.stringify({ type, data })),
        next: (type, ms = 1000) =>
          new Promise((res) => {
            let done = false; // a timed-out wait must not swallow a later message
            const t = setTimeout(() => {
              done = true;
              res('timeout');
            }, ms);
            const check = () => {
              if (done) return;
              const i = inbox.findIndex((m) => m.type === type);
              if (i < 0) return void waiters.push(check);
              clearTimeout(t);
              res(inbox.splice(i, 1)[0]!.data);
            };
            check();
          }),
      });
    };
  });
}

test('two players: create, join, turn-checked relay, settle, resume, leave', async () => {
  const a = await client('/rooms/new', { op: 'create', name: '  Ann\u0007 ' });
  const created = (await a.next('room:created')) as { code: string; token: string };
  expect(created.code).toMatch(/^[A-Z2-9]{5}$/);

  const nobody = await client('/rooms/ZZZZZ', { op: 'join', name: 'Bob' });
  expect(await nobody.next('error')).toEqual({ error: 'No room with that code' });

  const b = await client(`/rooms/${created.code.toLowerCase()}`, { op: 'join', name: 'Bob' });
  const joined = (await b.next('room:joined')) as { token: string };
  const [ra, rb] = (await Promise.all([a.next('room:ready'), b.next('room:ready')])) as ReadyMsg[];
  expect(ra).toMatchObject({ seat: 0, names: ['Ann', 'Bob'], breaker: 0 });
  expect(rb).toMatchObject({ seat: 1, seed: ra!.seed });

  const shot = { angle: 0.1, power: 0.8, side: 0, top: 0.2, cue: [-0.5, 0] };
  b.send('game:shoot', shot); // not B's turn
  expect(await a.next('game:shoot', 300)).toBe('timeout');
  a.send('game:shoot', { ...shot, power: 7 }); // invalid
  expect(await b.next('game:shoot', 300)).toBe('timeout');
  a.send('game:aim', { angle: 1, power: 0, side: 0, top: 0 });
  expect(await b.next('game:aim')).toMatchObject({ angle: 1 });
  a.send('game:shoot', shot);
  expect(await b.next('game:shoot')).toEqual(shot);
  a.send('game:shoot', shot); // before the result is in
  expect(await b.next('game:shoot', 300)).toBe('timeout');
  a.send('game:settled', snapshot(1));
  expect(await b.next('game:settled')).toMatchObject({ rules: { current: 1 } });
  b.send('game:shoot', shot);
  expect(await a.next('game:shoot')).toEqual(shot);

  const third = await client(`/rooms/${created.code}`, { op: 'join', name: 'Cy' });
  expect(await third.next('error')).toEqual({ error: 'That room is full' });
  const thief = await client(`/rooms/${created.code}`, { op: 'resume', token: 'nope' });
  expect(await thief.next('error')).toEqual({ error: 'Game not found' });

  // B drops and comes back with its token; the shot in flight is discarded for both
  b.ws.close();
  expect(await a.next('room:opponentLeft')).toMatchObject({ graceMs: RECONNECT_GRACE_MS });
  const b2 = await client(`/rooms/${created.code}`, { op: 'resume', token: joined.token });
  expect(await b2.next('room:resumed')).toMatchObject({
    ready: { seat: 1 },
    snapshot: { rules: { current: 1 } },
  });
  expect(await a.next('room:opponentBack')).toBeUndefined();
  expect(await a.next('room:resync')).toMatchObject({ ready: { seat: 0 } });

  a.send('room:leave');
  expect(await b2.next('room:closed')).toEqual({ reason: 'Your opponent left the game' });
}, 30_000);

test('only the allowed origin may connect', async () => {
  const strict = await startWorker('https://game.example');
  // Node's WebSocket (undici) accepts headers, so it can pose as a page on another site
  type NodeWebSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket;
  const up = (origin: string) =>
    new Promise<string>((resolve) => {
      const ws = new (WebSocket as unknown as NodeWebSocket)(`${strict.url}/rooms/new`, {
        headers: { origin },
      });
      ws.onopen = () => (ws.close(), resolve('connected'));
      ws.onerror = () => resolve('refused');
    });
  expect(await up('https://evil.example')).toBe('refused');
  expect(await up('https://game.example')).toBe('connected');
  await strict.worker.stop();
}, 60_000);
