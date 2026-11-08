/**
 * Plain fetch helpers for the lobby display. Deliberately NOT the staff api client: the device has no
 * user session, must never send dev-user headers, and authenticates only with its display token.
 */
import { paths, type RealtimeNegotiateResponse, type WallFeed, type WallPairPollResponse, type WallPairStartResponse } from '@branchsuite/shared';
import { DISPLAY_TOKEN_HEADER, PAIRING_SECRET_HEADER } from '../../lib/queries.js';
import { readStorage, removeStorage, writeStorage } from '../../lib/storage.js';

export const WALL_TOKEN_KEY = 'bs.wall.token';
export const WALL_DISPLAY_KEY = 'bs.wall.display';

export class WallHttpError extends Error {
  override readonly name = 'WallHttpError';
  /** 0 = no HTTP response (offline, DNS, proxy down). */
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  get unauthorized(): boolean {
    return this.status === 401;
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store', credentials: 'omit', headers: { accept: 'application/json', ...init.headers } });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    throw new WallHttpError(0, 'Cannot reach BranchSuite.');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body (proxy page); keep the generic message.
    }
    throw new WallHttpError(res.status, message);
  }
  return (await res.json()) as T;
}

export const deviceApi = {
  startPairing: () => request<WallPairStartResponse>(paths.wallPairStart(), { method: 'POST' }),
  pollPairing: (pairingId: string, secret: string) => request<WallPairPollResponse>(paths.wallPairPoll(pairingId), { headers: { [PAIRING_SECRET_HEADER]: secret } }),
  feed: (token: string, signal?: AbortSignal) => request<WallFeed>(paths.wallFeed(), { headers: { [DISPLAY_TOKEN_HEADER]: token }, signal }),
  negotiate: (token: string) => request<RealtimeNegotiateResponse>(paths.wallNegotiate(), { method: 'POST', headers: { [DISPLAY_TOKEN_HEADER]: token } }),
};

/** What a paired device remembers across power cycles. */
export interface DisplaySession {
  token: string;
  displayId: string | null;
  branchName: string | null;
}

export function readSession(): DisplaySession | null {
  const token = readStorage(WALL_TOKEN_KEY)?.trim();
  if (!token) return null;
  let meta: { displayId?: unknown; branchName?: unknown } = {};
  try {
    meta = JSON.parse(readStorage(WALL_DISPLAY_KEY) ?? '{}') as typeof meta;
  } catch {
    // Corrupt metadata is harmless; the token alone is enough to fetch the feed.
  }
  return {
    token,
    displayId: typeof meta.displayId === 'string' ? meta.displayId : null,
    branchName: typeof meta.branchName === 'string' ? meta.branchName : null,
  };
}

export function saveSession(session: DisplaySession): void {
  writeStorage(WALL_TOKEN_KEY, session.token);
  writeStorage(WALL_DISPLAY_KEY, JSON.stringify({ displayId: session.displayId, branchName: session.branchName }));
}

export function clearSession(): void {
  removeStorage(WALL_TOKEN_KEY);
  removeStorage(WALL_DISPLAY_KEY);
}
