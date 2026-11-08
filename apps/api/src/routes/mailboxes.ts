/** Mailbox administration and filtered-mail review. */
import {
  inferCategory,
  newId,
  todayKey,
  DEFAULT_TIME_ZONE,
  zMailboxCreateInput,
  zMailboxUpdateInput,
  type Mailbox,
  type Task,
} from '@branchsuite/shared';
import type { Caller } from '../auth/staff.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { created, ok } from '../http/types.js';
import { parse, parsePatch } from '../http/validate.js';
import { audit, GLOBAL_SCOPE, managedBranch, notify, requireAdmin, requireScope, staff } from './support.js';

function requireKnownBranches(caller: Caller, branchIds: string[]): void {
  const known = new Set(caller.allBranches.map((b) => b.id));
  if (branchIds.some((b) => !known.has(b))) throw badRequest('Every branch must exist.');
}

const auditScope = (m: Mailbox) => m.branchIds[0] ?? GLOBAL_SCOPE;

export function registerMailboxRoutes(router: Router): void {
  router.get(
    '/mailboxes',
    staff(async (_req, ctx, caller) => {
      const all = await ctx.repo.listMailboxes();
      if (caller.perms.isAdmin) return ok(all);
      const managed = new Set(caller.perms.manageBranchIds);
      if (managed.size === 0) throw forbidden('Only managers and admins can see mailboxes.');
      return ok(all.filter((m) => m.kind === 'branch' && m.branchIds.some((b) => managed.has(b))));
    }),
  );

  router.post(
    '/mailboxes',
    staff(async (req, ctx, caller) => {
      requireAdmin(caller);
      const input = parse(zMailboxCreateInput, req.body);
      requireKnownBranches(caller, input.branchIds);
      if (await ctx.repo.findMailboxByAddress(input.address)) throw conflict('That mailbox is already set up.');
      const nowIso = ctx.now().toISOString();
      const mailbox: Mailbox = {
        id: newId('mbx'),
        address: input.address,
        kind: 'branch',
        branchIds: input.branchIds,
        userId: null,
        brand: input.brand ?? '',
        enabled: input.enabled ?? true,
        status: input.enabled === false ? 'disabled' : 'pending',
        lastSyncAt: null,
        lastError: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: caller.user.id,
        updatedBy: caller.user.id,
      };
      await ctx.repo.createMailbox(mailbox);
      await audit(ctx, caller.user.id, { branchId: auditScope(mailbox), entity: 'mailbox', entityId: mailbox.id, action: 'create', summary: `Added mailbox ${mailbox.address}` });
      return created(mailbox);
    }),
  );

  router.patch(
    '/mailboxes/:id',
    staff(async (req, ctx, caller) => {
      requireAdmin(caller);
      const input = parsePatch(zMailboxUpdateInput, req.body);
      if (input.branchIds) requireKnownBranches(caller, input.branchIds);
      const mailbox = await ctx.repo.updateMailbox(req.params.id!, (m) => {
        if (m.kind === 'personal' && input.branchIds) throw badRequest('Personal mailboxes do not serve branches.');
        const status = input.enabled === undefined ? m.status : input.enabled ? (m.enabled ? m.status : 'pending') : 'disabled';
        return { ...m, ...input, status, updatedAt: ctx.now().toISOString(), updatedBy: caller.user.id };
      });
      await audit(ctx, caller.user.id, { branchId: auditScope(mailbox), entity: 'mailbox', entityId: mailbox.id, action: 'update', summary: `Edited mailbox ${mailbox.address}: ${Object.keys(input).join(', ')}` });
      return ok(mailbox);
    }),
  );

  router.post(
    '/mailboxes/:id/sync',
    staff(async (req, ctx, caller) => {
      requireAdmin(caller);
      const mailbox = await ctx.repo.getMailbox(req.params.id!);
      if (!mailbox) throw notFound('No such mailbox.');
      await ctx.mail.requestSync(mailbox.id);
      return ok({ queued: true });
    }),
  );

  router.get(
    '/branches/:b/mail/filtered',
    staff(async (req, ctx, caller) => ok(await ctx.repo.listFiltered(managedBranch(caller, req.params.b!).id))),
  );

  router.post(
    '/mail/filtered/:scopeId/:id/promote',
    staff(async (req, ctx, caller) => {
      const { scopeId, id } = req.params as { scopeId: string; id: string };
      const scope = requireScope(caller, scopeId, 'manage');
      const taskId = newId('task');
      // Claim the filtered message first: exactly one promotion wins.
      const filtered = await ctx.repo.updateFiltered(scopeId, id, (f) => {
        if (f.promotedTaskId) throw conflict('This message was already promoted to a task.');
        return { ...f, promotedTaskId: taskId };
      });
      const now = ctx.now();
      const nowIso = now.toISOString();
      const timeZone = scope.kind === 'branch' ? scope.branch.timeZone : DEFAULT_TIME_ZONE;
      const task: Task = {
        id: taskId,
        scopeId,
        scope: scope.kind,
        branchId: scope.kind === 'branch' ? scope.branch.id : null,
        ownerUserId: scope.kind === 'personal' ? caller.user.id : null,
        boardDate: todayKey(timeZone, now),
        title: (filtered.subject.trim() || '(no subject)').slice(0, 200),
        summary: filtered.excerpt,
        category: inferCategory(`${filtered.subject}\n${filtered.excerpt}`),
        categorySource: 'auto',
        priority: 'normal',
        status: 'open',
        assigneeId: null,
        accountId: null,
        unitId: null,
        routing: { status: 'unmatched', candidates: [] },
        email: {
          mailboxId: filtered.mailboxId,
          conversationId: '',
          fromAddress: filtered.fromAddress,
          fromName: filtered.fromName,
          subject: filtered.subject,
          receivedAt: filtered.receivedAt,
          webLink: null,
          messageCount: 1,
          lastMessageAt: filtered.receivedAt,
        },
        deadline: null,
        staffingRequest: null,
        orderId: null,
        completedAt: null,
        completedBy: null,
        closedByReply: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: caller.user.id,
        updatedBy: caller.user.id,
      };
      await ctx.repo.createTask(task);
      if (task.branchId) {
        await audit(ctx, caller.user.id, { branchId: task.branchId, entity: 'task', entityId: task.id, action: 'promote', summary: `Promoted filtered mail: ${task.title}` });
      }
      notify(ctx, scopeId, ['tasks']);
      return created(task);
    }),
  );
}
