/**
 * Mail-driven tasks: branch tasks are shared; personal tasks live in `personal:<userId>` and are
 * reachable by their owner only (admins included in the "no").
 */
import {
  addDays,
  DEFAULT_TIME_ZONE,
  inferCategory,
  isVisibleOn,
  newId,
  newOpening,
  ROLE_CATEGORY_IDS,
  sortTasks,
  todayKey,
  zDayKey,
  zId,
  zOrder,
  zTaskCreateInput,
  zTaskUpdateInput,
  LIMITS,
  type Account,
  type Order,
  type Task,
  type TasksResponse,
} from '@branchsuite/shared';
import { z } from 'zod';
import type { Caller } from '../auth/staff.js';
import type { AppContext } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { created, ok } from '../http/types.js';
import { idList, parse, parsePatch } from '../http/validate.js';
import { requireOrderAccount } from './orders.js';
import {
  audit,
  managedBranch,
  notify,
  personalScope,
  readableBranch,
  requireBranchUser,
  requireScope,
  staff,
  visibleBranches,
} from './support.js';

const zTasksQuery = z.object({
  view: z.enum(['branch', 'personal', 'combined']).default('branch'),
  branches: z.string().optional(),
  date: zDayKey.optional(),
});

const zTaskOrderInput = z.object({
  accountId: zId,
  unitId: zId.nullable().optional(),
  role: zOrder.shape.role,
  roleCategory: z.enum(ROLE_CATEGORY_IDS).optional(),
  shift: zOrder.shape.shift.optional(),
  days: z.string().trim().max(LIMITS.maxShortText).optional(),
  hours: z.string().trim().max(LIMITS.maxShortText).optional(),
  payRate: zOrder.shape.payRate.optional(),
  openingCount: z.number().int().min(1).max(LIMITS.maxOpeningsPerOrder),
  note: zOrder.shape.note.optional(),
});

const zReassignInput = z.object({ fromUserId: zId, toUserId: zId.nullable() });

interface ScopeView {
  scopeId: string;
  timeZone: string;
}

function stampTask(task: Task, actorId: string, nowIso: string): Task {
  return { ...task, updatedAt: nowIso, updatedBy: actorId };
}

function audited(ctx: AppContext, caller: Caller, task: Task, action: string, summary: string): Promise<void> {
  // Personal tasks are private: they are not written to the branch audit trail.
  if (task.scope !== 'branch' || !task.branchId) return Promise.resolve();
  return audit(ctx, caller.user.id, { branchId: task.branchId, entity: 'task', entityId: task.id, action, summary });
}

async function changeTask(ctx: AppContext, caller: Caller, scopeId: string, id: string, action: string, fn: (task: Task, nowIso: string) => Task): Promise<Task> {
  requireScope(caller, scopeId);
  const task = await ctx.repo.updateTask(scopeId, id, (current) => fn(current, ctx.now().toISOString()));
  await audited(ctx, caller, task, action, `${action}: ${task.title}`);
  notify(ctx, scopeId, ['tasks']);
  return task;
}

export function registerTaskRoutes(router: Router): void {
  router.get(
    '/tasks',
    staff(async (req, ctx, caller) => {
      const q = parse(zTasksQuery, Object.fromEntries(req.query));
      const requested = idList(q.branches ?? null);
      const branches = requested.length > 0 ? requested.map((b) => readableBranch(caller, b)) : visibleBranches(caller).filter((b) => b.active);
      const primaryZone = branches[0]?.timeZone ?? DEFAULT_TIME_ZONE;
      const views: ScopeView[] = [];
      if (q.view !== 'personal') views.push(...branches.map((b) => ({ scopeId: b.id, timeZone: b.timeZone })));
      if (q.view !== 'branch') views.push({ scopeId: personalScope(caller.user.id), timeZone: primaryZone });

      const now = ctx.now();
      const today = todayKey(primaryZone, now);
      const date = q.date ?? today;
      if (date > today) throw badRequest('Future dates have no tasks yet.');

      const accountsById = new Map<string, Account>();
      const lists = await Promise.all(
        views.map(async (view) => {
          const viewToday = todayKey(view.timeZone, now);
          // A completed-at window one day wider on each side covers `date` in every time zone.
          const tasks = await ctx.repo.listTasksForDay(view.scopeId, {
            date,
            completedFrom: `${addDays(date, -1)}T00:00:00.000Z`,
            completedTo: `${addDays(date, 2)}T00:00:00.000Z`,
          });
          if (!view.scopeId.startsWith('personal:')) {
            for (const a of await ctx.repo.listAccounts(view.scopeId)) accountsById.set(a.id, a);
          }
          const viewDate = q.date ?? viewToday;
          return tasks.filter((t) => isVisibleOn(t, viewDate, viewToday, view.timeZone));
        }),
      );
      const response: TasksResponse = {
        generatedAt: now.toISOString(),
        tasks: sortTasks(lists.flat(), accountsById),
        date,
        isToday: date === today,
      };
      return ok(response);
    }),
  );

  router.post(
    '/branches/:b/tasks',
    staff(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const input = parse(zTaskCreateInput, req.body);
      if (input.assigneeId) await requireBranchUser(ctx, branch.id, input.assigneeId, 'assignee');
      if (input.accountId) {
        const account = await ctx.repo.getAccount(branch.id, input.accountId);
        if (!account) throw badRequest('Pick an account in this branch.');
        if (input.unitId && !account.units.some((u) => u.id === input.unitId)) throw badRequest('That unit does not belong to the account.');
      }
      const now = ctx.now();
      const nowIso = now.toISOString();
      const summary = input.summary ?? '';
      const task: Task = {
        id: newId('task'),
        scopeId: branch.id,
        scope: 'branch',
        branchId: branch.id,
        ownerUserId: null,
        boardDate: todayKey(branch.timeZone, now),
        title: input.title,
        summary,
        category: input.category ?? inferCategory(`${input.title}\n${summary}`),
        categorySource: input.category ? 'manual' : 'auto',
        priority: input.priority ?? 'normal',
        status: 'open',
        assigneeId: input.assigneeId ?? null,
        accountId: input.accountId ?? null,
        unitId: input.accountId ? (input.unitId ?? null) : null,
        routing: {
          status: 'manual',
          candidates: input.accountId ? [{ accountId: input.accountId, unitId: input.unitId ?? null, reason: 'Set by a person' }] : [],
        },
        email: null,
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
      await audited(ctx, caller, task, 'create', `Created task: ${task.title}`);
      notify(ctx, branch.id, ['tasks']);
      return created(task);
    }),
  );

  router.patch(
    '/tasks/:scopeId/:id',
    staff(async (req, ctx, caller) => {
      const { scopeId, id } = req.params as { scopeId: string; id: string };
      const scope = requireScope(caller, scopeId);
      const input = parsePatch(zTaskUpdateInput, req.body);
      if (scope.kind === 'branch' && input.assigneeId) await requireBranchUser(ctx, scope.branch.id, input.assigneeId, 'assignee');
      if (scope.kind === 'personal' && input.assigneeId && input.assigneeId !== caller.user.id) {
        throw forbidden('Personal tasks cannot be assigned to someone else.');
      }
      if (input.accountId) {
        if (scope.kind !== 'branch') throw badRequest('Personal tasks are not linked to accounts.');
        const account = await ctx.repo.getAccount(scope.branch.id, input.accountId);
        if (!account) throw badRequest('Pick an account in this branch.');
      }
      return ok(
        await changeTask(ctx, caller, scopeId, id, 'update', (task, nowIso) => {
          const { category, ...rest } = input;
          let next: Task = { ...task, ...rest };
          if (input.accountId === null) next = { ...next, unitId: null };
          if (category === null) next = { ...next, category: inferCategory(`${next.title}\n${next.summary}`), categorySource: 'auto' };
          else if (category !== undefined) next = { ...next, category, categorySource: 'manual' };
          return stampTask(next, caller.user.id, nowIso);
        }),
      );
    }),
  );

  router.post(
    '/tasks/:scopeId/:id/claim',
    staff(async (req, ctx, caller) =>
      ok(
        await changeTask(ctx, caller, req.params.scopeId!, req.params.id!, 'claim', (task, nowIso) =>
          stampTask({ ...task, assigneeId: caller.user.id }, caller.user.id, nowIso),
        ),
      ),
    ),
  );

  router.post(
    '/tasks/:scopeId/:id/complete',
    staff(async (req, ctx, caller) =>
      ok(
        await changeTask(ctx, caller, req.params.scopeId!, req.params.id!, 'complete', (task, nowIso) => {
          if (task.status !== 'open') throw conflict('This task is already completed.');
          return stampTask({ ...task, status: 'done', completedAt: nowIso, completedBy: caller.user.id }, caller.user.id, nowIso);
        }),
      ),
    ),
  );

  router.post(
    '/tasks/:scopeId/:id/reopen',
    staff(async (req, ctx, caller) =>
      ok(
        await changeTask(ctx, caller, req.params.scopeId!, req.params.id!, 'reopen', (task, nowIso) => {
          if (task.status === 'open') throw conflict('This task is already open.');
          return stampTask({ ...task, status: 'open', completedAt: null, completedBy: null, closedByReply: null }, caller.user.id, nowIso);
        }),
      ),
    ),
  );

  router.get(
    '/tasks/:scopeId/:id/messages',
    staff(async (req, ctx, caller) => {
      const { scopeId, id } = req.params as { scopeId: string; id: string };
      requireScope(caller, scopeId);
      const task = await ctx.repo.getTask(scopeId, id);
      if (!task) throw notFound('No such task.');
      return ok(await ctx.repo.listMessages(scopeId, id));
    }),
  );

  router.post(
    '/tasks/:scopeId/:id/create-order',
    staff(async (req, ctx, caller) => {
      const { scopeId, id } = req.params as { scopeId: string; id: string };
      const scope = requireScope(caller, scopeId, 'manage');
      if (scope.kind !== 'branch') throw badRequest('Orders can only be created from branch tasks.');
      const branch = scope.branch;
      const input = parse(zTaskOrderInput, req.body);
      const account = await requireOrderAccount(ctx, branch.id, input.accountId, input.unitId);
      const result = await ctx.repo.createOrderForTask(branch.id, id, (task) => {
        if (task.orderId) throw conflict('An order was already created from this task.');
        const nowIso = ctx.now().toISOString();
        const order: Order = {
          id: newId('ord'),
          branchId: branch.id,
          accountId: account.id,
          unitId: input.unitId ?? null,
          site: task.staffingRequest?.site ?? '',
          role: input.role,
          roleCategory: input.roleCategory ?? task.staffingRequest?.roleCategory ?? 'other',
          shift: input.shift ?? '',
          days: input.days ?? '',
          hours: input.hours ?? '',
          payRate: input.payRate ?? null,
          note: input.note ?? '',
          isPriority: false,
          status: 'active',
          pause: null,
          close: null,
          openings: Array.from({ length: input.openingCount }, () => newOpening(nowIso)),
          source: 'email',
          sourceTaskId: task.id,
          sourceMessageId: null,
          createdAt: nowIso,
          updatedAt: nowIso,
          createdBy: caller.user.id,
          updatedBy: caller.user.id,
        };
        const linked: Task = stampTask(
          { ...task, orderId: order.id, accountId: task.accountId ?? account.id, unitId: task.accountId ? task.unitId : (input.unitId ?? null) },
          caller.user.id,
          nowIso,
        );
        return { task: linked, order };
      });
      await audit(ctx, caller.user.id, {
        branchId: branch.id,
        entity: 'order',
        entityId: result.order.id,
        action: 'create',
        summary: `Created ${result.order.role} for ${account.name} from a task`,
      });
      notify(ctx, branch.id, ['tasks']);
      notify(ctx, branch.id, ['orders'], { wall: true });
      return created(result);
    }),
  );

  router.post(
    '/branches/:b/tasks/reassign',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const input = parse(zReassignInput, req.body);
      if (input.toUserId) await requireBranchUser(ctx, branch.id, input.toUserId, 'new assignee');
      const open = (await ctx.repo.listOpenTasks(branch.id)).filter((t) => t.assigneeId === input.fromUserId);
      let moved = 0;
      for (const t of open) {
        // The mutator may re-run on a concurrency retry; only its final run decides.
        let changed = false;
        await ctx.repo.updateTask(branch.id, t.id, (task) => {
          changed = task.assigneeId === input.fromUserId && task.status === 'open';
          return changed ? stampTask({ ...task, assigneeId: input.toUserId }, caller.user.id, ctx.now().toISOString()) : task;
        });
        if (changed) moved += 1;
      }
      await audit(ctx, caller.user.id, { branchId: branch.id, entity: 'task', entityId: branch.id, action: 'reassign', summary: `Reassigned ${moved} open task(s)` });
      if (moved > 0) notify(ctx, branch.id, ['tasks']);
      return ok({ moved });
    }),
  );
}
