/** GET /board: everything the job order board needs for the requested branches in one call. */
import { todayKey, type BoardResponse } from '@branchsuite/shared';
import type { Router } from '../http/router.js';
import { ok } from '../http/types.js';
import { idList } from '../http/validate.js';
import { readableBranch, staff, toPersonLite, usersInBranches, visibleBranches, withoutContacts } from './support.js';

export function registerBoardRoutes(router: Router): void {
  router.get(
    '/board',
    staff(async (req, ctx, caller) => {
      const requested = idList(req.query.get('branches'));
      // Every requested id must be readable (403 otherwise); none requested means all active readable branches.
      const branches = requested.length > 0 ? requested.map((b) => readableBranch(caller, b)) : visibleBranches(caller).filter((b) => b.active);
      const ids = branches.map((b) => b.id);
      const [orderLists, accountLists, users] = await Promise.all([
        Promise.all(ids.map((b) => ctx.repo.listOrders(b, { open: true }))),
        Promise.all(ids.map((b) => ctx.repo.listAccounts(b))),
        ctx.repo.listUsers(),
      ]);
      const now = ctx.now();
      const response: BoardResponse = {
        generatedAt: now.toISOString(),
        orders: orderLists.flat(),
        accounts: accountLists.flat().map(withoutContacts),
        people: usersInBranches(users, ids).map(toPersonLite),
        today: Object.fromEntries(branches.map((b) => [b.id, todayKey(b.timeZone, now)])),
      };
      return ok(response);
    }),
  );
}
