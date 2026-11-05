import { createGameServer } from './server.ts';

// PORT: listen port (hosts set it). ALLOWED_ORIGINS: comma-separated game URLs allowed to connect;
// required in production so other sites can't use this server.
const port = Number(process.env.PORT ?? 3001);
const origins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && origins.length === 0) {
  console.error('Set ALLOWED_ORIGINS to the game URL(s), e.g. https://pool.example.com');
  process.exit(1);
}

const server = createGameServer({ origins });
server.http.listen(port, () => {
  console.log(`room server on :${port}, origins: ${origins.join(', ') || 'any (dev)'}`);
});
