/**
 * Framework-free HTTP types. The Azure Functions adapter and the dev server both translate
 * to and from these, so route handlers never depend on a host runtime.
 */
import type { AppContext } from '../context.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequest {
  method: string;
  /** Path without the /api prefix, e.g. "/branches/branch-1001/orders". */
  path: string;
  /** Route parameters filled by the router (URL-decoded). */
  params: Record<string, string>;
  query: URLSearchParams;
  /** Lowercase header names. */
  headers: Record<string, string>;
  /** Parsed JSON body (undefined when empty). */
  body: unknown;
  /** Best-effort client IP (rate limiting only, never authorization). */
  ip: string;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = (req: ApiRequest, ctx: AppContext) => Promise<ApiResponse>;

export function ok(body: unknown, status = 200): ApiResponse {
  return { status, body };
}

export function created(body: unknown): ApiResponse {
  return { status: 201, body };
}
