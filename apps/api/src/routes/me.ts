/** The signed-in user: profile, permissions, preferences and personal mailbox opt-in. */
import { newId, zUserPreferences, type Mailbox, type MeResponse, type PersonalMailStatus } from '@branchsuite/shared';
import type { Caller } from '../auth/staff.js';
import type { AppContext } from '../context.js';
import { conflict, notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { Handler } from '../http/types.js';
import { ok } from '../http/types.js';
import { parsePatch } from '../http/validate.js';
import { audit, GLOBAL_SCOPE, staff, visibleBranches, type StaffHandler } from './support.js';

function mailStatus(ctx: AppContext, mailbox: Mailbox | null): PersonalMailStatus {
  if (!mailbox) return { connected: false, address: null, status: 'not_connected', lastSyncAt: null, lastError: null, help: null };
  return {
    connected: mailbox.enabled,
    address: mailbox.address,
    status: mailbox.enabled ? mailbox.status : 'disabled',
    lastSyncAt: mailbox.lastSyncAt,
    lastError: mailbox.lastError,
    help: mailbox.status === 'no_access' ? ctx.config.mailAccessHelp : null,
  };
}

/** Personal mail routes answer 404 when the feature is off. */
function personalMail(handler: StaffHandler): Handler {
  return staff(async (req, ctx, caller) => {
    if (!ctx.config.features.personalMail) throw notFound('Personal mail intake is not enabled.');
    return handler(req, ctx, caller);
  });
}

async function setPersonalMailbox(ctx: AppContext, caller: Caller, enabled: boolean): Promise<Mailbox | null> {
  const existing = await ctx.repo.findPersonalMailbox(caller.user.id);
  const nowIso = ctx.now().toISOString();
  if (!existing) {
    if (!enabled) return null;
    const owner = await ctx.repo.findMailboxByAddress(caller.user.email);
    if (owner) throw conflict('Your address is already set up as a shared mailbox. Ask an admin.');
    const mailbox: Mailbox = {
      id: newId('mbx'),
      address: caller.user.email,
      kind: 'personal',
      branchIds: [],
      userId: caller.user.id,
      brand: '',
      enabled: true,
      status: 'pending',
      lastSyncAt: null,
      lastError: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: caller.user.id,
      updatedBy: caller.user.id,
    };
    return ctx.repo.createMailbox(mailbox);
  }
  return ctx.repo.updateMailbox(existing.id, (m) => ({
    ...m,
    enabled,
    // Re-connecting starts over at 'pending' until the next sync proves Graph access.
    status: enabled ? (m.enabled ? m.status : 'pending') : 'disabled',
    updatedAt: nowIso,
    updatedBy: caller.user.id,
  }));
}

export function registerMeRoutes(router: Router): void {
  router.get(
    '/me',
    staff(async (_req, ctx, caller) => {
      const response: MeResponse = {
        user: caller.user,
        branches: visibleBranches(caller),
        permissions: caller.perms,
        features: { pipeline: ctx.config.features.pipeline, personalMail: ctx.config.features.personalMail, realtime: ctx.publisher.enabled },
      };
      return ok(response);
    }),
  );

  router.patch(
    '/me/preferences',
    staff(async (req, ctx, caller) => {
      const input = parsePatch(zUserPreferences.partial(), req.body);
      const user = await ctx.repo.updateUser(caller.user.id, (u) => ({
        ...u,
        preferences: { ...u.preferences, ...input },
        updatedAt: ctx.now().toISOString(),
        updatedBy: caller.user.id,
      }));
      return ok(user);
    }),
  );

  router.get(
    '/me/mail',
    personalMail(async (_req, ctx, caller) => ok(mailStatus(ctx, await ctx.repo.findPersonalMailbox(caller.user.id)))),
  );

  for (const [action, enabled] of [['connect', true], ['disconnect', false]] as const) {
    router.post(
      `/me/mail/${action}`,
      personalMail(async (_req, ctx, caller) => {
        const mailbox = await setPersonalMailbox(ctx, caller, enabled);
        if (mailbox) {
          await audit(ctx, caller.user.id, {
            branchId: caller.user.branchIds[0] ?? GLOBAL_SCOPE,
            entity: 'mailbox',
            entityId: mailbox.id,
            action,
            summary: `${caller.user.name} ${enabled ? 'connected' : 'disconnected'} their mailbox`,
          });
        }
        return ok(mailStatus(ctx, mailbox));
      }),
    );
  }
}
