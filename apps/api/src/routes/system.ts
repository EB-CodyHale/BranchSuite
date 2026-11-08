/** Health, realtime negotiation for staff, and the dev-only user picker. */
import type { RealtimeNegotiateResponse } from '@branchsuite/shared';
import { notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { ok } from '../http/types.js';
import { groups } from '../realtime/publisher.js';
import { personalScope, staff } from './support.js';

export const STAFF_POLL_SECONDS = 30;

export function registerSystemRoutes(router: Router): void {
  router.get('/health', async (_req, ctx) => ok({ ok: true, version: ctx.config.version }));

  router.post(
    '/realtime/negotiate',
    staff(async (_req, ctx, caller) => {
      const scopes = [...caller.perms.branchIds, personalScope(caller.user.id)];
      const { url } = await ctx.publisher.negotiate(caller.user.id, scopes.map(groups.scope));
      const response: RealtimeNegotiateResponse = { url, pollSeconds: STAFF_POLL_SECONDS };
      return ok(response);
    }),
  );

  // Dev auth only: lists roster users for the "Sign in as…" picker. 404 in any other mode.
  router.get('/dev/users', async (_req, ctx) => {
    if (ctx.config.authMode !== 'dev') throw notFound('No such API route.');
    const users = await ctx.repo.listUsers();
    return ok(
      users
        .filter((u) => u.active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((u) => ({ email: u.email, name: u.name, initials: u.initials, role: u.role, marker: u.marker, branchIds: u.branchIds })),
    );
  });
}
