/**
 * Azure Functions registrations: thin adapters over the framework-free router and services.
 * The app context is created lazily on first invocation (fast cold start, config errors surface
 * as failed invocations with a clear message in Application Insights).
 */
import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { getAppContext } from '../context.js';
import { MAX_BODY_BYTES } from '../http/request.js';
import { errorBody } from '../http/errors.js';
import { SECURITY_HEADERS } from '../http/router.js';
import { runMaintenance } from '../maintenance.js';
import { createRouter } from '../routes/index.js';

const router = createRouter();

async function handleHttp(request: HttpRequest): Promise<HttpResponseInit> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return { status: 413, headers: { ...SECURITY_HEADERS }, jsonBody: errorBody('bad_request', 'Request body is too large.') };
  }
  const ctx = getAppContext();
  const res = await router.handleRaw(
    {
      method: request.method,
      url: request.url,
      headers: request.headers.entries(),
      bodyText: request.body ? await request.text() : '',
    },
    ctx,
  );
  return { status: res.status, headers: res.headers, ...(res.body === undefined ? {} : { body: JSON.stringify(res.body) }) };
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
