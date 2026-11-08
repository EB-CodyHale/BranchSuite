/**
 * Same-origin JSON client for /api. Every non-2xx response becomes an ApiError carrying the
 * server's error code, so callers branch on `code`, never on message text.
 */
import type { ApiError as ApiErrorBody, ApiErrorCode } from '@branchsuite/shared';
import { readStorage, removeStorage, writeStorage } from './storage.js';

/** 'network' = the request never got an HTTP response (offline, DNS, CORS, aborted proxy). */
export type ClientErrorCode = ApiErrorCode | 'network';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** Errors worth retrying automatically: network failures, throttling and server faults. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export function isApiError(e: unknown, code?: ClientErrorCode): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

const DEFAULT_CODES: Record<number, ApiErrorCode> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  412: 'conflict',
  422: 'bad_request',
  429: 'rate_limited',
  502: 'upstream_error',
  503: 'upstream_error',
  504: 'upstream_error',
};

const DEFAULT_MESSAGES: Partial<Record<ClientErrorCode, string>> = {
  bad_request: 'The request was not valid.',
  unauthenticated: 'Please sign in again.',
  not_provisioned: 'Your account is not set up in BranchSuite.',
  forbidden: 'You do not have permission to do that.',
  not_found: 'That item no longer exists.',
  conflict: 'Someone else changed this at the same time. Refresh and try again.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  upstream_error: 'A connected service is not responding. Try again shortly.',
  internal: 'Something went wrong on the server.',
  network: 'Cannot reach BranchSuite. Check your connection.',
};

function codeForStatus(status: number): ApiErrorCode {
  return DEFAULT_CODES[status] ?? (status >= 500 ? 'internal' : 'bad_request');
}

function isErrorBody(v: unknown): v is ApiErrorBody {
  if (typeof v !== 'object' || v === null || !('error' in v)) return false;
  const err = (v as { error: unknown }).error;
  return typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string';
}

/** Build an ApiError from a failed response. Exported for tests and for non-JSON callers. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (isErrorBody(body)) {
    const { code, message, details } = body.error;
    return new ApiError(res.status, code, message || DEFAULT_MESSAGES[code] || res.statusText, details);
  }
  const code = codeForStatus(res.status);
  return new ApiError(res.status, code, DEFAULT_MESSAGES[code] ?? (res.statusText || `HTTP ${res.status}`));
}

// ---------- dev sign-in (local development only) ----------

const DEV_USER_KEY = 'bs.devUser';
export const DEV_USER_HEADER = 'x-dev-user';

export function getDevUser(): string | null {
  return import.meta.env.DEV ? readStorage(DEV_USER_KEY) : null;
}
export function setDevUser(email: string | null): void {
  if (email) writeStorage(DEV_USER_KEY, email);
  else removeStorage(DEV_USER_KEY);
}

// ---------- request ----------

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const devUser = getDevUser();
  if (devUser) headers[DEV_USER_HEADER] = devUser;

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', DEFAULT_MESSAGES.network!);
  }

  if (!res.ok) throw await errorFromResponse(res);
  if (res.status === 204 || res.status === 205) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, 'internal', 'The server sent a response BranchSuite could not read.');
  }
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => apiRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

/** Human message for any thrown value (toasts, inline errors). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong.';
}
