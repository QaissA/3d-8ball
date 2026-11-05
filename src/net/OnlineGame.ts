import type { Game } from '../game/GameStateMachine';
import type { ShotInput } from '../input/ShotInput';
import {
  cleanCode,
  isAim,
  isPlace,
  isShot,
  isSnapshot,
  type ReadyMsg,
  type ResumeMsg,
  type Seat,
  type ShotMsg,
  type Snapshot,
} from './protocol';

export interface OnlineHooks {
  /** A game (or rematch) starts: set up seats, names and the rack from the seed. */
  onReady(r: ReadyMsg): void;
  /** After the table was snapped to the agreed state: resync meshes. */
  afterRestore(): void;
  /** Connection or opponent trouble (null = all good). */
  onStatus(text: string | null): void;
  /** The room is gone (opponent left, timed out): back to the menu. */
  onClosed(reason: string): void;
}

const SEND_EVERY_MS = 100; // aim/placement updates to the opponent, ~10 Hz
const CONNECT_MS = 15_000;
const RETRY_MS = 2_000; // between reconnect attempts
const RETRY_FOR_MS = 60_000; // the server keeps a dropped seat this long
const POS_EPS = 1e-6; // m: tables closer than this count as identical

type Queued = { kind: 'shoot'; m: ShotMsg } | { kind: 'settled'; m: Snapshot };
interface Wire {
  type?: unknown;
  data?: unknown;
}

/** An error the server sent on purpose (bad code, full room): retrying won't help. */
class ServerRefused extends Error {}

/**
 * One online game through the room server (plain websockets; one Durable Object per room).
 * The shooter's client is the authority: after the balls stop it sends the table, and the other
 * client snaps to it. Opponent shots and results are queued and played in order, once the previous
 * shot has finished rolling locally.
 */
export class OnlineGame {
  seat: Seat | null = null;
  inRoom = false;
  /** Times our table disagreed with the opponent's result (cross-browser float drift). */
  divergences = 0;
  private base: string;
  private ws: WebSocket | null = null;
  private code = '';
  private token = '';
  private queue: Queued[] = [];
  private awaitingSettle = false; // opponent shot: their result is not in yet
  private myShotPending = false; // our shot: send the result when it stops
  private lastSent = '';
  private lastSentAt = 0;
  private reconnecting = false;

  constructor(
    url: string,
    private game: Game,
    private input: ShotInput,
    private hooks: OnlineHooks,
  ) {
    this.base = url.replace(/^http/, 'ws').replace(/\/$/, '');
  }

  /** Create a room; resolves with its code once the server has it. */
  async create(name: string): Promise<string> {
    const d = await this.open('/rooms/new', { op: 'create', name }, 'room:created');
    this.code = d.code as string;
    this.token = d.token as string;
    return this.code;
  }

  async join(code: string, name: string): Promise<void> {
    const c = cleanCode(code);
    if (!c) throw new Error('Room codes are 5 letters or digits');
    const d = await this.open(`/rooms/${c}`, { op: 'join', name }, 'room:joined');
    this.code = c;
    this.token = d.token as string;
  }

  /** New game in the same room (breaks alternate). */
  rematch(): void {
    if (this.inRoom) this.send('game:rematch');
  }

  leave(): void {
    this.send('room:leave');
    this.leaveRoom();
    this.closeSocket();
  }

  /** Whether the local player may aim, place and shoot right now. */
  get myTurn(): boolean {
    return (
      this.inRoom &&
      this.ws?.readyState === WebSocket.OPEN &&
      this.seat === this.game.rules.current &&
      !this.awaitingSettle &&
      this.queue.length === 0
    );
  }

  /** Call just before the local player's shot is applied. */
  sendShot(): void {
    const { input, game } = this;
    const b = game.cueBall;
    const msg: ShotMsg = {
      angle: input.angle,
      power: input.power,
      side: input.side,
      top: input.top,
      cue: [b.x, b.z],
    };
    this.send('game:shoot', msg);
    this.myShotPending = true;
  }

  /** Every frame: report our result, play queued opponent moves, stream our aim. */
  tick(now: number): void {
    const { game, input } = this;
    if (!this.inRoom) return;
    const idle = game.phase !== 'rolling' && input.phase !== 'striking';
    if (this.myShotPending && idle) {
      this.myShotPending = false;
      this.send('game:settled', game.snapshot());
    }
    while (idle && this.queue.length) {
      const e = this.queue.shift()!;
      if (e.kind === 'settled') {
        this.reconcile(e.m);
        this.awaitingSettle = false;
        continue;
      }
      this.playOpponentShot(e.m);
      break; // let it roll; the next item waits for it to stop
    }
    if (!this.myTurn || now - this.lastSentAt < SEND_EVERY_MS) return;
    let type: string;
    let msg: object;
    if (game.phase === 'ballInHand') {
      type = 'game:place';
      msg = { x: game.cueBall.x, z: game.cueBall.z };
    } else if (game.phase === 'aiming' && input.phase !== 'striking') {
      type = 'game:aim';
      msg = { angle: input.angle, power: input.power, side: input.side, top: input.top };
    } else return;
    const key = type + JSON.stringify(msg);
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.lastSentAt = now;
    this.send(type, msg);
  }

  // ---- connection ----

  /**
   * Open a socket to a room, send the hello, and resolve with the server's answer of type `expect`.
   * Later messages go to handle(); an unexpected close starts reconnecting.
   */
  private open(path: string, hello: object, expect: string): Promise<Record<string, unknown>> {
    this.closeSocket();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.base + path);
      this.ws = ws;
      let pending = true;
      const finish = (err: Error | null, data?: Record<string, unknown>) => {
        if (!pending) return;
        pending = false;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(data ?? {});
      };
      const timer = setTimeout(() => {
        finish(new Error('Could not reach the game server'));
        ws.close();
      }, CONNECT_MS);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', data: hello }));
      ws.onmessage = (e) => {
        let m: Wire;
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        const data = (typeof m.data === 'object' && m.data !== null ? m.data : {}) as Record<
          string,
          unknown
        >;
        if (pending && m.type === expect) return finish(null, data);
        if (pending && m.type === 'error')
          return finish(new ServerRefused(String(data.error ?? 'Something went wrong')));
        this.handle(m.type, m.data);
      };
      ws.onclose = () => {
        if (pending) finish(new Error('Could not reach the game server'));
        else if (ws === this.ws) this.dropped();
      };
    });
  }

  private handle(type: unknown, d: unknown): void {
    const { game, input, hooks } = this;
    switch (type) {
      case 'room:ready': {
        const r = d as ReadyMsg;
        this.reset();
        this.seat = r.seat;
        this.inRoom = true;
        hooks.onStatus(null);
        hooks.onReady(r);
        return;
      }
      case 'game:aim':
        if (!isAim(d) || !this.opponentLive() || game.phase !== 'aiming') return;
        input.angle = d.angle;
        input.power = d.power;
        input.side = d.side;
        input.top = d.top;
        return;
      case 'game:place':
        if (isPlace(d) && this.opponentLive() && game.phase === 'ballInHand')
          game.moveCueBall(d.x, d.z);
        return;
      case 'game:shoot':
        if (isShot(d)) this.queue.push({ kind: 'shoot', m: d });
        return;
      case 'game:settled':
        if (isSnapshot(d)) this.queue.push({ kind: 'settled', m: d });
        return;
      case 'room:resync':
        this.resume(d as ResumeMsg);
        return;
      case 'room:opponentLeft':
        hooks.onStatus('Opponent disconnected. Waiting for them to come back…');
        return;
      case 'room:opponentBack':
        hooks.onStatus(null);
        return;
      case 'room:closed': {
        const reason = (d as { reason?: unknown } | null)?.reason;
        this.leaveRoom();
        this.closeSocket();
        hooks.onClosed(typeof reason === 'string' ? reason : 'The game ended');
        return;
      }
    }
  }

  /** The socket closed on its own: rejoin the room with our token while the server holds the seat. */
  private dropped(): void {
    if (!this.token) return;
    if (!this.inRoom) {
      // still waiting for an opponent: the server drops a room whose host disconnects
      this.code = this.token = '';
      this.hooks.onClosed('Lost the connection to the server. Create the room again.');
      return;
    }
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.hooks.onStatus('Connection lost. Reconnecting…');
    const giveUp = Date.now() + RETRY_FOR_MS;
    const attempt = () => {
      if (!this.inRoom) return void (this.reconnecting = false); // left meanwhile
      this.open(`/rooms/${this.code}`, { op: 'resume', token: this.token }, 'room:resumed')
        .then((d) => {
          this.reconnecting = false;
          this.hooks.onStatus(null);
          this.resume(d as unknown as ResumeMsg);
        })
        .catch((err: unknown) => {
          if (!(err instanceof ServerRefused) && Date.now() < giveUp)
            return void setTimeout(attempt, RETRY_MS);
          this.reconnecting = false;
          this.leaveRoom();
          this.hooks.onClosed('Could not rejoin the game');
        });
    };
    setTimeout(attempt, RETRY_MS);
  }

  private send(type: string, data?: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type, data }));
  }

  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null; // so its close event isn't taken for a dropped connection
    ws?.close();
  }

  // ---- game sync ----

  private playOpponentShot(m: ShotMsg): void {
    const { game, input } = this;
    // the shooter's cue ball position is authoritative (ball in hand, or tiny drift)
    const b = game.cueBall;
    b.x = m.cue[0];
    b.z = m.cue[1];
    b.state = 'stationary';
    if (game.phase === 'ballInHand') game.phase = 'aiming';
    input.angle = m.angle;
    input.power = m.power;
    input.side = m.side;
    input.top = m.top;
    input.phase = 'striking';
    input.onRelease(); // same strike animation and shot path as a local shot
    this.awaitingSettle = true;
  }

  private reconcile(theirs: Snapshot): void {
    const mine = this.game.snapshot();
    const same =
      JSON.stringify(mine.rules) === JSON.stringify(theirs.rules) &&
      mine.phase === theirs.phase &&
      mine.balls.every((b) => {
        const t = theirs.balls.find((x) => x.id === b.id);
        return (
          t &&
          t.pocketed === b.pocketed &&
          (b.pocketed || (Math.abs(t.x - b.x) < POS_EPS && Math.abs(t.z - b.z) < POS_EPS))
        );
      });
    if (!same) {
      this.divergences++;
      if (import.meta.env.DEV)
        console.warn('online: table differed from the shooter; snapping', { mine, theirs });
    }
    this.game.restore(theirs); // always: makes both tables bit-identical
    this.hooks.afterRestore();
  }

  /** Back to the last agreed table after a reconnect. */
  private resume(r: ResumeMsg): void {
    this.reset();
    this.seat = r.ready.seat;
    this.inRoom = true;
    this.hooks.onReady(r.ready);
    if (r.snapshot && isSnapshot(r.snapshot)) {
      this.game.restore(r.snapshot);
      this.hooks.afterRestore();
    }
  }

  private opponentLive(): boolean {
    return (
      this.inRoom &&
      this.seat !== this.game.rules.current &&
      this.queue.length === 0 &&
      !this.awaitingSettle &&
      this.input.phase !== 'striking'
    );
  }

  private reset(): void {
    this.queue = [];
    this.awaitingSettle = false;
    this.myShotPending = false;
    this.lastSent = '';
    this.input.phase = 'aiming';
    this.input.power = 0;
  }

  private leaveRoom(): void {
    this.inRoom = false;
    this.seat = null;
    this.code = this.token = '';
    this.reset();
  }
}
