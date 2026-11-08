/**
 * Candidate pipeline (feature flag `pipeline`). Any change that touches an order line commits the
 * candidate and the order(s) in one transactional batch.
 */
import {
  applyStage,
  deriveInitials,
  linkCandidate,
  newId,
  unlinkCandidate,
  zCandidateCreateInput,
  zCandidateLinkInput,
  zCandidateStageInput,
  zCandidateUpdateInput,
  type Candidate,
  type CandidateMutationResult,
  type Order,
} from '@branchsuite/shared';
import { z } from 'zod';
import type { Caller } from '../auth/staff.js';
import type { AppContext } from '../context.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { Handler } from '../http/types.js';
import { created, ok } from '../http/types.js';
import { parse, parsePatch } from '../http/validate.js';
import { audit, notify, readableBranch, requireBranchUser, staff, type StaffHandler } from './support.js';

const zStatusQuery = z.object({ status: z.enum(['active', 'archived']).default('active') });

/** Pipeline routes answer 404 when the feature is off. */
function pipeline(handler: StaffHandler): Handler {
  return staff(async (req, ctx, caller) => {
    if (!ctx.config.features.pipeline) throw notFound('The candidate pipeline is not enabled.');
    return handler(req, ctx, caller);
  });
}

async function requireAccount(ctx: AppContext, branchId: string, accountId: string | null | undefined): Promise<void> {
  if (!accountId) return;
  const account = await ctx.repo.getAccount(branchId, accountId);
  if (!account || account.reserved !== null) throw badRequest('Pick a customer account in this branch.');
}

/** The linked order, or null; a dangling link (order gone) is treated as unlinked. */
async function linkedOrder(candidate: Candidate, loadOrder: (id: string) => Promise<Order | null>): Promise<Order | null> {
  return candidate.orderId ? loadOrder(candidate.orderId) : null;
}

/** Keep a linked line's initials and start date in step with an edited candidate. */
function syncLinkedLine(candidate: Candidate, order: Order, actorId: string, nowIso: string): Order {
  const openings = order.openings.map((o) =>
    o.id === candidate.openingId && o.candidateId === candidate.id
      ? { ...o, initials: candidate.initials, startDate: candidate.startDate, writtenBy: actorId, updatedAt: nowIso }
      : o,
  );
  return { ...order, openings, updatedAt: nowIso, updatedBy: actorId };
}

async function finish(
  ctx: AppContext,
  caller: Caller,
  branchId: string,
  result: CandidateMutationResult,
  action: string,
  summary: string,
): Promise<CandidateMutationResult> {
  await audit(ctx, caller.user.id, { branchId, entity: 'candidate', entityId: result.candidate.id, action, summary });
  notify(ctx, branchId, ['candidates']);
  if (result.orders.length > 0) notify(ctx, branchId, ['orders'], { wall: true });
  return result;
}

const label = (c: Candidate) => `${c.firstName} ${c.lastName}`.trim();

export function registerCandidateRoutes(router: Router): void {
  router.get(
    '/branches/:b/candidates',
    pipeline(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const { status } = parse(zStatusQuery, Object.fromEntries(req.query));
      return ok(await ctx.repo.listCandidates(branch.id, status));
    }),
  );

  router.post(
    '/branches/:b/candidates',
    pipeline(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const input = parse(zCandidateCreateInput, req.body);
      const recruiterId = input.recruiterId === undefined ? caller.user.id : input.recruiterId;
      if (recruiterId) await requireBranchUser(ctx, branch.id, recruiterId, 'recruiter');
      await requireAccount(ctx, branch.id, input.accountId);
      const nowIso = ctx.now().toISOString();
      const stage = input.stage ?? 'sourced';
      if (stage === 'dropped') throw badRequest('A new candidate cannot start as dropped.');
      const candidate: Candidate = {
        id: newId('cand'),
        branchId: branch.id,
        firstName: input.firstName,
        lastName: input.lastName ?? '',
        initials: input.initials ?? deriveInitials(input.firstName, input.lastName ?? ''),
        phone: input.phone ?? '',
        email: input.email ?? '',
        recruiterId,
        stage,
        accountId: input.accountId ?? null,
        orderId: null,
        openingId: null,
        startDate: null,
        notes: input.notes ?? '',
        history: [{ stage, at: nowIso, by: caller.user.id, note: '', dropReason: null }],
        status: 'active',
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: caller.user.id,
        updatedBy: caller.user.id,
      };
      await ctx.repo.createCandidate(candidate);
      await audit(ctx, caller.user.id, { branchId: branch.id, entity: 'candidate', entityId: candidate.id, action: 'create', summary: `Added ${label(candidate)}` });
      notify(ctx, branch.id, ['candidates']);
      return created(candidate);
    }),
  );

  router.patch(
    '/branches/:b/candidates/:id',
    pipeline(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const input = parsePatch(zCandidateUpdateInput, req.body);
      if (input.recruiterId) await requireBranchUser(ctx, branch.id, input.recruiterId, 'recruiter');
      await requireAccount(ctx, branch.id, input.accountId);
      const result = await ctx.repo.mutatePipeline<CandidateMutationResult>(branch.id, req.params.id!, async (current, loadOrder) => {
        if (current.status === 'archived') throw conflict('Archived candidates cannot be edited.');
        const nowIso = ctx.now().toISOString();
        const candidate: Candidate = { ...current, ...input, updatedAt: nowIso, updatedBy: caller.user.id };
        if (input.accountId !== undefined && current.orderId && input.accountId !== current.accountId) {
          throw conflict('Unlink the candidate from the order before changing the account.');
        }
        const lineChanged = candidate.initials !== current.initials || candidate.startDate !== current.startDate;
        const order = lineChanged ? await linkedOrder(current, loadOrder) : null;
        const orders = order ? [syncLinkedLine(candidate, order, caller.user.id, nowIso)] : [];
        return { candidate, orders, result: { candidate, orders } };
      });
      return ok(await finish(ctx, caller, branch.id, result, 'update', `Edited ${label(result.candidate)}`));
    }),
  );

  router.post(
    '/branches/:b/candidates/:id/stage',
    pipeline(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const input = parse(zCandidateStageInput, req.body);
      const result = await ctx.repo.mutatePipeline<CandidateMutationResult>(branch.id, req.params.id!, async (current, loadOrder) => {
        const order = await linkedOrder(current, loadOrder);
        const r = applyStage(current, input, order, caller.user.id, ctx.now().toISOString());
        return { ...r, result: r };
      });
      return ok(await finish(ctx, caller, branch.id, result, 'stage', `Moved ${label(result.candidate)} to ${input.stage}`));
    }),
  );

  router.post(
    '/branches/:b/candidates/:id/link',
    pipeline(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const input = parse(zCandidateLinkInput, req.body);
      const result = await ctx.repo.mutatePipeline<CandidateMutationResult>(branch.id, req.params.id!, async (current, loadOrder) => {
        const order = await loadOrder(input.orderId);
        if (!order) throw notFound('No such order in this branch.');
        const previous = current.orderId ? current.orderId === order.id ? order : await loadOrder(current.orderId) : null;
        const r = linkCandidate(current, order, input.openingId, previous, caller.user.id, ctx.now().toISOString());
        return { ...r, result: r };
      });
      return ok(await finish(ctx, caller, branch.id, result, 'link', `Penciled ${label(result.candidate)} onto an order`));
    }),
  );

  router.delete(
    '/branches/:b/candidates/:id/link',
    pipeline(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const result = await ctx.repo.mutatePipeline<CandidateMutationResult>(branch.id, req.params.id!, async (current, loadOrder) => {
        const r = unlinkCandidate(current, await linkedOrder(current, loadOrder), caller.user.id, ctx.now().toISOString());
        return { ...r, result: r };
      });
      return ok(await finish(ctx, caller, branch.id, result, 'unlink', `Released ${label(result.candidate)} from an order`));
    }),
  );

  router.post(
    '/branches/:b/candidates/:id/archive',
    pipeline(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const result = await ctx.repo.mutatePipeline<CandidateMutationResult>(branch.id, req.params.id!, async (current, loadOrder) => {
        if (current.status === 'archived') return { candidate: current, orders: [], result: { candidate: current, orders: [] } };
        const nowIso = ctx.now().toISOString();
        const released = current.orderId ? unlinkCandidate(current, await linkedOrder(current, loadOrder), caller.user.id, nowIso) : { candidate: current, orders: [] };
        const candidate: Candidate = { ...released.candidate, status: 'archived', updatedAt: nowIso, updatedBy: caller.user.id };
        return { candidate, orders: released.orders, result: { candidate, orders: released.orders } };
      });
      await finish(ctx, caller, branch.id, result, 'archive', `Archived ${label(result.candidate)}`);
      return ok(result.candidate);
    }),
  );
}
