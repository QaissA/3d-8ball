import { unstable_dev, type Unstable_DevWorker } from 'wrangler';

/** The real worker (Durable Objects included) in Wrangler's local runtime, on a free port. */
export async function startWorker(allowedOrigins = ''): Promise<{
  url: string;
  worker: Unstable_DevWorker;
}> {
  const worker = await unstable_dev('server/index.ts', {
    config: 'wrangler.jsonc',
    vars: { ALLOWED_ORIGINS: allowedOrigins },
    ip: '127.0.0.1',
    logLevel: 'none',
    experimental: { disableExperimentalWarning: true },
  });
  return { url: `ws://127.0.0.1:${worker.port}`, worker };
}
