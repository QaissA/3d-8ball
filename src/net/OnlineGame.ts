import { io, type Socket } from 'socket.io-client';
import type { Game } from '../game/GameStateMachine';
import type { ShotInput } from '../input/ShotInput';
import {
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
const ACK_MS = 8000;
// free hosting (Render) sleeps when idle and takes up to a minute to wake; socket.io keeps retrying
const CONNECT_MS = 90_000;
const POS_EPS = 1e-6; // m: tables closer than this count as identical

type Queued = { kind: 'shoot'; m: ShotMsg } | { kind: 'settled'; m: Snapshot };

/**
 * One online game through the room server. The shooter's client is the authority: after the balls
 * stop it sends the table, and the other client snaps to it. Opponent shots and results are queued
 * and played in order, once the previous shot has finished rolling locally.
 */
export class OnlineGame {
  seat: Seat | null = null;
  inRoom = false;
  /** Times our table disagreed with the opponent's result (cross-browser float drift). */
  divergences = 0;
  private socket: Socket;
  private code = '';
  private token = '';
  private queue: Queued[] = [];
  private awaitingSettle = false; // opponent shot: their result is not in yet
  private myShotPending = false; // our shot: send the result when it stops
  private lastSent = '';
  private lastSentAt = 0;

  constructor(
    url: string,
    private game: Game,
    private input: ShotInput,
    private hooks: OnlineHooks,
  ) {
    this.socket = io(url, { autoConnect: false, transports: ['websocket'] });
    const s = this.socket;
    s.on('room:ready', (r: ReadyMsg) => {
      this.reset();
      this.seat = r.seat;
      this.inRoom = true;
      hooks.onStatus(null);
      hooks.onReady(r);
    });
    s.on('game:aim', (m: unknown) => {
      if (!isAim(m) || !this.opponentLive() || game.phase !== 'aiming') return;
      input.angle = m.angle;
      input.power = m.power;
      input.side = m.side;
      input.top = m.top;
    });
    s.on('game:place', (m: unknown) => {
      if (isPlace(m) && this.opponentLive() && game.phase === 'ballInHand')
        game.moveCueBall(m.x, m.z);
    });
    s.on('game:shoot', (m: unknown) => isShot(m) && this.queue.push({ kind: 'shoot', m }));
    s.on('game:settled', (m: unknown) => isSnapshot(m) && this.queue.push({ kind: 'settled', m }));
    s.on('room:resync', (r: ResumeMsg) => this.resume(r));
    s.on('room:opponentLeft', () =>
      hooks.onStatus('Opponent disconnected. Waiting for them to come back…'),
    );
    s.on('room:opponentBack', () => hooks.onStatus(null));
    s.on('room:closed', (m: { reason?: unknown }) => {
      this.leaveRoom();
      hooks.onClosed(typeof m?.reason === 'string' ? m.reason : 'The game ended');
    });
    s.on('disconnect', (reason) => {
      if (!this.inRoom) return;
      if (reason === 'io server disconnect' || reason === 'io client disconnect') {
        this.leaveRoom();
        hooks.onClosed('Disconnected from the server');
      } else hooks.onStatus('Connection lost. Reconnecting…');
    });
    s.on('connect', () => {
      if (!this.inRoom || !this.token) return; // first connect: nothing to resume
      void s
        .timeout(ACK_MS)
        .emitWithAck('room:resume', { code: this.code, token: this.token })
        .then((a: { ok: boolean; error?: string } & Partial<ResumeMsg>) => {
          if (!a.ok || !a.ready) throw new Error(a.error);
          hooks.onStatus(null);
          this.resume(a as ResumeMsg);
        })
        .catch(() => {
          this.leaveRoom();
          hooks.onClosed('Could not rejoin the game');
        });
    });
  }

  /** Create a room; resolves with its code once the server has it. */
  async create(name: string): Promise<string> {
    const a = await this.request('room:create', { name });
    this.code = a.code as string;
    this.token = a.token as string;
    return this.code;
  }

  async join(code: string, name: string): Promise<void> {
    const a = await this.request('room:join', { code, name });
    this.code = code.trim().toUpperCase();
    this.token = a.token as string;
  }

  /** New game in the same room (breaks alternate). */
  rematch(): void {
    if (this.inRoom) this.socket.emit('game:rematch');
  }

  leave(): void {
    if (this.socket.connected) this.socket.emit('room:leave');
    this.leaveRoom();
    this.socket.disconnect();
  }

  /** Whether the local player may aim, place and shoot right now. */
  get myTurn(): boolean {
    return (
      this.inRoom &&
      this.socket.connected &&
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
    this.socket.emit('game:shoot', msg);
    this.myShotPending = true;
  }

  /** Every frame: report our result, play queued opponent moves, stream our aim. */
  tick(now: number): void {
    const { game, input } = this;
    if (!this.inRoom) return;
    const idle = game.phase !== 'rolling' && input.phase !== 'striking';
    if (this.myShotPending && idle) {
      this.myShotPending = false;
      this.socket.emit('game:settled', game.snapshot());
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
    let event: string;
    let msg: object;
    if (game.phase === 'ballInHand') {
      event = 'game:place';
      msg = { x: game.cueBall.x, z: game.cueBall.z };
    } else if (game.phase === 'aiming' && input.phase !== 'striking') {
      event = 'game:aim';
      msg = { angle: input.angle, power: input.power, side: input.side, top: input.top };
    } else return;
    const key = event + JSON.stringify(msg);
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.lastSentAt = now;
    this.socket.emit(event, msg);
  }

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

  private async request(event: string, msg: object): Promise<Record<string, unknown>> {
    if (!this.socket.connected) {
      this.socket.connect();
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error('Could not reach the game server')),
          CONNECT_MS,
        );
        this.socket.once('connect', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    let a: { ok: boolean; error?: string };
    try {
      a = await this.socket.timeout(ACK_MS).emitWithAck(event, msg);
    } catch {
      throw new Error('The game server did not answer');
    }
    if (!a.ok) throw new Error(a.error ?? 'Something went wrong');
    return a as Record<string, unknown>;
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
