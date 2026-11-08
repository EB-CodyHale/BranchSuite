/**
 * Staff authentication: maps the signed-in identity to an ACTIVE roster user and computes the
 * caller's permissions. The roster is authoritative — a valid tenant sign-in is not enough.
 */
import { computePermissions, zUserPreferences, type Branch, type Permissions, type User } from '@branchsuite/shared';
import type { AppContext } from '../context.js';
import { HttpError, unauthenticated } from '../http/errors.js';
import type { ApiRequest } from '../http/types.js';
import { sha256Hex } from '../security/crypto.js';
import { parseClientPrincipal, type StaffIdentity } from './principal.js';

export interface Caller {
  user: User;
  perms: Permissions;
  /** Every branch (active and inactive); routes filter by `perms`. */
  allBranches: Branch[];
}

export const DEV_USER_HEADER = 'x-dev-user';

const notProvisioned = (message = 'Your account is not set up in BranchSuite. Ask a branch manager or admin to add you.') =>
  new HttpError(403, 'not_provisioned', message);

export async function authenticateStaff(req: ApiRequest, ctx: AppContext): Promise<Caller> {
  const user = ctx.config.authMode === 'dev' ? await devUser(req, ctx) : await swaUser(req, ctx);
  if (!user.active) throw notProvisioned('Your BranchSuite account is inactive.');
  const allBranches = await ctx.repo.listBranches();
  return { user, perms: computePermissions(user, allBranches), allBranches };
}

async function devUser(req: ApiRequest, ctx: AppContext): Promise<User> {
  const email = req.headers[DEV_USER_HEADER]?.trim().toLowerCase();
  if (!email) throw unauthenticated('Pick a dev user (x-dev-user header).');
  const user = await ctx.repo.findUserByEmail(email);
  if (!user) throw notProvisioned();
  return user;
}

async function swaUser(req: ApiRequest, ctx: AppContext): Promise<User> {
  const identity = parseClientPrincipal(req.headers['x-ms-client-principal']);
  if (!identity) throw unauthenticated();
  return resolveRosterUser(identity, ctx);
}

/**
 * Roster lookup: by Entra oid first, then by email. A first sign-in by email binds the oid; a
 * roster record already bound to a different oid is refused (a recycled or re-pointed address).
 */
export async function resolveRosterUser(identity: StaffIdentity, ctx: AppContext): Promise<User> {
  if (identity.oid) {
    const byOid = await ctx.repo.findUserByEntraOid(identity.oid);
    if (byOid) return byOid;
  }
  const byEmail = await ctx.repo.findUserByEmail(identity.email);
  if (!byEmail) return bootstrapAdmin(identity, ctx);
  if (identity.oid === null || byEmail.entraOid === identity.oid) return byEmail;
  if (byEmail.entraOid !== null) {
    ctx.log.warn('Roster user is bound to a different Entra identity', { userId: byEmail.id });
    throw notProvisioned('This roster record belongs to a different sign-in. Ask an admin to check your account.');
  }
  return ctx.repo.updateUser(byEmail.id, (u) => {
    if (u.entraOid !== null && u.entraOid !== identity.oid) {
      throw notProvisioned('This roster record belongs to a different sign-in. Ask an admin to check your account.');
    }
    return { ...u, entraOid: identity.oid, updatedAt: ctx.now().toISOString() };
  });
}

/** BOOTSTRAP_ADMIN_EMAILS: the first sign-in of a listed address creates a global admin. */
async function bootstrapAdmin(identity: StaffIdentity, ctx: AppContext): Promise<User> {
  if (!ctx.config.bootstrapAdminEmails.includes(identity.email)) throw notProvisioned();
  const nowIso = ctx.now().toISOString();
  const name = nameFromEmail(identity.email);
  // Deterministic id: two simultaneous first sign-ins create the same record once.
  const user: User = {
    id: `usr_${sha256Hex(identity.email).slice(0, 22)}`,
    email: identity.email,
    entraOid: identity.oid,
    name,
    initials: initialsFrom(name),
    role: 'admin',
    branchIds: [],
    marker: 'black',
    active: true,
    outDates: [],
    preferences: zUserPreferences.parse({}),
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: null,
    updatedBy: null,
  };
  try {
    await ctx.repo.createUser(user);
    ctx.log.info('Bootstrap admin created', { userId: user.id });
    return user;
  } catch (err) {
    if (err instanceof HttpError && err.code === 'conflict') {
      const existing = await ctx.repo.getUser(user.id);
      if (existing) return existing;
    }
    throw err;
  }
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter((p) => /[a-z]/i.test(p));
  const name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ').slice(0, 100);
  return name || 'Admin';
}

function initialsFrom(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase())
    .filter(Boolean)
    .slice(0, 2)
    .join('');
  return letters || 'AD';
}
