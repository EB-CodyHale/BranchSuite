/**
 * Roster. Visible only for people who share a branch with the caller; members receive PersonLite.
 * Edits follow canEditUser: managers handle member/manager records in their branches only.
 */
import { canEditUser, newId, zUserCreateInput, zUserPreferences, zUserUpdateInput, type User } from '@branchsuite/shared';
import type { Caller } from '../auth/staff.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { created, ok } from '../http/types.js';
import { parse, parsePatch } from '../http/validate.js';
import { audit, GLOBAL_SCOPE, notify, readableBranch, staff, toPersonLite, usersInBranches } from './support.js';

/** Users the caller may see: admins everyone; others people sharing a readable branch. */
function visibleUsers(caller: Caller, users: User[]): User[] {
  return caller.perms.isAdmin ? users : usersInBranches(users, caller.perms.branchIds);
}

function seesFullRecords(caller: Caller): boolean {
  return caller.perms.isAdmin || caller.perms.manageBranchIds.length > 0;
}

function requireKnownBranches(caller: Caller, branchIds: string[]): void {
  const known = new Set(caller.allBranches.map((b) => b.id));
  const unknown = branchIds.filter((b) => !known.has(b));
  if (unknown.length > 0) throw badRequest(`Unknown branch: ${unknown.join(', ')}.`);
}

function check(caller: Caller, target: User | null, next: { role?: User['role']; branchIds?: string[] }): void {
  const verdict = canEditUser({ id: caller.user.id, role: caller.user.role, perms: caller.perms }, target, next);
  if (!verdict.ok) throw forbidden(verdict.reason);
}

/** Audit partition for a user event: their first branch, else the global scope. */
const auditScope = (user: User) => user.branchIds[0] ?? GLOBAL_SCOPE;

export function registerUserRoutes(router: Router): void {
  router.get(
    '/users',
    staff(async (req, ctx, caller) => {
      const branchId = req.query.get('branchId');
      let users = visibleUsers(caller, await ctx.repo.listUsers());
      if (branchId) {
        readableBranch(caller, branchId);
        users = users.filter((u) => u.branchIds.includes(branchId));
      }
      users.sort((a, b) => a.name.localeCompare(b.name));
      if (seesFullRecords(caller)) {
        // A manager sees full records only for people in branches they manage.
        if (caller.perms.isAdmin) return ok(users);
        const managed = new Set(caller.perms.manageBranchIds);
        return ok(users.map((u) => (u.branchIds.some((b) => managed.has(b)) && u.role !== 'admin' ? u : toPersonLite(u))));
      }
      return ok(users.map(toPersonLite));
    }),
  );

  router.post(
    '/users',
    staff(async (req, ctx, caller) => {
      const input = parse(zUserCreateInput, req.body);
      requireKnownBranches(caller, input.branchIds);
      check(caller, null, { role: input.role, branchIds: input.branchIds });
      if (await ctx.repo.findUserByEmail(input.email)) throw conflict('Someone with that email is already on the roster.');
      const nowIso = ctx.now().toISOString();
      const user: User = {
        id: newId('usr'),
        ...input,
        entraOid: null,
        active: true,
        outDates: [],
        preferences: zUserPreferences.parse({}),
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: caller.user.id,
        updatedBy: caller.user.id,
      };
      await ctx.repo.createUser(user);
      await audit(ctx, caller.user.id, { branchId: auditScope(user), entity: 'user', entityId: user.id, action: 'create', summary: `Added ${user.name} as ${user.role}` });
      for (const b of user.branchIds) notify(ctx, b, ['people'], { wall: true });
      return created(user);
    }),
  );

  router.patch(
    '/users/:id',
    staff(async (req, ctx, caller) => {
      const input = parsePatch(zUserUpdateInput, req.body);
      const target = await ctx.repo.getUser(req.params.id!);
      if (!target || !visibleUsers(caller, [target]).length) throw notFound('No such person.');
      if (input.branchIds) requireKnownBranches(caller, input.branchIds);
      check(caller, target, { role: input.role, branchIds: input.branchIds });
      if (target.id === caller.user.id && input.active === false) throw badRequest('You cannot deactivate yourself.');
      const user = await ctx.repo.updateUser(target.id, (current) => {
        // Re-check against the current version: role or branches may have changed since the read.
        check(caller, current, { role: input.role, branchIds: input.branchIds });
        return { ...current, ...input, updatedAt: ctx.now().toISOString(), updatedBy: caller.user.id };
      });
      await audit(ctx, caller.user.id, { branchId: auditScope(user), entity: 'user', entityId: user.id, action: 'update', summary: `Edited ${user.name}: ${Object.keys(input).join(', ')}` });
      for (const b of new Set([...target.branchIds, ...user.branchIds])) notify(ctx, b, ['people'], { wall: true });
      return ok(user);
    }),
  );
}
