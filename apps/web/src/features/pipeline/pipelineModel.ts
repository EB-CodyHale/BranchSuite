/**
 * Pure helpers for the candidate pipeline screen. Domain rules (stage -> line state, initials,
 * days in stage, link rules) live in @branchsuite/shared; this file only shapes data for display.
 */
import {
  daysBetween,
  daysInStage,
  isDayKey,
  LIMITS,
  openingCounts,
  PIPELINE_STAGES,
  shortDay,
  type AccountLite,
  type Candidate,
  type DropReason,
  type Opening,
  type OpeningState,
  type Order,
  type PersonLite,
  type PipelineStage,
} from '@branchsuite/shared';

export const DROPPED: PipelineStage = 'dropped';

/** The working columns, in order (everything but 'dropped'). */
export const ACTIVE_STAGES = PIPELINE_STAGES.filter((s) => s.id !== 'dropped');

export const STAGE_LABEL: Record<PipelineStage, string> = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.id, s.label])) as Record<
  PipelineStage,
  string
>;

/** Stages whose move asks for an (optional) start date: the line becomes committed or started. */
export const START_DATE_STAGES: ReadonlySet<PipelineStage> = new Set<PipelineStage>(['accepted', 'onboarding', 'started']);

export const DROP_REASON_LABEL: Record<DropReason, string> = {
  candidate_withdrew: 'Candidate withdrew',
  not_selected: 'Not selected by client',
  failed_screening: 'Failed screening',
  no_show: 'No-show',
  unreachable: 'Unreachable',
  other: 'Other',
};

/** Days in one stage before the card is flagged as stalled. */
export const STALE_STAGE_DAYS = 7;

export function fullName(c: Pick<Candidate, 'firstName' | 'lastName'>): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

export function isStale(days: number): boolean {
  return days >= STALE_STAGE_DAYS;
}

export function stageDays(candidate: Pick<Candidate, 'history' | 'createdAt'>, now?: Date): number {
  return daysInStage(candidate, now);
}

// ---------------------------------------------------------------------------------------------
// filters
// ---------------------------------------------------------------------------------------------

/** 'mine' | 'all' | a recruiter's user id. */
export type RecruiterFilter = string;
/** 'all' | 'none' (no account) | an account id. */
export type AccountFilter = string;

export interface PipelineFilters {
  recruiter: RecruiterFilter;
  account: AccountFilter;
  search: string;
  showArchived: boolean;
}

export const DEFAULT_FILTERS: PipelineFilters = { recruiter: 'mine', account: 'all', search: '', showArchived: false };

function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

export function matchesSearch(c: Candidate, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const hay = normalize([c.firstName, c.lastName, fullName(c), c.initials, c.email, c.notes].join(' '));
  if (q.split(/\s+/).every((part) => hay.includes(part))) return true;
  return digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits);
}

export function filterCandidates(candidates: readonly Candidate[], filters: PipelineFilters, viewerId: string): Candidate[] {
  return candidates.filter((c) => {
    if (!filters.showArchived && c.status === 'archived') return false;
    if (filters.recruiter === 'mine' && c.recruiterId !== viewerId) return false;
    if (filters.recruiter !== 'mine' && filters.recruiter !== 'all' && c.recruiterId !== filters.recruiter) return false;
    if (filters.account === 'none' && c.accountId !== null) return false;
    if (filters.account !== 'all' && filters.account !== 'none' && c.accountId !== filters.account) return false;
    return matchesSearch(c, filters.search);
  });
}

/** True when any filter narrows the list beyond the defaults (used for "clear filters"). */
export function isFiltered(filters: PipelineFilters): boolean {
  return filters.recruiter !== DEFAULT_FILTERS.recruiter || filters.account !== 'all' || filters.search.trim() !== '';
}

/** Group by stage, longest-in-stage first within a column (they need attention), then by name. */
export function groupByStage(candidates: readonly Candidate[], now: Date = new Date()): Map<PipelineStage, Candidate[]> {
  const groups = new Map<PipelineStage, Candidate[]>(PIPELINE_STAGES.map((s) => [s.id, []]));
  for (const c of candidates) groups.get(c.stage)?.push(c);
  for (const list of groups.values()) {
    list.sort((a, b) => stageDays(b, now) - stageDays(a, now) || fullName(a).localeCompare(fullName(b)));
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------
// orders and lines
// ---------------------------------------------------------------------------------------------

export interface LinkedLine {
  order: Order;
  line: Opening;
  /** 0-based position of the line on the order. */
  index: number;
}

/** The order + line the candidate holds, if both are on the board and the line still names them. */
export function linkedLine(candidate: Candidate, ordersById: Map<string, Order>): LinkedLine | null {
  if (!candidate.orderId || !candidate.openingId) return null;
  const order = ordersById.get(candidate.orderId);
  if (!order) return null;
  const index = order.openings.findIndex((o) => o.id === candidate.openingId);
  const line = order.openings[index];
  return line ? { order, line, index } : null;
}

export const LINE_STATUS_LABEL: Record<Exclude<OpeningState, 'open'>, string> = {
  tentative: 'Pencil',
  committed: 'Committed',
  started: 'Started',
};

export function roleShift(order: Pick<Order, 'role' | 'shift'>): string {
  return [order.role, order.shift].filter((s) => s.trim().length > 0).join(' · ');
}

/** Lines a candidate can be penciled onto: open and not held by anyone. */
export function openLines(order: Order): Array<{ line: Opening; index: number }> {
  return order.openings.flatMap((line, index) => (line.state === 'open' && line.candidateId === null ? [{ line, index }] : []));
}

/** Orders that can take a tentative fill: active/paused, in the branch, with at least one open line. */
export function fillableOrders(orders: readonly Order[], branchId: string, accountId: string | null): Order[] {
  return orders
    .filter((o) => o.branchId === branchId && (o.status === 'active' || o.status === 'paused'))
    .filter((o) => accountId === null || o.accountId === accountId)
    .filter((o) => openLines(o).length > 0)
    .sort((a, b) => Number(b.isPriority) - Number(a.isPriority) || openingCounts(b).toFill - openingCounts(a).toFill || a.role.localeCompare(b.role));
}

// ---------------------------------------------------------------------------------------------
// openings at a glance
// ---------------------------------------------------------------------------------------------

export interface AccountNeed {
  account: AccountLite;
  /** Open + penciled lines across the account's active/paused orders. */
  toFill: number;
  orders: number;
  /** Active, not-dropped candidates in process for the account. */
  inProcess: number;
}

export function accountNeeds(orders: readonly Order[], candidates: readonly Candidate[], accountsById: Map<string, AccountLite>, branchId: string): AccountNeed[] {
  const byAccount = new Map<string, AccountNeed>();
  for (const order of orders) {
    if (order.branchId !== branchId || (order.status !== 'active' && order.status !== 'paused')) continue;
    const toFill = openingCounts(order).toFill;
    if (toFill === 0) continue;
    const account = accountsById.get(order.accountId);
    if (!account) continue;
    const need = byAccount.get(account.id) ?? { account, toFill: 0, orders: 0, inProcess: 0 };
    need.toFill += toFill;
    need.orders += 1;
    byAccount.set(account.id, need);
  }
  for (const c of candidates) {
    if (c.status !== 'active' || c.stage === 'dropped' || c.accountId === null) continue;
    const need = byAccount.get(c.accountId);
    if (need) need.inProcess += 1;
  }
  // Biggest sourcing gap first.
  return [...byAccount.values()].sort(
    (a, b) => b.toFill - b.inProcess - (a.toFill - a.inProcess) || b.toFill - a.toFill || a.account.name.localeCompare(b.account.name),
  );
}

// ---------------------------------------------------------------------------------------------
// start dates
// ---------------------------------------------------------------------------------------------

export type StartTone = 'past' | 'soon' | 'later';

export function startInfo(startDate: string | null, today: string | undefined): { label: string; tone: StartTone } | null {
  if (!startDate || !isDayKey(startDate)) return null;
  if (!today || !isDayKey(today)) return { label: `Starts ${shortDay(startDate)}`, tone: 'later' };
  const days = daysBetween(today, startDate);
  if (days < 0) return { label: `Start ${shortDay(startDate)}`, tone: 'past' };
  if (days === 0) return { label: 'Starts today', tone: 'soon' };
  return { label: `Starts ${shortDay(startDate)}`, tone: days <= LIMITS.startingSoonDays ? 'soon' : 'later' };
}

// ---------------------------------------------------------------------------------------------
// people + accounts
// ---------------------------------------------------------------------------------------------

/** Active people in the branch, by name: recruiter choices. */
export function recruitersFor(people: readonly PersonLite[], branchId: string): PersonLite[] {
  return people.filter((p) => p.active && p.branchIds.includes(branchId)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Customer accounts in the branch (no payroll/internal routing accounts), by name. */
export function customerAccounts(accounts: readonly AccountLite[], branchId: string): AccountLite[] {
  return accounts.filter((a) => a.branchId === branchId && a.active && a.reserved === null).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------
// API result shape
// ---------------------------------------------------------------------------------------------

