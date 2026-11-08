/**
 * Candidate pipeline rules. Linking a candidate to an opening is a "tentative fill".
 * The opening's state follows the candidate's stage (PIPELINE_STAGES[].opening).
 */
import { PIPELINE_STAGES, type OpeningState, type PipelineStage } from '../constants.js';
import type { Candidate, CandidateStageInput, Opening, Order, StageEvent } from '../schemas.js';

const MAX_HISTORY = 200;
const MS_PER_DAY = 86_400_000;

const STAGE_OPENING = new Map<PipelineStage, OpeningState | null>(PIPELINE_STAGES.map((s) => [s.id, s.opening]));

/** Opening state implied by a stage; null for 'dropped'. */
export function openingStateForStage(stage: PipelineStage): OpeningState | null {
  const state = STAGE_OPENING.get(stage);
  if (state === undefined) throw new RangeError(`Unknown pipeline stage: ${String(stage)}`);
  return state;
}

/** Latin letters that NFKD does not decompose to a base A-Z letter. */
const LATIN_FOLDS: Record<string, string> = { Ø: 'O', Œ: 'O', Æ: 'A', Ł: 'L', Đ: 'D', Ð: 'D', Þ: 'T', ß: 'S' };

/** The name's first letter folded to A-Z (diacritics stripped), uppercase; '' if that letter is not Latin. */
function firstLetter(name: string): string {
  const letter = /\p{L}/u.exec(name)?.[0];
  if (letter === undefined) return '';
  const base = letter.normalize('NFKD').charAt(0).toUpperCase();
  const folded = LATIN_FOLDS[base] ?? LATIN_FOLDS[letter] ?? base;
  return /^[A-Z]$/.test(folded) ? folded : '';
}

/** Initials from names: first letter of first + first letter of last (uppercase, A-Z only); 'X' fallback. */
export function deriveInitials(firstName: string, lastName: string): string {
  const initials = firstLetter(firstName) + firstLetter(lastName);
  return initials.length > 0 ? initials : 'X';
}

export class PipelineRuleError extends Error {
  constructor(public code: 'bad_request' | 'conflict', message: string) { super(message); }
}

export interface PipelineResult { candidate: Candidate; orders: Order[] }

function isLinked(candidate: Candidate): candidate is Candidate & { orderId: string; openingId: string } {
  return candidate.orderId !== null && candidate.openingId !== null;
}

function stampOrder(order: Order, openings: Opening[], actorId: string, nowIso: string): Order {
  return { ...order, openings, updatedAt: nowIso, updatedBy: actorId };
}

function stampCandidate(candidate: Candidate, changes: Partial<Candidate>, actorId: string, nowIso: string): Candidate {
  return { ...candidate, ...changes, updatedAt: nowIso, updatedBy: actorId };
}

/** Replace one line by id. Returns null when the line is not on the order. */
function updateLine(order: Order, openingId: string, change: (line: Opening) => Opening): Opening[] | null {
  const index = order.openings.findIndex((o) => o.id === openingId);
  const line = order.openings[index];
  if (!line) return null;
  const openings = order.openings.slice();
  openings[index] = change(line);
  return openings;
}

function blankLine(line: Opening, actorId: string, nowIso: string): Opening {
  return { ...line, state: 'open', initials: null, candidateId: null, startDate: null, writtenBy: actorId, updatedAt: nowIso };
}

/**
 * Release the candidate's line on `order` (-> open). Returns the order unchanged when the line is gone
 * or is no longer held by this candidate (stale link), so a stale link never clears another person's line.
 */
function releaseLine(order: Order, candidate: Candidate, actorId: string, nowIso: string): { order: Order; changed: boolean } {
  const line = order.openings.find((o) => o.id === candidate.openingId);
  if (!line || line.candidateId !== candidate.id) return { order, changed: false };
  const openings = updateLine(order, line.id, (l) => blankLine(l, actorId, nowIso)) as Opening[];
  return { order: stampOrder(order, openings, actorId, nowIso), changed: true };
}

function requireLinkedOrder(candidate: Candidate, order: Order | null, what: string): Order {
  if (!order || order.id !== candidate.orderId) {
    throw new PipelineRuleError('bad_request', `${what} must be the order the candidate is linked to`);
  }
  return order;
}

/**
 * Move a candidate to a stage. Appends a history event. Rules:
 * - archived candidates cannot move (conflict).
 * - 'dropped' requires dropReason (bad_request); it unlinks the candidate (opening -> open, candidateId/initials/startDate cleared).
 * - Moving out of 'dropped' is allowed (re-engage) but does not relink.
 * - If linked, the linked opening's state becomes openingStateForStage(stage), initials = candidate.initials,
 *   startDate = input.startDate ?? candidate.startDate. `linkedOrder` must be the candidate's order when linked.
 * - input.startDate (if provided) updates candidate.startDate.
 * Returns new objects; orders contains the changed order (if any).
 *
 * A linked line that is missing or held by someone else (stale link) throws conflict, except on 'dropped',
 * where the candidate is simply unlinked. History keeps the newest 200 events.
 */
export function applyStage(candidate: Candidate, input: CandidateStageInput, linkedOrder: Order | null, actorId: string, nowIso: string): PipelineResult {
  if (candidate.status === 'archived') throw new PipelineRuleError('conflict', 'Archived candidates cannot change stage');
  const dropping = input.stage === 'dropped';
  if (dropping && !input.dropReason) throw new PipelineRuleError('bad_request', 'A drop reason is required');

  const event: StageEvent = {
    stage: input.stage,
    at: nowIso,
    by: actorId,
    note: input.note ?? '',
    dropReason: dropping ? (input.dropReason ?? null) : null,
  };
  const history = [...candidate.history, event].slice(-MAX_HISTORY);
  const startDate = input.startDate !== undefined ? input.startDate : candidate.startDate;
  const changes: Partial<Candidate> = { stage: input.stage, history, startDate };

  if (!isLinked(candidate)) {
    return { candidate: stampCandidate(candidate, changes, actorId, nowIso), orders: [] };
  }
  const order = requireLinkedOrder(candidate, linkedOrder, 'linkedOrder');

  if (dropping) {
    const released = releaseLine(order, candidate, actorId, nowIso);
    return {
      candidate: stampCandidate(candidate, { ...changes, orderId: null, openingId: null }, actorId, nowIso),
      orders: released.changed ? [released.order] : [],
    };
  }

  const state = openingStateForStage(input.stage) as OpeningState;
  const line = order.openings.find((o) => o.id === candidate.openingId);
  if (!line || line.candidateId !== candidate.id) {
    throw new PipelineRuleError('conflict', 'The linked line is no longer held by this candidate; relink the candidate');
  }
  const openings = updateLine(order, line.id, (l) => ({
    ...l,
    state,
    initials: candidate.initials,
    startDate,
    writtenBy: actorId,
    updatedAt: nowIso,
  })) as Opening[];
  return {
    candidate: stampCandidate(candidate, changes, actorId, nowIso),
    orders: [stampOrder(order, openings, actorId, nowIso)],
  };
}

/**
 * Tentatively fill. Rules:
 * - candidate must be active and not 'dropped' (conflict); order must be 'active' or 'paused' (conflict).
 * - target = openingId ?? first line with state 'open'; it must be open (conflict 'Line already taken').
 * - If the candidate is linked elsewhere, `previousOrder` must be provided and that line is released (-> open).
 *   (previousOrder may be the same order object as `order`; handle that by applying both changes to one copy.)
 * - Line gets state openingStateForStage(stage) (sourced..interviewing -> tentative), candidateId, initials, startDate, writtenBy.
 * - candidate.orderId/openingId set; candidate.accountId = order.accountId.
 *
 * Also: the order must be in the candidate's branch (bad_request); an unknown openingId is bad_request;
 * relinking to the line the candidate already holds (or to its current order with no openingId) changes nothing.
 */
export function linkCandidate(candidate: Candidate, order: Order, openingId: string | undefined, previousOrder: Order | null, actorId: string, nowIso: string): PipelineResult {
  if (candidate.status !== 'active') throw new PipelineRuleError('conflict', 'Archived candidates cannot be linked');
  if (candidate.stage === 'dropped') throw new PipelineRuleError('conflict', 'Dropped candidates cannot be linked; move them to an active stage first');
  if (order.status !== 'active' && order.status !== 'paused') {
    throw new PipelineRuleError('conflict', `Candidates cannot be linked to a ${order.status} order`);
  }
  if (order.branchId !== candidate.branchId) throw new PipelineRuleError('bad_request', 'The order belongs to another branch');

  const linked = isLinked(candidate);
  if (linked && candidate.orderId === order.id && (openingId === undefined || openingId === candidate.openingId)) {
    return { candidate, orders: [] };
  }

  // Release the previous line first. When it is on the same order, both changes land on one copy.
  let working = order;
  let previous: Order | null = null;
  if (linked) {
    const prior = requireLinkedOrder(candidate, previousOrder, 'previousOrder');
    if (prior.id === order.id) {
      working = releaseLine(order, candidate, actorId, nowIso).order;
    } else {
      const released = releaseLine(prior, candidate, actorId, nowIso);
      if (released.changed) previous = released.order;
    }
  }

  const target =
    openingId === undefined ? working.openings.find((o) => o.state === 'open') : working.openings.find((o) => o.id === openingId);
  if (!target) {
    throw openingId === undefined
      ? new PipelineRuleError('conflict', 'This order has no open line')
      : new PipelineRuleError('bad_request', 'Line not found on this order');
  }
  if (target.state !== 'open' || target.candidateId !== null) throw new PipelineRuleError('conflict', 'Line already taken');

  const state = openingStateForStage(candidate.stage) as OpeningState;
  const openings = updateLine(working, target.id, (l) => ({
    ...l,
    state,
    candidateId: candidate.id,
    initials: candidate.initials,
    startDate: candidate.startDate,
    writtenBy: actorId,
    updatedAt: nowIso,
  })) as Opening[];
  const nextOrder = stampOrder(working, openings, actorId, nowIso);

  return {
    candidate: stampCandidate(candidate, { orderId: order.id, openingId: target.id, accountId: order.accountId }, actorId, nowIso),
    orders: previous ? [nextOrder, previous] : [nextOrder],
  };
}

/**
 * Release the candidate's line (-> open) and clear orderId/openingId (keep accountId).
 * An unlinked candidate is returned unchanged. `order` null (order no longer exists) clears the link only;
 * a different order than the linked one is bad_request.
 */
export function unlinkCandidate(candidate: Candidate, order: Order | null, actorId: string, nowIso: string): PipelineResult {
  if (!isLinked(candidate)) return { candidate, orders: [] };
  let orders: Order[] = [];
  if (order !== null) {
    const released = releaseLine(requireLinkedOrder(candidate, order, 'order'), candidate, actorId, nowIso);
    if (released.changed) orders = [released.order];
  }
  return { candidate: stampCandidate(candidate, { orderId: null, openingId: null }, actorId, nowIso), orders };
}

/**
 * Days the candidate has been in the current stage: whole 24-hour periods since the latest history
 * event (or createdAt when there is no history). Never negative.
 */
export function daysInStage(candidate: Pick<Candidate, 'history' | 'createdAt'>, now: Date = new Date()): number {
  const since = candidate.history[candidate.history.length - 1]?.at ?? candidate.createdAt;
  const ms = now.getTime() - Date.parse(since);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / MS_PER_DAY)) : 0;
}
