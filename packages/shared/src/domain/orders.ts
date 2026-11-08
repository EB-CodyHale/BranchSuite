/**
 * Job-order rules. Pure functions shared by API (authoritative) and web (optimistic UI).
 *
 * Whiteboard mapping: an order is one heading (account · unit · role · shift); each opening is a line.
 * Blank line = open. Pencil = tentative (pipeline in process). Initials = committed. Check = started.
 */
import type { AccountLite } from '../api.js';
import { LIMITS, type OpeningState, type OrderStatus } from '../constants.js';
import type { Opening, OpeningUpdateInput, Order, PersonLite } from '../schemas.js';
import { unitPath } from './accounts.js';
import { newId } from './ids.js';
import { dayKeyOf, daysBetween, isDayKey, shortDay, todayKey } from './time.js';

export interface OpeningCounts {
  total: number; open: number; tentative: number; committed: number; started: number;
  /** open + tentative: lines still needing a confirmed person. */
  toFill: number;
  /** toFill === 0 */
  covered: boolean;
}
export function openingCounts(order: Pick<Order, 'openings'>): OpeningCounts {
  const c = { open: 0, tentative: 0, committed: 0, started: 0 };
  for (const o of order.openings) c[o.state] += 1;
  const toFill = c.open + c.tentative;
  return { total: order.openings.length, ...c, toFill, covered: toFill === 0 };
}

export type StartLabelKind = 'started' | 'overdue' | 'soon' | 'scheduled' | 'nodate' | 'none';
/**
 * Label for a line, given today's day key:
 * - started -> {kind:'started', label:'started'}
 * - committed/tentative with startDate < today -> 'overdue', label 'due M/D'
 * - committed/tentative with startDate within 0..LIMITS.startingSoonDays -> 'soon', label 'starts M/D' (or 'starts today')
 * - committed/tentative with later startDate -> 'scheduled', label 'starts M/D'
 * - committed/tentative with no date -> 'nodate', label 'no date'
 * - open -> 'none', label ''
 */
export function startLabel(opening: Opening, today: string): { kind: StartLabelKind; label: string } {
  if (opening.state === 'started') return { kind: 'started', label: 'started' };
  if (opening.state === 'open') return { kind: 'none', label: '' };
  if (opening.startDate === null || !isDayKey(opening.startDate)) return { kind: 'nodate', label: 'no date' };
  const days = daysBetween(today, opening.startDate);
  if (days < 0) return { kind: 'overdue', label: `due ${shortDay(opening.startDate)}` };
  if (days === 0) return { kind: 'soon', label: 'starts today' };
  const label = `starts ${shortDay(opening.startDate)}`;
  return { kind: days <= LIMITS.startingSoonDays ? 'soon' : 'scheduled', label };
}

export type OrderSort = 'need' | 'start' | 'age' | 'account';

const STATUS_RANK: Record<OrderStatus, number> = { active: 0, draft: 1, paused: 2, closed: 3 };

function todayFor(today: Record<string, string> | string, branchId: string): string | undefined {
  return typeof today === 'string' ? today : today[branchId];
}

/** Earliest committed/tentative start date on or after today, or null. */
function nextUpcomingStart(order: Order, today: string | undefined): string | null {
  if (today === undefined) return null;
  let best: string | null = null;
  for (const o of order.openings) {
    if (o.state !== 'committed' && o.state !== 'tentative') continue;
    if (o.startDate === null || !isDayKey(o.startDate) || o.startDate < today) continue;
    if (best === null || o.startDate < best) best = o.startDate;
  }
  return best;
}

const compareText = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: 'base' });
const compareCreated = (a: Order, b: Order): number => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

/**
 * Sort a copy. Status rank first in every sort: active(0) < draft(1) < paused(2) < closed(3).
 * Within status: isPriority orders first ONLY for 'need'.
 * - need: toFill desc, then createdAt asc.
 * - start: soonest UPCOMING (>= today) committed/tentative startDate asc; orders without one last; tie createdAt asc.
 *   (Fixes PoC bug where past started dates sorted first.)
 * - age: createdAt asc.
 * - account: account name (localeCompare, sensitivity base), then shift, then role.
 * When `today` is a per-branch map, an order whose branch is missing has no upcoming start.
 */
export function sortOrders(orders: Order[], sort: OrderSort, ctx: { today: Record<string, string> | string; accountsById: Map<string, AccountLite> }): Order[] {
  // Precompute per-order keys once instead of inside the comparator.
  const keyed = orders.map((order) => ({
    order,
    rank: STATUS_RANK[order.status],
    toFill: sort === 'need' ? openingCounts(order).toFill : 0,
    start: sort === 'start' ? nextUpcomingStart(order, todayFor(ctx.today, order.branchId)) : null,
    accountName: sort === 'account' ? (ctx.accountsById.get(order.accountId)?.name ?? '') : '',
  }));
  keyed.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    switch (sort) {
      case 'need':
        if (a.order.isPriority !== b.order.isPriority) return a.order.isPriority ? -1 : 1;
        if (a.toFill !== b.toFill) return b.toFill - a.toFill;
        return compareCreated(a.order, b.order);
      case 'start':
        if (a.start !== b.start) {
          if (a.start === null) return 1;
          if (b.start === null) return -1;
          return a.start < b.start ? -1 : 1;
        }
        return compareCreated(a.order, b.order);
      case 'age':
        return compareCreated(a.order, b.order);
      case 'account':
        return (
          compareText(a.accountName, b.accountName) ||
          compareText(a.order.shift, b.order.shift) ||
          compareText(a.order.role, b.order.role)
        );
    }
  });
  return keyed.map((k) => k.order);
}

export interface BoardMetrics {
  orders: number; openings: number; toFill: number; tentative: number;
  /** committed lines with startDate within 0..startingSoonDays */
  startingSoon: number;
  /** active orders with toFill > 0 and age >= LIMITS.agingOrderDays */
  aging: number;
}

function isStartingSoon(opening: Opening, today: string): boolean {
  if (opening.state !== 'committed' || opening.startDate === null || !isDayKey(opening.startDate)) return false;
  const days = daysBetween(today, opening.startDate);
  return days >= 0 && days <= LIMITS.startingSoonDays;
}

/**
 * Metrics over ACTIVE orders only. `today` may be a single key or per-branch map.
 * Age for `aging` is counted from the UTC calendar date of createdAt (no time zone is available here);
 * use orderAgeDays for an exact branch-local age. Orders whose branch has no `today` entry are not
 * counted toward startingSoon or aging.
 */
export function boardMetrics(orders: Order[], today: Record<string, string> | string): BoardMetrics {
  const m: BoardMetrics = { orders: 0, openings: 0, toFill: 0, tentative: 0, startingSoon: 0, aging: 0 };
  for (const order of orders) {
    if (order.status !== 'active') continue;
    const counts = openingCounts(order);
    const day = todayFor(today, order.branchId);
    m.orders += 1;
    m.openings += counts.total;
    m.toFill += counts.toFill;
    m.tentative += counts.tentative;
    if (day === undefined) continue;
    for (const o of order.openings) if (isStartingSoon(o, day)) m.startingSoon += 1;
    if (counts.toFill > 0 && daysBetween(dayKeyOf(order.createdAt, 'UTC'), day) >= LIMITS.agingOrderDays) m.aging += 1;
  }
  return m;
}

/** Whole days since createdAt in the order's branch day space (never negative). */
export function orderAgeDays(order: Pick<Order, 'createdAt'>, timeZone: string, now: Date = new Date()): number {
  return Math.max(0, daysBetween(dayKeyOf(order.createdAt, timeZone), todayKey(timeZone, now)));
}

/** Blank line. */
export function newOpening(nowIso: string): Opening {
  return { id: newId('opn'), state: 'open', initials: null, candidateId: null, startDate: null, writtenBy: null, updatedAt: nowIso };
}

export class OrderRuleError extends Error {
  constructor(public code: 'bad_request' | 'conflict' | 'forbidden', message: string) { super(message); }
}

function stamp(order: Order, openings: Opening[], actorId: string, nowIso: string): Order {
  return { ...order, openings, updatedAt: nowIso, updatedBy: actorId };
}

/**
 * Apply a member's write on a line. Returns a NEW order (input not mutated). Throws OrderRuleError.
 * Rules:
 * - order.status must be 'active' or 'paused' (not draft/closed) -> else conflict.
 * - opening must exist -> else bad_request.
 * - state 'open': clears initials, startDate, candidateId. If the line has a candidateId, throw conflict
 *   ('Line is held by a pipeline candidate; update the candidate instead').
 * - state tentative/committed/started: initials required (input.initials ?? existing initials).
 * - If line has candidateId, manual edits may change startDate only; state changes must go via pipeline -> conflict.
 * - startDate: input value when provided (null clears), else existing.
 * - writtenBy = actorId, updatedAt = nowIso. Order updatedAt/updatedBy stamped.
 */
export function applyOpeningUpdate(order: Order, openingId: string, input: OpeningUpdateInput, actorId: string, nowIso: string): Order {
  if (order.status !== 'active' && order.status !== 'paused') {
    throw new OrderRuleError('conflict', `Lines cannot be changed on a ${order.status} order`);
  }
  const index = order.openings.findIndex((o) => o.id === openingId);
  const line = order.openings[index];
  if (!line) throw new OrderRuleError('bad_request', 'Line not found on this order');

  let next: Opening;
  if (line.candidateId !== null) {
    if (input.state === 'open') {
      throw new OrderRuleError('conflict', 'Line is held by a pipeline candidate; update the candidate instead');
    }
    const initialsChanged = input.initials !== undefined && input.initials !== null && input.initials !== line.initials;
    if (input.state !== line.state || initialsChanged) {
      throw new OrderRuleError('conflict', 'Line is held by a pipeline candidate; only the start date can be changed here');
    }
    next = { ...line, startDate: input.startDate !== undefined ? input.startDate : line.startDate };
  } else if (input.state === 'open') {
    next = { ...line, state: 'open', initials: null, startDate: null, candidateId: null };
  } else {
    const initials = input.initials ?? line.initials;
    if (!initials) throw new OrderRuleError('bad_request', 'Initials are required to fill a line');
    next = {
      ...line,
      state: input.state,
      initials,
      startDate: input.startDate !== undefined ? input.startDate : line.startDate,
    };
  }
  next = { ...next, writtenBy: actorId, updatedAt: nowIso };
  const openings = order.openings.slice();
  openings[index] = next;
  return stamp(order, openings, actorId, nowIso);
}

/** Append `count` blank lines. Enforces LIMITS.maxOpeningsPerOrder (bad_request). */
export function addOpenings(order: Order, count: number, actorId: string, nowIso: string): Order {
  if (!Number.isInteger(count) || count < 1) throw new OrderRuleError('bad_request', 'Count must be a positive whole number');
  if (order.openings.length + count > LIMITS.maxOpeningsPerOrder) {
    throw new OrderRuleError('bad_request', `An order can have at most ${LIMITS.maxOpeningsPerOrder} openings`);
  }
  const added = Array.from({ length: count }, () => newOpening(nowIso));
  return stamp(order, [...order.openings, ...added], actorId, nowIso);
}

/**
 * Remove a specific line. Allowed only if the line is open, or tentative with no candidateId.
 * Never removes the last line (bad_request). Throws conflict otherwise.
 */
export function removeOpening(order: Order, openingId: string, actorId: string, nowIso: string): Order {
  const line = order.openings.find((o) => o.id === openingId);
  if (!line) throw new OrderRuleError('bad_request', 'Line not found on this order');
  if (order.openings.length <= 1) throw new OrderRuleError('bad_request', 'An order must keep at least one opening');
  const removable = line.candidateId === null && (line.state === 'open' || line.state === 'tentative');
  if (!removable) throw new OrderRuleError('conflict', 'Only blank or penciled lines without a pipeline candidate can be removed');
  return stamp(order, order.openings.filter((o) => o.id !== openingId), actorId, nowIso);
}

/**
 * Effective owner of an order: walk from unitId up parent chain (max LIMITS.maxUnitDepth, cycle-safe)
 * to first unit with ownerId; else account.ownerId. Return null unless that person is active and
 * a member of the order's branch.
 */
export function effectiveOwnerId(order: Pick<Order, 'branchId' | 'unitId'>, account: AccountLite | undefined, peopleById: Map<string, PersonLite>): string | null {
  if (!account) return null;
  const unitOwner = unitPath(account, order.unitId).find((u) => u.ownerId !== null)?.ownerId;
  const ownerId = unitOwner ?? account.ownerId;
  if (ownerId === null) return null;
  const person = peopleById.get(ownerId);
  return person && person.active && person.branchIds.includes(order.branchId) ? ownerId : null;
}

/** "M-F · 6:00a-2:30p" from days/hours (omit empties); '' if both empty. */
export function scheduleText(order: Pick<Order, 'days' | 'hours'>): string {
  return [order.days, order.hours]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(' · ');
}
/** "$19.50/hr" or '' */
export function payText(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return '';
  return `$${rate.toFixed(2)}/hr`;
}

/** Does a state count as "filled by a person" (initials on the line)? */
export function isFilledState(s: OpeningState): boolean {
  return s === 'committed' || s === 'started';
}
