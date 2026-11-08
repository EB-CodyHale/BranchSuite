import { WHITEBOARD_LIMITS } from '@branchsuite/shared';
import { badRequest, HttpError } from './errors.js';
import type { ApiRequest } from './types.js';

/** Host-neutral raw request handed over by the Functions adapter or the dev server. */
export interface RawRequest {
  method: string;
  /** Absolute URL or path with query, with or without the /api prefix. */
  url: string;
  headers: Iterable<[string, string]>;
  /** JSON (or empty) body text. Ignored when bodyBytes is set. */
  bodyText: string;
  /** Raw bytes for binary content types (adapters read these with bodyLimitFor). */
  bodyBytes?: Buffer;
  /** Socket address when known; x-forwarded-for wins when present. */
  remoteAddress?: string;
}

/** Hard cap on accepted request bodies (the largest legitimate body is an account import). */
export const MAX_BODY_BYTES = 1024 * 1024;

/** Largest accepted binary (image) upload. */
export const MAX_BINARY_BODY_BYTES = WHITEBOARD_LIMITS.maxImageBytes;

/** Media type without parameters, lowercase ("image/png; x=1" -> "image/png"). */
export function mediaType(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase();
}

/** Request bodies with an image/* content type are read as bytes; everything else as JSON text. */
export function isBinaryContentType(contentType: string | null | undefined): boolean {
  return mediaType(contentType).startsWith('image/');
}

/** Byte cap an adapter enforces while reading a body with this content type. */
export function bodyLimitFor(contentType: string | null | undefined): number {
  return isBinaryContentType(contentType) ? MAX_BINARY_BODY_BYTES : MAX_BODY_BYTES;
}

export const payloadTooLarge = (message = 'Request body is too large.') => new HttpError(413, 'bad_request', message);

/**
 * Read a web ReadableStream into one Buffer, failing with 413 as soon as `limit` is passed
 * (nothing beyond limit + one chunk is ever held in memory).
 */
export async function readStreamLimited(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw payloadTooLarge();
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export function toApiRequest(raw: RawRequest): ApiRequest {
  const url = new URL(raw.url, 'http://localhost');
  const headers: Record<string, string> = {};
  for (const [k, v] of raw.headers) headers[k.toLowerCase()] = v;

  let path = url.pathname;
  if (path === '/api' || path.startsWith('/api/')) path = path.slice(4) || '/';

  let body: unknown;
  let rawBody: Buffer | undefined;
  if (raw.bodyBytes) {
    if (raw.bodyBytes.length > MAX_BINARY_BODY_BYTES) throw payloadTooLarge();
    rawBody = raw.bodyBytes;
  } else if (Buffer.byteLength(raw.bodyText, 'utf8') > MAX_BODY_BYTES) {
    throw badRequest('Request body is too large.');
  } else if (raw.bodyText.trim().length > 0) {
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
    ...(rawBody ? { rawBody } : {}),
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
