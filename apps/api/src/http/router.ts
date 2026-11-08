import type { AppContext } from '../context.js';
import { errorBody, HttpError, toErrorResponse } from './errors.js';
import { toApiRequest, type RawRequest } from './request.js';
import type { ApiRequest, ApiResponse, Handler, HttpMethod } from './types.js';

/** Applied to every API response: nothing is cacheable, content is never sniffed or framed. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};

interface Route {
  method: HttpMethod;
  pattern: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: HttpMethod, pattern: string, handler: Handler): this {
    this.routes.push({ method, pattern, segments: split(pattern), handler });
    return this;
  }

  get(pattern: string, handler: Handler) { return this.add('GET', pattern, handler); }
  post(pattern: string, handler: Handler) { return this.add('POST', pattern, handler); }
  put(pattern: string, handler: Handler) { return this.add('PUT', pattern, handler); }
  patch(pattern: string, handler: Handler) { return this.add('PATCH', pattern, handler); }
  delete(pattern: string, handler: Handler) { return this.add('DELETE', pattern, handler); }

  /** Resolve and run a handler. Never throws: every failure becomes an ApiError response. */
  handle(req: ApiRequest, ctx: AppContext): Promise<ApiResponse> {
    return this.run(() => req, ctx);
  }

  /** Same as handle, for host adapters: URL/body parsing failures also become ApiError responses. */
  handleRaw(raw: RawRequest, ctx: AppContext): Promise<ApiResponse> {
    return this.run(() => toApiRequest(raw), ctx);
  }

  private async run(build: () => ApiRequest, ctx: AppContext): Promise<ApiResponse> {
    let res: ApiResponse;
    let req: ApiRequest | undefined;
    try {
      req = build();
      res = await this.dispatch(req, ctx);
    } catch (err) {
      res = toErrorResponse(err, (message, data) => ctx.log.error(message, { path: req?.path, method: req?.method, data }));
    }
    return { ...res, headers: { ...SECURITY_HEADERS, ...(res.body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }), ...res.headers } };
  }

  private async dispatch(req: ApiRequest, ctx: AppContext): Promise<ApiResponse> {
    const segments = split(req.path);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = match(route.segments, segments);
      if (!params) continue;
      pathMatched = true;
      if (route.method !== req.method.toUpperCase()) continue;
      return route.handler({ ...req, params }, ctx);
    }
    if (pathMatched) {
      return { status: 405, body: errorBody('bad_request', `Method ${req.method} is not allowed here.`) };
    }
    throw new HttpError(404, 'not_found', 'No such API route.');
  }
}

function split(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function match(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    const a = actual[i]!;
    if (p.startsWith(':')) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(a);
      } catch {
        return null;
      }
      params[p.slice(1)] = decoded;
    } else if (p !== a) {
      return null;
    }
  }
  return params;
}
