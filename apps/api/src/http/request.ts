import { badRequest } from './errors.js';
import type { ApiRequest } from './types.js';

/** Host-neutral raw request handed over by the Functions adapter or the dev server. */
export interface RawRequest {
  method: string;
  /** Absolute URL or path with query, with or without the /api prefix. */
  url: string;
  headers: Iterable<[string, string]>;
  bodyText: string;
  /** Socket address when known; x-forwarded-for wins when present. */
  remoteAddress?: string;
}

/** Hard cap on accepted request bodies (the largest legitimate body is an account import). */
export const MAX_BODY_BYTES = 1024 * 1024;

export function toApiRequest(raw: RawRequest): ApiRequest {
  const url = new URL(raw.url, 'http://localhost');
  const headers: Record<string, string> = {};
  for (const [k, v] of raw.headers) headers[k.toLowerCase()] = v;

  let path = url.pathname;
  if (path === '/api' || path.startsWith('/api/')) path = path.slice(4) || '/';

  if (Buffer.byteLength(raw.bodyText, 'utf8') > MAX_BODY_BYTES) throw badRequest('Request body is too large.');
  let body: unknown;
  if (raw.bodyText.trim().length > 0) {
    try {
      body = JSON.parse(raw.bodyText);
    } catch {
      throw badRequest('Request body must be valid JSON.');
    }
  }

  return {
    method: raw.method.toUpperCase(),
    path,
    params: {},
    query: url.searchParams,
    headers,
    body,
    ip: clientIp(headers['x-forwarded-for'], raw.remoteAddress),
  };
}

/** First x-forwarded-for hop without port; falls back to the socket address. */
function clientIp(forwarded: string | undefined, remote: string | undefined): string {
  const first = forwarded?.split(',')[0]?.trim();
  const candidate = first || remote || 'unknown';
  // IPv4 with port "1.2.3.4:5678"; leave IPv6 (multiple colons) untouched except brackets.
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(candidate);
  if (v4) return v4[1]!;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  return bracketed ? bracketed[1]! : candidate;
}
