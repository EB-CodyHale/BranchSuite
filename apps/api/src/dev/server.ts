/**
 * Local development server: the same router as the Functions app, on node:http at :7071/api.
 * Defaults to dev auth, in-memory data with fictional seed data, mock AI and no realtime.
 * Refuses to start when it detects Azure hosting (loadConfig rejects AUTH_MODE=dev there).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig } from '../config.js';
import { createAppContext } from '../context.js';
import { MemoryRepo } from '../data/memory.js';
import { errorBody } from '../http/errors.js';
import { MAX_BODY_BYTES } from '../http/request.js';
import { SECURITY_HEADERS } from '../http/router.js';
import { createRouter } from '../routes/index.js';
import { DEV_DISPLAY_TOKEN, seedDevData } from './seed.js';

const DEV_DEFAULTS: Record<string, string> = {
  AUTH_MODE: 'dev',
  DATA_MODE: 'memory',
  AI_MODE: 'mock',
  // Dev-only secret; Azure deployments read theirs from Key Vault.
  WALL_HMAC_SECRET: 'local-dev-only-wall-secret-0123456789abcdef',
  FEATURE_PIPELINE: 'true',
  FEATURE_PERSONAL_MAIL: 'true',
};

// Explicit environment values win; empty or missing ones fall back to the dev defaults.
const env: Record<string, string | undefined> = { ...process.env };
for (const [key, value] of Object.entries(DEV_DEFAULTS)) if (!env[key]) env[key] = value;
const config = loadConfig(env);
const ctx = createAppContext(config);
const router = createRouter();
const port = Number(process.env.PORT ?? 7071);

if (ctx.repo instanceof MemoryRepo && ctx.repo.memory.isEmpty()) {
  await seedDevData(ctx.repo, ctx.now());
  ctx.log.info('Seeded fictional dev data', { devDisplayToken: DEV_DISPLAY_TOKEN });
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, headers: Record<string, string>, body: unknown): void {
  res.writeHead(status, headers);
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';
  if (!url.startsWith('/api/') && url !== '/api') {
    send(res, 404, { ...SECURITY_HEADERS, 'content-type': 'application/json' }, errorBody('not_found', 'The API lives under /api.'));
    return;
  }
  const bodyText = await readBody(req);
  if (bodyText === null) {
    send(res, 413, { ...SECURITY_HEADERS, 'content-type': 'application/json' }, errorBody('bad_request', 'Request body is too large.'));
    return;
  }
  const headers = Object.entries(req.headers).flatMap(([k, v]): Array<[string, string]> =>
    v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : v]],
  );
  const result = await router.handleRaw(
    { method: req.method ?? 'GET', url, headers, bodyText, ...(req.socket.remoteAddress ? { remoteAddress: req.socket.remoteAddress } : {}) },
    ctx,
  );
  send(res, result.status, result.headers ?? {}, result.body);
});

server.listen(port, () => {
  ctx.log.info(`BranchSuite API (dev) listening on http://localhost:${port}/api`, { authMode: config.authMode, dataMode: config.dataMode });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
