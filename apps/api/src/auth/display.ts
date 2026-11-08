/**
 * Wall display authentication: `x-display-token` → sha256 → display lookup. Only the hash is
 * stored, so a database read never reveals a usable token.
 */
import type { Display } from '@branchsuite/shared';
import type { AppContext } from '../context.js';
import { unauthenticated } from '../http/errors.js';
import type { ApiRequest } from '../http/types.js';
import { sha256Hex } from '../security/crypto.js';

export const DISPLAY_TOKEN_HEADER = 'x-display-token';
/** lastSeenAt is refreshed at most this often, to keep feed polling read-only most of the time. */
export const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;

const MAX_TOKEN_LENGTH = 128;

export async function authenticateDisplay(req: ApiRequest, ctx: AppContext): Promise<Display> {
  const token = req.headers[DISPLAY_TOKEN_HEADER]?.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) throw unauthenticated('This display is not paired.');
  const display = await ctx.repo.findDisplayByTokenHash(sha256Hex(token));
  if (!display || display.revokedAt !== null) throw unauthenticated('This display is not paired.');

  const now = ctx.now();
  const lastSeen = display.lastSeenAt ? Date.parse(display.lastSeenAt) : 0;
  if (now.getTime() - lastSeen >= LAST_SEEN_INTERVAL_MS) {
    try {
      return await ctx.repo.updateDisplay(display.id, (d) => ({ ...d, lastSeenAt: now.toISOString() }));
    } catch (err) {
      // Bookkeeping only: never fail the feed because the heartbeat write lost a race.
      ctx.log.warn('Display lastSeenAt update failed', { displayId: display.id, error: String(err) });
    }
  }
  return display;
}
