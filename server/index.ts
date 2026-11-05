import { cleanCode } from '../src/net/protocol';
import type { Env } from './RoomObject';
import { newCode } from './rooms';

export { RoomObject } from './RoomObject';

const ROOM_OPS_PER_MINUTE = 20; // per IP: makes guessing room codes slow
// shortcut: per-isolate memory, so the limit is per Cloudflare location, not global. Use the
// Workers Rate Limiting binding if abuse shows up.
const roomOps = new Map<string, { n: number; since: number }>();

function allowRoomOp(ip: string): boolean {
  const now = Date.now();
  const e = roomOps.get(ip);
  if (!e || now - e.since > 60_000) {
    if (roomOps.size > 10_000) roomOps.clear();
    roomOps.set(ip, { n: 1, since: now });
    return true;
  }
  return ++e.n <= ROOM_OPS_PER_MINUTE;
}

/**
 * Room server. GET /rooms/new (create) or /rooms/<CODE> (join, resume) upgrades to a websocket
 * handled by that room's Durable Object; the first message says what the client wants.
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/healthz') return Response.json({ ok: true });

    const m = /^\/rooms\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (!m) return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected a websocket', { status: 426 });
    // browsers don't apply CORS to websockets, so only the game's own site may connect
    const allowed = env.ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.length && !allowed.includes(req.headers.get('Origin') ?? ''))
      return new Response('Origin not allowed', { status: 403 });
    if (!allowRoomOp(req.headers.get('CF-Connecting-IP') ?? 'local'))
      return new Response('Too many attempts, wait a minute', { status: 429 });

    const code = m[1] === 'new' ? newCode() : cleanCode(m[1]);
    if (!code) return new Response('Not found', { status: 404 });
    const target = new URL(req.url);
    target.searchParams.set('code', code);
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(target, req));
  },
} satisfies ExportedHandler<Env>;
