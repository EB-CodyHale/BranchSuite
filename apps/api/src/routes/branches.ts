/** Branches. Admins create and edit; a manager may change only wall and settings of their branch. */
import { generateWallCode, zBranchCreateInput, zBranchSettings, zBranchUpdateInput, zWallSettings, DEFAULT_TIME_ZONE, type Branch } from '@branchsuite/shared';
import { forbidden } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { created, ok } from '../http/types.js';
import { parse, parsePatch } from '../http/validate.js';
import { secureRandom } from '../security/crypto.js';
import { newAccount } from './accounts.js';
import { audit, GLOBAL_SCOPE, managedBranch, notify, requireAdmin, staff, visibleBranches } from './support.js';

const MANAGER_EDITABLE = new Set(['wall', 'settings']);

export function registerBranchRoutes(router: Router): void {
  router.get(
    '/branches',
    staff(async (_req, _ctx, caller) => ok(visibleBranches(caller))),
  );

  router.post(
    '/branches',
    staff(async (req, ctx, caller) => {
      requireAdmin(caller);
      const input = parse(zBranchCreateInput, req.body);
      const nowIso = ctx.now().toISOString();
      const branch: Branch = {
        id: `branch-${input.code.toLowerCase()}`,
        code: input.code,
        name: input.name,
        timeZone: input.timeZone ?? DEFAULT_TIME_ZONE,
        brands: input.brands ?? [],
        settings: zBranchSettings.parse({}),
        wall: zWallSettings.parse({}),
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: caller.user.id,
        updatedBy: caller.user.id,
      };
      await ctx.repo.createBranch(branch);
      // Every branch gets its reserved Internal account so team mail routes deterministically.
      await ctx.repo.createAccount(
        newAccount(branch.id, { name: 'Internal', reserved: 'internal', wall: generateWallCode([], secureRandom) }, [], caller.user.id, nowIso),
      );
      await audit(ctx, caller.user.id, { branchId: GLOBAL_SCOPE, entity: 'branch', entityId: branch.id, action: 'create', summary: `Created branch ${branch.name}` });
      return created(branch);
    }),
  );

  router.patch(
    '/branches/:b',
    staff(async (req, ctx, caller) => {
      const branchId = req.params.b!;
      managedBranch(caller, branchId);
      const input = parsePatch(zBranchUpdateInput, req.body);
      if (!caller.perms.isAdmin) {
        const blocked = Object.keys(input).filter((k) => !MANAGER_EDITABLE.has(k));
        if (blocked.length > 0) throw forbidden(`Only an admin can change: ${blocked.join(', ')}.`);
      }
      const branch = await ctx.repo.updateBranch(branchId, (current) => ({
        ...current,
        ...input,
        settings: { ...current.settings, ...input.settings },
        wall: { ...current.wall, ...input.wall },
        updatedAt: ctx.now().toISOString(),
        updatedBy: caller.user.id,
      }));
      await audit(ctx, caller.user.id, { branchId, entity: 'branch', entityId: branchId, action: 'update', summary: `Edited branch: ${Object.keys(input).join(', ')}` });
      notify(ctx, branchId, ['branch', 'wall'], { wall: true });
      return ok(branch);
    }),
  );
}
