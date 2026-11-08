/** Wall display endpoints and display management. Wall endpoints never accept staff identity. */
import { zDisplayClaimInput, zDisplayUpdateInput, type RealtimeNegotiateResponse } from '@branchsuite/shared';
import { authenticateDisplay } from '../auth/display.js';
import { claimPairing, PAIRING_SECRET_HEADER, pollPairing, startPairing } from '../auth/pairing.js';
import { conflict, notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { bytes, created, ok } from '../http/types.js';
import { parse } from '../http/validate.js';
import { groups } from '../realtime/publisher.js';
import { audit, managedBranch, notify, staff } from './support.js';
import { buildWallFeed } from './wallFeed.js';
import { imageMediaIds, showsWhiteboard, todaysBoard } from './whiteboardView.js';

export const WALL_POLL_SECONDS = 60;

export function registerWallRoutes(router: Router): void {
  router.post('/wall/pair/start', async (req, ctx) => created(await startPairing(ctx, req.ip)));

  router.get('/wall/pair/:pairingId', async (req, ctx) => ok(await pollPairing(ctx, req.params.pairingId!, req.headers[PAIRING_SECRET_HEADER])));

  router.get('/wall/feed', async (req, ctx) => {
    const display = await authenticateDisplay(req, ctx);
    const branch = await ctx.repo.getBranch(display.branchId);
    if (!branch || !branch.active) throw notFound('This display’s branch is not active.');
    return ok(await buildWallFeed(ctx, branch, { displayContent: display.content }));
  });

  /**
   * WALL MEDIA INVARIANT: bytes are served to a display only while it is shown today's board (live window for
 * 'auto' screens, all day for 'whiteboard' screens, never for 'board' screens)
   * AND one of that board's image blocks references the id. Every other case is the same 404 (not 403),
   * so a display cannot probe which media exist or when a board is scheduled.
   */
  router.get('/wall/media/:id', async (req, ctx) => {
    const display = await authenticateDisplay(req, ctx);
    const missing = () => notFound('No such image.');
    const branch = await ctx.repo.getBranch(display.branchId);
    if (!branch || !branch.active) throw missing();
    const now = ctx.now();
    const board = await todaysBoard(ctx, branch, now);
    const id = req.params.id!;
    if (!showsWhiteboard(ctx, branch, board, display.content, now) || !imageMediaIds(board).has(id)) throw missing();
    const media = await ctx.repo.getMedia(branch.id, id);
    if (!media) throw missing();
    const content = await ctx.media.get(branch.id, media.id);
    if (!content) throw missing();
    return bytes(content, media.contentType, { 'cache-control': 'no-store' });
  });

  router.post('/wall/negotiate', async (req, ctx) => {
    const display = await authenticateDisplay(req, ctx);
    const { url } = await ctx.publisher.negotiate(`display:${display.id}`, [groups.wall(display.branchId)]);
    const response: RealtimeNegotiateResponse = { url, pollSeconds: WALL_POLL_SECONDS };
    return ok(response);
  });

  router.get(
    '/branches/:b/displays',
    staff(async (req, ctx, caller) => ok(await ctx.repo.listDisplays(managedBranch(caller, req.params.b!).id))),
  );

  router.post(
    '/branches/:b/displays/claim',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const input = parse(zDisplayClaimInput, req.body);
      const display = await claimPairing(ctx, branch, input.code, input.name, caller.user.id, input.content);
      await audit(ctx, caller.user.id, { branchId: branch.id, entity: 'display', entityId: display.id, action: 'pair', summary: `Paired display ${display.name}` });
      return created(display);
    }),
  );

  router.patch(
    '/branches/:b/displays/:id',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const input = parse(zDisplayUpdateInput, req.body);
      const existing = await ctx.repo.getDisplay(req.params.id!);
      if (!existing || existing.branchId !== branch.id) throw notFound('No such display in this branch.');
      if (existing.revokedAt) throw conflict('This display was revoked. Pair it again to use it.');
      const display = await ctx.repo.updateDisplay(existing.id, (d) => ({
        ...d,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        updatedAt: ctx.now().toISOString(),
        updatedBy: caller.user.id,
      }));
      const changes = [
        input.name !== undefined && input.name !== existing.name ? `renamed to ${display.name}` : null,
        input.content !== undefined && input.content !== (existing.content ?? 'auto') ? `now shows ${display.content}` : null,
      ].filter(Boolean);
      if (changes.length > 0) {
        await audit(ctx, caller.user.id, { branchId: branch.id, entity: 'display', entityId: display.id, action: 'update', summary: `Display ${existing.name}: ${changes.join(', ')}` });
        // The screen refetches now, so a content change takes effect immediately.
        notify(ctx, branch.id, ['wall'], { wall: true });
      }
      return ok(display);
    }),
  );

  router.post(
    '/branches/:b/displays/:id/revoke',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const existing = await ctx.repo.getDisplay(req.params.id!);
      if (!existing || existing.branchId !== branch.id) throw notFound('No such display in this branch.');
      const display = await ctx.repo.updateDisplay(existing.id, (d) =>
        d.revokedAt ? d : { ...d, revokedAt: ctx.now().toISOString(), updatedAt: ctx.now().toISOString(), updatedBy: caller.user.id },
      );
      await audit(ctx, caller.user.id, { branchId: branch.id, entity: 'display', entityId: display.id, action: 'revoke', summary: `Revoked display ${display.name}` });
      // Every wall in the branch refetches; the revoked one gets its 401 now instead of at its next poll.
      notify(ctx, branch.id, ['wall'], { wall: true });
      return ok(display);
    }),
  );
}
