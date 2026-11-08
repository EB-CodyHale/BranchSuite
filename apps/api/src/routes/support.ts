/**
 * Helpers shared by route modules: staff authentication wrapper, authorization guards,
 * audit events and realtime notifications.
 */
import {
  canManage,
  canRead,
  newId,
  zPersonLite,
  type Account,
  type AccountLite,
  type AuditEvent,
  type Branch,
  type PersonLite,
  type RealtimeMessage,
  type User,
} from '@branchsuite/shared';
import { authenticateStaff, type Caller } from '../auth/staff.js';
import type { AppContext } from '../context.js';
import { forbidden, notFound } from '../http/errors.js';
import type { ApiRequest, ApiResponse, Handler } from '../http/types.js';
import { groups } from '../realtime/publisher.js';

export type StaffHandler = (req: ApiRequest, ctx: AppContext, caller: Caller) => Promise<ApiResponse>;

/** Wrap a handler so it runs only for an authenticated, active roster user. */
export function staff(handler: StaffHandler): Handler {
  return async (req, ctx) => handler(req, ctx, await authenticateStaff(req, ctx));
}

/** Audit partition for directory-level events that belong to no single branch. */
export const GLOBAL_SCOPE = 'global';

export const PERSONAL_PREFIX = 'personal:';
export const personalScope = (userId: string) => `${PERSONAL_PREFIX}${userId}`;

// ---------- guards ----------
export function requireAdmin(caller: Caller): void {
  if (!caller.perms.isAdmin) throw forbidden('Only an admin can do that.');
}

/** The branch, when the caller may read it (403 otherwise, 404 if it does not exist). */
export function readableBranch(caller: Caller, branchId: string): Branch {
  if (!canRead(caller.perms, branchId) && !caller.perms.isAdmin) throw forbidden('You do not have access to that branch.');
  const branch = caller.allBranches.find((b) => b.id === branchId);
  if (!branch) throw notFound('No such branch.');
  return branch;
}

/** The branch, when the caller has manager powers there. */
export function managedBranch(caller: Caller, branchId: string): Branch {
  if (!canManage(caller.perms, branchId) && !caller.perms.isAdmin) {
    readableBranch(caller, branchId);
    throw forbidden('Only a manager of this branch can do that.');
  }
  const branch = caller.allBranches.find((b) => b.id === branchId);
  if (!branch) throw notFound('No such branch.');
  return branch;
}

/** Branches the caller may see: admin all, others their readable branches. */
export function visibleBranches(caller: Caller): Branch[] {
  if (caller.perms.isAdmin) return caller.allBranches;
  const readable = new Set(caller.perms.branchIds);
  return caller.allBranches.filter((b) => readable.has(b.id));
}

/**
 * Access to a task/mail partition. A personal partition is reachable by its owner only —
 * not by admins — and answers 404 so its existence is not revealed.
 */
export function requireScope(caller: Caller, scopeId: string, level: 'read' | 'manage' = 'read'): { kind: 'branch'; branch: Branch } | { kind: 'personal' } {
  if (scopeId.startsWith(PERSONAL_PREFIX)) {
    if (scopeId !== personalScope(caller.user.id)) throw notFound();
    return { kind: 'personal' };
  }
  return { kind: 'branch', branch: level === 'manage' ? managedBranch(caller, scopeId) : readableBranch(caller, scopeId) };
}

// ---------- shaping ----------
export function toPersonLite(user: User): PersonLite {
  return zPersonLite.parse(user);
}

export function withoutContacts(account: Account): AccountLite {
  const { contacts: _contacts, ...lite } = account;
  return lite;
}

/** Accounts as the caller may see them: members never receive contacts. */
export function accountForCaller(caller: Caller, account: Account): Account {
  return caller.perms.isAdmin || canManage(caller.perms, account.branchId) ? account : withoutContacts(account);
}

/** Roster records that share at least one of `branchIds`. */
export function usersInBranches(users: User[], branchIds: Iterable<string>): User[] {
  const set = new Set(branchIds);
  return users.filter((u) => u.branchIds.some((b) => set.has(b)));
}

/** A referenced user must exist, be active and belong to the branch. */
export async function requireBranchUser(ctx: AppContext, branchId: string, userId: string, label: string): Promise<User> {
  const user = await ctx.repo.getUser(userId);
  if (!user || !user.active || !user.branchIds.includes(branchId)) {
    throw forbidden(`The ${label} must be an active person in this branch.`);
  }
  return user;
}

// ---------- side effects ----------
export async function audit(
  ctx: AppContext,
  actorId: string | null,
  event: Pick<AuditEvent, 'branchId' | 'entity' | 'entityId' | 'action' | 'summary'>,
): Promise<void> {
  try {
    await ctx.repo.addEvent({ id: newId('evt'), ...event, summary: event.summary.slice(0, 500), actorId, at: ctx.now().toISOString() });
  } catch (err) {
    // The mutation already committed; losing an audit line must not turn success into an error.
    ctx.log.error('Audit write failed', { ...event, error: String(err) });
  }
}

type Entity = RealtimeMessage['entities'][number];

/**
 * Fire-and-forget invalidation. Orders, accounts and branch changes also reach the branch wall;
 * candidate and task changes reach staff only.
 */
export function notify(ctx: AppContext, scopeId: string, entities: Entity[], options: { wall?: boolean } = {}): void {
  const targets = [groups.scope(scopeId)];
  if (options.wall) targets.push(groups.wall(scopeId));
  const message: RealtimeMessage = { type: 'invalidate', scopeId, entities, at: ctx.now().toISOString() };
  ctx.publisher.publish(targets, message).catch((err: unknown) => ctx.log.warn('Realtime publish failed', { error: String(err) }));
}
