import { OrderRuleError, PipelineRuleError, type ApiError, type ApiErrorCode } from '@branchsuite/shared';
import type { ApiResponse } from './types.js';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  not_provisioned: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  upstream_error: 502,
  internal: 500,
};

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const forbidden = (message = 'You do not have permission to do that.') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
export const unauthenticated = (message = 'Sign-in required.') => new HttpError(401, 'unauthenticated', message);

export function errorBody(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}

/**
 * Maps any thrown value to an ApiError response. Shared domain rule errors carry their own code;
 * everything unexpected becomes a 500 with a generic message (details are logged, never returned).
 */
export function toErrorResponse(err: unknown, log: (message: string, data?: unknown) => void): ApiResponse {
  if (err instanceof HttpError) {
    return { status: err.status, body: errorBody(err.code, err.message, err.details) };
  }
  if (err instanceof OrderRuleError || err instanceof PipelineRuleError) {
    return { status: STATUS_BY_CODE[err.code], body: errorBody(err.code, err.message) };
  }
  log('Unhandled error', err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err);
  return { status: 500, body: errorBody('internal', 'Something went wrong. Try again.') };
}
