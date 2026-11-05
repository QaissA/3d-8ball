import { DurableObject } from 'cloudflare:workers';
import {
  cleanName,
  isAim,
  isPlace,
  isShot,
  isSnapshot,
  type ReadyMsg,
  type ResumeMsg,
  type Seat,
} from '../src/net/protocol';
import {
  canAct,
  closesAt,
  createRoom,
  joinRoom,
  newRack,
  RECONNECT_GRACE_MS,
  type Room,
  seatOfToken,
  setConnected,
  settle,
  shoot,
} from './rooms';

export interface Env {
  ROOMS: DurableObjectNamespace<RoomObject>;
  /** Comma-separated game URLs allowed to connect; empty = any (local dev). */
  ALLOWED_ORIGINS: string;
}

const MAX_MESSAGE_CHARS = 16_000; // a snapshot is ~2 KB
const BURST = 40; // messages
const PER_SECOND = 20; // sustained; aim and place updates are sent at ~10 Hz

/** Per-socket data that survives hibernation. seat is null until the hello is accepted. */
interface Attachment {
  seat: Seat | null;
  code: string;
}

/**
 * One room per object (named by its code). Sockets use the hibernation API, so an idle room costs
 * nothing; the room itself lives in storage and an alarm closes it when it expires.
 */
export class RoomObject extends DurableObject<Env> {
  private room: Room | null = null;
  private buckets = new Map<WebSocket, { tokens: number; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<Room>('room')) ?? null;
    });
  }

  /** The worker forwards websocket upgrades here, with the room code in ?code=. */
  async fetch(req: Request): Promise<Response> {
    const code = new URL(req.url).searchParams.get('code') ?? '';
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null, code } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return ws.close(1009, 'Too big');
    if (!this.allow(ws)) return ws.close(1008, 'Too many messages');
    let msg: { type?: unknown; data?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment;
    if (att.seat === null) {
      if (msg.type === 'hello') await this.hello(ws, att, msg.data);
      return;
    }
    const room = this.room;
    if (!room) return;
    const seat = att.seat;
    const other: Seat = seat === 0 ? 1 : 0;
    switch (msg.type) {
      case 'game:aim':
      case 'game:place':
        if ((msg.type === 'game:aim' ? isAim : isPlace)(msg.data) && canAct(room, seat))
          this.send(other, msg.type, msg.data);
        return;
      case 'game:shoot':
        if (isShot(msg.data) && shoot(room, seat)) {
          await this.save();
          this.send(other, 'game:shoot', msg.data);
        }
        return;
      case 'game:settled':
        if (isSnapshot(msg.data) && settle(room, seat, msg.data)) {
          await this.save();
          this.send(other, 'game:settled', msg.data);
        }
        return;
      case 'game:rematch':
        if (!room.players[1] || room.awaitingSettle) return;
        newRack(room);
        await this.save();
        this.startGame();
        return;
      case 'room:leave':
        await this.close('Your opponent left the game', seat);
        return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  async alarm(): Promise<void> {
    if (!this.room) return;
    if (Date.now() >= closesAt(this.room))
      await this.close('The game ended: a player did not come back');
    else await this.ctx.storage.setAlarm(closesAt(this.room));
  }

  // ---- connection setup ----

  private async hello(ws: WebSocket, att: Attachment, data: unknown): Promise<void> {
    const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
    const fail = (error: string) => {
      ws.send(JSON.stringify({ type: 'error', data: { error } }));
      ws.close(4000, error);
    };
    const now = Date.now();
    if (d.op === 'create') {
      const name = cleanName(d.name);
      if (!name) return fail('Enter a name');
      if (this.room) return fail('Please try again'); // code collision: a new code next time
      this.room = createRoom(att.code, name, now);
      this.bind(ws, att, 0);
      await this.save();
      this.reply(ws, 'room:created', { code: att.code, token: this.room.players[0].token });
    } else if (d.op === 'join') {
      const name = cleanName(d.name);
      if (!name) return fail('Enter a name');
      if (!this.room) return fail('No room with that code');
      const res = joinRoom(this.room, name);
      if (!res.ok) return fail(res.error);
      this.bind(ws, att, 1);
      await this.save();
      this.reply(ws, 'room:joined', { token: res.token });
      this.startGame();
    } else if (d.op === 'resume') {
      const seat =
        this.room && typeof d.token === 'string' ? seatOfToken(this.room, d.token) : null;
      if (!this.room || seat === null) return fail('Game not found');
      for (const old of this.socketsOf(seat)) old.close(4001, 'Replaced by a new connection');
      this.bind(ws, att, seat);
      setConnected(this.room, seat, true, now);
      // a shot in flight when someone dropped is discarded: both go back to the last agreed table
      const resync = this.room.awaitingSettle;
      this.room.awaitingSettle = false;
      await this.save();
      const other: Seat = seat === 0 ? 1 : 0;
      this.reply(ws, 'room:resumed', this.resumeMsg(seat));
      this.send(other, 'room:opponentBack');
      if (resync) this.send(other, 'room:resync', this.resumeMsg(other));
    } else fail('Bad request');
  }

  private bind(ws: WebSocket, att: Attachment, seat: Seat): void {
    ws.serializeAttachment({ ...att, seat } satisfies Attachment);
  }

  private async dropped(ws: WebSocket): Promise<void> {
    this.buckets.delete(ws);
    const seat = (ws.deserializeAttachment() as Attachment | null)?.seat ?? null;
    const room = this.room;
    if (!room || seat === null) return;
    if (this.socketsOf(seat).some((s) => s !== ws)) return; // already replaced by a reconnect
    if (!room.players[1]) {
      // the host left before anyone joined
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    setConnected(room, seat, false, Date.now());
    await this.save();
    this.send(seat === 0 ? 1 : 0, 'room:opponentLeft', { graceMs: RECONNECT_GRACE_MS });
  }

  // ---- helpers ----

  private ready(seat: Seat): ReadyMsg {
    const r = this.room!;
    return {
      seat,
      names: [r.players[0].name, r.players[1]?.name ?? ''],
      seed: r.seed,
      breaker: r.breaker,
    };
  }

  private resumeMsg(seat: Seat): ResumeMsg {
    return { ready: this.ready(seat), snapshot: this.room!.snapshot };
  }

  private startGame(): void {
    this.send(0, 'room:ready', this.ready(0));
    this.send(1, 'room:ready', this.ready(1));
  }

  private socketsOf(seat: Seat): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((s) => (s.deserializeAttachment() as Attachment | null)?.seat === seat);
  }

  private reply(ws: WebSocket, type: string, data?: unknown): void {
    try {
      ws.send(JSON.stringify({ type, data }));
    } catch {
      // socket already closing
    }
  }

  private send(seat: Seat, type: string, data?: unknown): void {
    for (const ws of this.socketsOf(seat)) this.reply(ws, type, data);
  }

  /** Persist the room and (re)arm the alarm that closes it. */
  private async save(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put('room', this.room);
    await this.ctx.storage.setAlarm(closesAt(this.room));
  }

  private async close(reason: string, except?: Seat): Promise<void> {
    for (const s of [0, 1] as const) if (s !== except) this.send(s, 'room:closed', { reason });
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'Room closed');
    this.room = null;
    await this.ctx.storage.deleteAll();
  }

  /** Token bucket per socket (in memory: resets if the object hibernates, which is fine). */
  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.buckets.get(ws) ?? { tokens: BURST, at: now };
    b.tokens = Math.min(BURST, b.tokens + ((now - b.at) / 1000) * PER_SECOND) - 1;
    b.at = now;
    this.buckets.set(ws, b);
    return b.tokens >= 0;
  }
}
