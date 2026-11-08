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
import { bodyLimitFor, isBinaryContentType } from '../http/request.js';
import { SECURITY_HEADERS, serializeBody } from '../http/router.js';
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
  await seedDevData(ctx.repo, ctx.now(), ctx.media);
  ctx.log.info('Seeded fictional dev data', { devDisplayToken: DEV_DISPLAY_TOKEN });
}
if (config.devWhiteboardLive) ctx.log.info("DEV_WHITEBOARD_LIVE is on: today's whiteboard takes over wall displays unless set to 'off'.");

/** Reads at most `limit` bytes; resolves null (and stops reading) as soon as the body is larger. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? '0') > limit) {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        req.pause();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks, size));
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, headers: Record<string, string>, body: unknown): void {
  res.writeHead(status, headers);
  res.end(serializeBody(body));
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';
  if (!url.startsWith('/api/') && url !== '/api') {
    send(res, 404, { ...SECURITY_HEADERS, 'content-type': 'application/json' }, errorBody('not_found', 'The API lives under /api.'));
    return;
  }
  const contentType = req.headers['content-type'];
  const raw = await readBody(req, bodyLimitFor(contentType));
  if (raw === null) {
    // Close the connection: the rest of the oversized upload is never read.
    res.once('finish', () => req.destroy());
    send(res, 413, { ...SECURITY_HEADERS, 'content-type': 'application/json', connection: 'close' }, errorBody('bad_request', 'Request body is too large.'));
    return;
  }
  const body = isBinaryContentType(contentType) ? { bodyText: '', bodyBytes: raw } : { bodyText: raw.toString('utf8') };
  const headers = Object.entries(req.headers).flatMap(([k, v]): Array<[string, string]> =>
    v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : v]],
  );
  const result = await router.handleRaw(
    { method: req.method ?? 'GET', url, headers, ...body, ...(req.socket.remoteAddress ? { remoteAddress: req.socket.remoteAddress } : {}) },
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
