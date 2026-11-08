/**
 * Whiteboard resolution shared by staff routes, the wall feed and wall media. The live decision is made
 * here once (isBoardLive), so the feed and the media gate can never disagree.
 */
import {
  isWhiteboardLive,
  todayKey,
  toWhiteboardView,
  whiteboardPaths,
  type Branch,
  type Media,
  type Whiteboard,
  type DisplayContent,
  type WhiteboardView,
} from '@branchsuite/shared';
import type { AppContext } from '../context.js';
import { toPersonLite, usersInBranches, withoutContacts } from './support.js';

/**
 * Authoritative "is this board live right now" for the API: the shared rule, plus the dev-only
 * DEV_WHITEBOARD_LIVE switch (config refuses it outside AUTH_MODE=dev) which forces today's board live
 * unless a manager set it to 'off'.
 */
export function isBoardLive(ctx: AppContext, branch: Branch, wb: Whiteboard | null, now: Date = ctx.now()): wb is Whiteboard {
  if (!wb || wb.branchId !== branch.id) return false;
  if (isWhiteboardLive(wb, branch.timeZone, now)) return true;
  return ctx.config.devWhiteboardLive && wb.live !== 'off' && wb.date === todayKey(branch.timeZone, now);
}

/**
 * Does this screen show today's whiteboard right now? The single rule behind both the wall feed and wall
 * media, so a display can never fetch an image it would not be shown.
 * - 'board': never. 'whiteboard': whenever today's board exists (office TVs). 'auto': only while live.
 * Display records created before `content` existed count as 'auto'.
 */
export function showsWhiteboard(
  ctx: AppContext,
  branch: Branch,
  wb: Whiteboard | null,
  content: DisplayContent | undefined,
  now: Date = ctx.now(),
): wb is Whiteboard {
  const mode = content ?? 'auto';
  if (mode === 'board' || !wb || wb.branchId !== branch.id) return false;
  if (mode === 'whiteboard') return wb.date === todayKey(branch.timeZone, now);
  return isBoardLive(ctx, branch, wb, now);
}

/** Today's (branch-local) board, or null. */
export async function todaysBoard(ctx: AppContext, branch: Branch, now: Date = ctx.now()): Promise<Whiteboard | null> {
  return ctx.repo.getWhiteboard(branch.id, todayKey(branch.timeZone, now));
}

export function imageMediaIds(wb: Pick<Whiteboard, 'blocks'>): Set<string> {
  const ids = new Set<string>();
  for (const block of wb.blocks) if (block.kind === 'image') ids.add(block.mediaId);
  return ids;
}

/** Media metadata for the ids that exist in this branch. */
export async function loadMedia(ctx: AppContext, branchId: string, ids: Iterable<string>): Promise<Map<string, Media>> {
  const found = await Promise.all([...new Set(ids)].map((id) => ctx.repo.getMedia(branchId, id)));
  return new Map(found.filter((m): m is Media => m !== null).map((m) => [m.id, m] as const));
}

/**
 * Resolve a board for display. `audience` picks the media URL family: staff session routes, or the
 * display-token route (served only while the board is live).
 */
export async function buildWhiteboardView(ctx: AppContext, branch: Branch, wb: Whiteboard, audience: 'staff' | 'wall'): Promise<WhiteboardView> {
  const now = ctx.now();
  const [orders, accounts, users, media] = await Promise.all([
    ctx.repo.listOrders(branch.id, { open: true }),
    ctx.repo.listAccounts(branch.id),
    ctx.repo.listUsers(),
    loadMedia(ctx, branch.id, imageMediaIds(wb)),
  ]);
  const view = toWhiteboardView(wb, {
    timeZone: branch.timeZone,
    now,
    orders,
    accounts: accounts.map(withoutContacts),
    people: usersInBranches(users, [branch.id]).filter((u) => u.active).map(toPersonLite),
    mediaUrl: (id) => (media.has(id) ? (audience === 'wall' ? whiteboardPaths.wallMedia(id) : whiteboardPaths.media(branch.id, id)) : null),
    media,
  });
  return { ...view, isLive: isBoardLive(ctx, branch, wb, now) };
}
