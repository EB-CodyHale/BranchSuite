/**
 * Azure Functions registrations: thin adapters over the framework-free router and services.
 * The app context is created lazily on first invocation (fast cold start, config errors surface
 * as failed invocations with a clear message in Application Insights).
 */
import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { getAppContext } from '../context.js';
import { bodyLimitFor, isBinaryContentType, readStreamLimited } from '../http/request.js';
import { errorBody, HttpError } from '../http/errors.js';
import { SECURITY_HEADERS, serializeBody } from '../http/router.js';
import { runMaintenance } from '../maintenance.js';
import { createRouter } from '../routes/index.js';

const router = createRouter();

async function handleHttp(request: HttpRequest): Promise<HttpResponseInit> {
  const contentType = request.headers.get('content-type');
  const limit = bodyLimitFor(contentType);
  const tooLarge = (): HttpResponseInit => ({
    status: 413,
    headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' },
    jsonBody: errorBody('bad_request', 'Request body is too large.'),
  });
  // Reject on the declared length before reading anything.
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return tooLarge();

  let body: { bodyText: string; bodyBytes?: Buffer };
  try {
    // Streamed with a running cap, so a missing or lying content-length cannot make us buffer more.
    const bytes = await readStreamLimited(request.body as ReadableStream<Uint8Array> | null, limit);
    body = isBinaryContentType(contentType) ? { bodyText: '', bodyBytes: bytes } : { bodyText: bytes.toString('utf8') };
  } catch (err) {
    if (err instanceof HttpError && err.status === 413) return tooLarge();
    throw err;
  }

  const ctx = getAppContext();
  const res = await router.handleRaw({ method: request.method, url: request.url, headers: request.headers.entries(), ...body }, ctx);
  const payload = serializeBody(res.body);
  return { status: res.status, headers: res.headers, ...(payload === undefined ? {} : { body: payload }) };
}

app.http('api', {
  route: '{*path}',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  handler: handleHttp,
});

app.timer('mailSync', {
  schedule: '0 */2 * * * *',
  handler: async () => {
    const ctx = getAppContext();
    const result = await ctx.mail.syncAll();
    ctx.log.info('Mail sync finished', result);
  },
});

app.timer('maintenance', {
  schedule: '0 0 9 * * *',
  handler: async () => {
    await runMaintenance(getAppContext());
  },
});
