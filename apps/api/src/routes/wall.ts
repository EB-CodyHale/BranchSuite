/** Wall display endpoints and display management. Wall endpoints never accept staff identity. */
import { zDisplayClaimInput, type RealtimeNegotiateResponse } from '@branchsuite/shared';
import { authenticateDisplay } from '../auth/display.js';
import { claimPairing, PAIRING_SECRET_HEADER, pollPairing, startPairing } from '../auth/pairing.js';
import { notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { created, ok } from '../http/types.js';
import { parse } from '../http/validate.js';
import { groups } from '../realtime/publisher.js';
import { audit, managedBranch, staff } from './support.js';
import { buildWallFeed } from './wallFeed.js';

export const WALL_POLL_SECONDS = 60;

export function registerWallRoutes(router: Router): void {
  router.post('/wall/pair/start', async (req, ctx) => created(await startPairing(ctx, req.ip)));

  router.get('/wall/pair/:pairingId', async (req, ctx) => ok(await pollPairing(ctx, req.params.pairingId!, req.headers[PAIRING_SECRET_HEADER])));

  router.get('/wall/feed', async (req, ctx) => {
    const display = await authenticateDisplay(req, ctx);
    const branch = await ctx.repo.getBranch(display.branchId);
    if (!branch || !branch.active) throw notFound('This display’s branch is not active.');
    return ok(await buildWallFeed(ctx, branch));
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
      const display = await claimPairing(ctx, branch, input.code, input.name, caller.user.id);
      await audit(ctx, caller.user.id, { branchId: branch.id, entity: 'display', entityId: display.id, action: 'pair', summary: `Paired display ${display.name}` });
      return created(display);
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
      return ok(display);
    }),
  );
}
