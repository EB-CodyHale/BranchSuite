/** Job orders: the board's primary resource. Line writes are member actions; everything else is manager-only. */
import {
  addOpenings,
  applyOpeningUpdate,
  newId,
  newOpening,
  removeOpening,
  zAddOpeningsInput,
  zDayKey,
  zOpeningUpdateInput,
  zOrderCloseInput,
  zOrderCreateInput,
  zOrderPauseInput,
  zOrderUpdateInput,
  ORDER_STATUSES,
  type Account,
  type Order,
  type OrderStatus,
} from '@branchsuite/shared';
import { z } from 'zod';
import type { Caller } from '../auth/staff.js';
import type { AppContext } from '../context.js';
import { badRequest, conflict, HttpError } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { created, ok } from '../http/types.js';
import { parse, parsePatch } from '../http/validate.js';
import { audit, managedBranch, notify, readableBranch, staff } from './support.js';

const HISTORY_LIMIT = 500;

const zHistoryQuery = z.object({
  status: z.enum(ORDER_STATUSES).default('closed'),
  /** Day key (branch-agnostic, compared as UTC midnight) or ISO timestamp. */
  since: z.union([zDayKey, z.string().datetime({ offset: true })]).optional(),
});

/** An order's account must be an active customer account of the same branch. */
export async function requireOrderAccount(ctx: AppContext, branchId: string, accountId: string, unitId: string | null | undefined): Promise<Account> {
  const account = await ctx.repo.getAccount(branchId, accountId);
  if (!account || !account.active || account.reserved !== null) throw badRequest('Pick an active customer account in this branch.');
  if (unitId && !account.units.some((u) => u.id === unitId && u.active)) throw badRequest('That unit does not belong to the account.');
  return account;
}

async function commitOrderChange(
  ctx: AppContext,
  caller: Caller,
  branchId: string,
  orderId: string,
  action: string,
  summary: string,
  change: (order: Order, nowIso: string) => Order,
): Promise<Order> {
  const order = await ctx.repo.updateOrder(branchId, orderId, (current) => change(current, ctx.now().toISOString()));
  await audit(ctx, caller.user.id, { branchId, entity: 'order', entityId: orderId, action, summary });
  notify(ctx, branchId, ['orders'], { wall: true });
  return order;
}

function requireStatus(order: Order, allowed: OrderStatus[], verb: string): void {
  if (!allowed.includes(order.status)) throw conflict(`A ${order.status} order cannot be ${verb}.`);
}

function stamp(order: Order, actorId: string, nowIso: string): Order {
  return { ...order, updatedAt: nowIso, updatedBy: actorId };
}

export function registerOrderRoutes(router: Router): void {
  router.get(
    '/branches/:b/orders',
    staff(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const q = parse(zHistoryQuery, Object.fromEntries(req.query));
      const since = q.since === undefined ? undefined : q.since.length === 10 ? `${q.since}T00:00:00.000Z` : new Date(q.since).toISOString();
      const orders = await ctx.repo.listOrders(branch.id, { status: q.status, ...(since ? { updatedSince: since } : {}), limit: HISTORY_LIMIT });
      return ok(orders);
    }),
  );

  router.post(
    '/branches/:b/orders',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const input = parse(zOrderCreateInput, req.body);
      const account = await requireOrderAccount(ctx, branch.id, input.accountId, input.unitId);
      const nowIso = ctx.now().toISOString();
      const order: Order = {
        id: newId('ord'),
        branchId: branch.id,
        accountId: account.id,
        unitId: input.unitId ?? null,
        site: input.site ?? '',
        role: input.role,
        roleCategory: input.roleCategory ?? 'other',
        shift: input.shift ?? '',
        days: input.days ?? '',
        hours: input.hours ?? '',
        payRate: input.payRate ?? null,
        note: input.note ?? '',
        isPriority: input.isPriority ?? false,
        status: 'active',
        pause: null,
        close: null,
        openings: Array.from({ length: input.openingCount }, () => newOpening(nowIso)),
        source: 'manual',
        sourceTaskId: null,
        sourceMessageId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: caller.user.id,
        updatedBy: caller.user.id,
      };
      await ctx.repo.createOrder(order);
      await audit(ctx, caller.user.id, {
        branchId: branch.id,
        entity: 'order',
        entityId: order.id,
        action: 'create',
        summary: `Created ${order.role} for ${account.name} with ${input.openingCount} opening(s)`,
      });
      notify(ctx, branch.id, ['orders'], { wall: true });
      return created(order);
    }),
  );

  router.patch(
    '/branches/:b/orders/:id',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const input = parsePatch(zOrderUpdateInput, req.body);
      const current = await ctx.repo.getOrder(branch.id, req.params.id!);
      if (!current) throw new HttpError(404, 'not_found', 'No such order.');
      const accountId = input.accountId ?? current.accountId;
      // Moving to another account drops a unit that belonged to the old one unless a new unit is given.
      const unitId = input.unitId !== undefined ? input.unitId : input.accountId && input.accountId !== current.accountId ? null : current.unitId;
      if (input.accountId !== undefined || input.unitId !== undefined) await requireOrderAccount(ctx, branch.id, accountId, unitId);
      return ok(
        await commitOrderChange(ctx, caller, branch.id, current.id, 'update', `Edited ${Object.keys(input).join(', ') || 'nothing'}`, (order, nowIso) => {
          requireStatus(order, ['draft', 'active', 'paused'], 'edited');
          return stamp({ ...order, ...input, accountId, unitId }, caller.user.id, nowIso);
        }),
      );
    }),
  );

  router.post(
    '/branches/:b/orders/:id/openings',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const { count } = parse(zAddOpeningsInput, req.body);
      return ok(
        await commitOrderChange(ctx, caller, branch.id, req.params.id!, 'add_openings', `Added ${count} opening(s)`, (order, nowIso) => {
          requireStatus(order, ['draft', 'active', 'paused'], 'changed');
          return addOpenings(order, count, caller.user.id, nowIso);
        }),
      );
    }),
  );

  router.delete(
    '/branches/:b/orders/:id/openings/:oid',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      return ok(
        await commitOrderChange(ctx, caller, branch.id, req.params.id!, 'remove_opening', 'Removed an opening', (order, nowIso) => {
          requireStatus(order, ['draft', 'active', 'paused'], 'changed');
          return removeOpening(order, req.params.oid!, caller.user.id, nowIso);
        }),
      );
    }),
  );

  router.put(
    '/branches/:b/orders/:id/openings/:oid',
    staff(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const input = parse(zOpeningUpdateInput, req.body);
      const summary = input.state === 'open' ? 'Cleared a line' : `Marked a line ${input.state}${input.initials ? ` (${input.initials})` : ''}`;
      return ok(
        await commitOrderChange(ctx, caller, branch.id, req.params.id!, 'line', summary, (order, nowIso) =>
          applyOpeningUpdate(order, req.params.oid!, input, caller.user.id, nowIso),
        ),
      );
    }),
  );

  router.post(
    '/branches/:b/orders/:id/pause',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const input = parse(zOrderPauseInput, req.body ?? {});
      return ok(
        await commitOrderChange(ctx, caller, branch.id, req.params.id!, 'pause', `Paused${input.reason ? `: ${input.reason}` : ''}`, (order, nowIso) => {
          requireStatus(order, ['active'], 'paused');
          return stamp(
            { ...order, status: 'paused', pause: { reason: input.reason, at: nowIso, by: caller.user.id, resumeOn: input.resumeOn ?? null } },
            caller.user.id,
            nowIso,
          );
        }),
      );
    }),
  );

  router.post(
    '/branches/:b/orders/:id/resume',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      return ok(
        await commitOrderChange(ctx, caller, branch.id, req.params.id!, 'resume', 'Resumed', (order, nowIso) => {
          requireStatus(order, ['paused'], 'resumed');
          return resumeOrder(order, caller.user.id, nowIso);
        }),
      );
    }),
  );

  router.post(
    '/branches/:b/orders/:id/close',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const input = parse(zOrderCloseInput, req.body);
      return ok(
        await commitOrderChange(ctx, caller, branch.id, req.params.id!, 'close', `Closed (${input.reason})${input.note ? `: ${input.note}` : ''}`, (order, nowIso) => {
          requireStatus(order, ['draft', 'active', 'paused'], 'closed');
          return stamp(
            { ...order, status: 'closed', pause: null, close: { reason: input.reason, note: input.note, at: nowIso, by: caller.user.id } },
            caller.user.id,
            nowIso,
          );
        }),
      );
    }),
  );

  router.post(
    '/branches/:b/orders/:id/reopen',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      return ok(
        await commitOrderChange(ctx, caller, branch.id, req.params.id!, 'reopen', 'Reopened', (order, nowIso) => {
          requireStatus(order, ['closed'], 'reopened');
          return stamp({ ...order, status: 'active', close: null }, caller.user.id, nowIso);
        }),
      );
    }),
  );

  router.post(
    '/branches/:b/orders/:id/publish',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      return ok(
        await commitOrderChange(ctx, caller, branch.id, req.params.id!, 'publish', 'Published draft', (order, nowIso) => {
          requireStatus(order, ['draft'], 'published');
          return stamp({ ...order, status: 'active' }, caller.user.id, nowIso);
        }),
      );
    }),
  );

  router.get(
    '/branches/:b/orders/:id/history',
    staff(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      return ok(await ctx.repo.listEvents(branch.id, 'order', req.params.id!));
    }),
  );
}

/** paused → active. Also used by the maintenance timer (actor null). */
export function resumeOrder(order: Order, actorId: string | null, nowIso: string): Order {
  return { ...order, status: 'active', pause: null, updatedAt: nowIso, updatedBy: actorId };
}
