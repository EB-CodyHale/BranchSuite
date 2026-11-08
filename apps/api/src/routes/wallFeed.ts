/** Builds exactly what a wall display receives. Shared by /wall/feed and the staff preview. */
import { toWallFeed, type Branch, type WallFeed } from '@branchsuite/shared';
import type { AppContext } from '../context.js';
import { wallOrderKey } from '../security/crypto.js';
import { toPersonLite, usersInBranches, withoutContacts } from './support.js';

export async function buildWallFeed(ctx: AppContext, branch: Branch): Promise<WallFeed> {
  const [orders, accounts, users, secret] = await Promise.all([
    ctx.repo.listOrders(branch.id, { open: true }),
    ctx.repo.listAccounts(branch.id),
    ctx.repo.listUsers(),
    ctx.wallSecret(),
  ]);
  return toWallFeed({
    branch,
    orders,
    accounts: accounts.map(withoutContacts),
    people: usersInBranches(users, [branch.id]).map(toPersonLite),
    now: ctx.now(),
    keyFor: (orderId) => wallOrderKey(secret, branch.id, orderId),
  });
}
