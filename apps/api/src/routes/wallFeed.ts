/**
 * Builds exactly what a wall display receives. Shared by /wall/feed and the staff preview.
 *
 * Scheduled takeover: while today's whiteboard is live, mode = 'whiteboard' and the resolved board is
 * attached; otherwise mode = 'board' and NO whiteboard content is included (security invariant).
 * nextModeChangeAt is always set (null when no switch is scheduled today) so displays refetch at the edge.
 */
import { nextModeChange, toWallFeed, type Branch, type WallFeed } from '@branchsuite/shared';
import type { AppContext } from '../context.js';
import { wallOrderKey } from '../security/crypto.js';
import { toPersonLite, usersInBranches, withoutContacts } from './support.js';
import { buildWhiteboardView, isBoardLive, todaysBoard } from './whiteboardView.js';

export interface WallFeedOptions {
  /**
   * Staff preview only: render today's board even outside its window (so a manager can check the
   * takeover), with staff media URLs. Never set for display requests.
   */
  preview?: { forceWhiteboard: boolean };
}

export async function buildWallFeed(ctx: AppContext, branch: Branch, options: WallFeedOptions = {}): Promise<WallFeed> {
  const now = ctx.now();
  const [orders, accounts, users, secret, board] = await Promise.all([
    ctx.repo.listOrders(branch.id, { open: true }),
    ctx.repo.listAccounts(branch.id),
    ctx.repo.listUsers(),
    ctx.wallSecret(),
    todaysBoard(ctx, branch, now),
  ]);
  const feed = toWallFeed({
    branch,
    orders,
    accounts: accounts.map(withoutContacts),
    people: usersInBranches(users, [branch.id]).map(toPersonLite),
    now,
    keyFor: (orderId) => wallOrderKey(secret, branch.id, orderId),
  });
  // The dev live switch has no schedule; manual on/off changes are pushed over realtime.
  feed.nextModeChangeAt = ctx.config.devWhiteboardLive && board && board.live !== 'off' ? null : nextModeChange(board, branch.timeZone, now);

  const live = isBoardLive(ctx, branch, board, now);
  const forced = options.preview?.forceWhiteboard === true && board !== null;
  if (board && (live || forced)) {
    feed.mode = 'whiteboard';
    feed.whiteboard = await buildWhiteboardView(ctx, branch, board, options.preview ? 'staff' : 'wall');
  } else {
    feed.mode = 'board';
    delete feed.whiteboard;
  }
  return feed;
}
