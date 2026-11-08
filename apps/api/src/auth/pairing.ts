/**
 * Wall display pairing (ARCHITECTURE §5):
 *   device  POST /wall/pair/start            → { pairingId, code, secret }   (secret kept on the device)
 *   manager POST /branches/:b/displays/claim → display created; token sealed onto the pairing
 *   device  GET  /wall/pair/:id (secret)     → { status: 'paired', displayToken } exactly once
 * Only hashes of the secret and token are stored in the clear.
 */
import { LIMITS, newId, type Branch, type Display, type WallPairPollResponse, type WallPairStartResponse } from '@branchsuite/shared';
import type { AppContext } from '../context.js';
import { HttpError, notFound, unauthenticated } from '../http/errors.js';
import type { Pairing } from '../data/repo.js';
import { open, randomString, randomToken, safeEqual, seal, sha256Hex } from '../security/crypto.js';

/** No 0/O, 1/I/L, 2/Z, 5/S, B/8: readable from across a room. */
export const PAIRING_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
export const MAX_ACTIVE_PAIRINGS = 200;
export const PAIRING_SECRET_HEADER = 'x-pairing-secret';

const CODE_ATTEMPTS = 5;
const MAX_SECRET_LENGTH = 128;

const rateLimited = (message: string) => new HttpError(429, 'rate_limited', message);
const sealContext = (pairingId: string) => `pairing:${pairingId}`;

export function formatPairingCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export function normalizePairingCode(input: string): string {
  return input.replace(/-/g, '').trim().toUpperCase();
}

export async function startPairing(ctx: AppContext, ip: string): Promise<WallPairStartResponse> {
  const now = ctx.now();
  if (!ctx.pairStartLimiter.tryHit(ip, now.getTime())) throw rateLimited('Too many pairing attempts. Wait a few minutes and try again.');
  const nowIso = now.toISOString();
  if ((await ctx.repo.countActivePairings(nowIso)) >= MAX_ACTIVE_PAIRINGS) throw rateLimited('Too many displays are pairing right now. Try again shortly.');

  let code = '';
  for (let i = 0; i < CODE_ATTEMPTS && !code; i++) {
    const candidate = randomString(PAIRING_ALPHABET, 6);
    if (!(await ctx.repo.findWaitingPairingByCode(candidate, nowIso))) code = candidate;
  }
  if (!code) throw rateLimited('Could not allocate a pairing code. Try again.');

  const secret = randomToken(32);
  const expiresAt = new Date(now.getTime() + LIMITS.wallPairingTtlSeconds * 1000).toISOString();
  const pairing: Pairing = {
    id: newId('pair'),
    code,
    secretHash: sha256Hex(secret),
    status: 'waiting',
    createdAt: nowIso,
    expiresAt,
    claim: null,
  };
  await ctx.repo.createPairing(pairing, LIMITS.wallPairingTtlSeconds);
  return { pairingId: pairing.id, code: formatPairingCode(code), secret, expiresAt };
}

export async function pollPairing(ctx: AppContext, pairingId: string, secret: string | undefined): Promise<WallPairPollResponse> {
  if (!secret || secret.length > MAX_SECRET_LENGTH) throw unauthenticated('Pairing secret required.');
  const secretHash = sha256Hex(secret);
  const nowIso = ctx.now().toISOString();
  const pairing = await ctx.repo.getPairing(pairingId);
  if (!pairing || pairing.expiresAt <= nowIso) return { status: 'expired' };
  if (!safeEqual(pairing.secretHash, secretHash)) throw unauthenticated('Pairing secret does not match.');
  if (pairing.status === 'waiting' || !pairing.claim) return { status: 'waiting', expiresAt: pairing.expiresAt };

  // Conditional delete: exactly one poll receives the token.
  const taken = await ctx.repo.takePairing(pairing.id, (p) => p.status === 'claimed' && p.claim !== null && safeEqual(p.secretHash, secretHash));
  if (!taken?.claim) return { status: 'expired' };
  const displayToken = open(await ctx.wallSecret(), taken.claim.tokenCiphertext, sealContext(taken.id));
  return { status: 'paired', displayToken, displayId: taken.claim.displayId, branchName: taken.claim.branchName };
}

/** Manager side: bind the waiting device to a new display in `branch`. */
export async function claimPairing(
  ctx: AppContext,
  branch: Branch,
  codeInput: string,
  name: string,
  actorId: string,
  content: Display['content'] = 'auto',
): Promise<Display> {
  const code = normalizePairingCode(codeInput);
  const now = ctx.now();
  const nowIso = now.toISOString();
  const pairing = await ctx.repo.findWaitingPairingByCode(code, nowIso);
  if (!pairing) throw notFound('No display is waiting with that code. Check the code on the screen.');

  const token = randomToken(32);
  const display: Display = {
    id: newId('dsp'),
    branchId: branch.id,
    name,
    tokenPrefix: token.slice(0, 6),
    lastSeenAt: null,
    revokedAt: null,
    content,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: actorId,
    updatedBy: actorId,
  };
  await ctx.repo.createDisplay(display, sha256Hex(token));
  const tokenCiphertext = seal(await ctx.wallSecret(), token, sealContext(pairing.id));
  try {
    await ctx.repo.updatePairing(pairing.id, (p) => {
      if (p.status !== 'waiting' || p.expiresAt <= ctx.now().toISOString()) {
        throw new HttpError(409, 'conflict', 'That code was just used or has expired. Ask the display for a new code.');
      }
      return { ...p, status: 'claimed', claim: { displayId: display.id, branchId: branch.id, branchName: branch.name, tokenCiphertext } };
    });
  } catch (err) {
    // The display can never receive its token: revoke it so no orphan credential stays valid.
    await ctx.repo.updateDisplay(display.id, (d) => ({ ...d, revokedAt: ctx.now().toISOString() })).catch(() => undefined);
    throw err;
  }
  return display;
}
