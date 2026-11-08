/**
 * Pure board derivations: lookups, toolbar state (persisted per user), filtering, grouping and the
 * small per-order facts the cards and table show. Business rules come from @branchsuite/shared;
 * this module only combines them for display.
 */
import {
  accountLabel,
  effectiveOwnerId,
  isDayKey,
  LIMITS,
  openingCounts,
  orderAgeOn,
  ROLE_CATEGORY_IDS,
  startLabel,
  todayKey,
  DEFAULT_TIME_ZONE,
  type AccountLite,
  type Order,
  type OrderSort,
  type PersonLite,
  type RoleCategory,
} from '@branchsuite/shared';
import { readStorage, writeStorage } from '../../lib/storage.js';

// =====================================================================================
// lookups
// =====================================================================================

export interface BoardLookups {
  accountsById: Map<string, AccountLite>;
  peopleById: Map<string, PersonLite>;
}

export function buildLookups(accounts: readonly AccountLite[], people: readonly PersonLite[]): BoardLookups {
  return {
    accountsById: new Map(accounts.map((a) => [a.id, a] as const)),
    peopleById: new Map(people.map((p) => [p.id, p] as const)),
  };
}

/** Effective owner per order id (unit owner, else account owner; null when unowned or inactive). */
export function ownersByOrder(orders: readonly Order[], lookups: BoardLookups): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const o of orders) map.set(o.id, effectiveOwnerId(o, lookups.accountsById.get(o.accountId), lookups.peopleById));
  return map;
}

/** Branch-local today for an order, falling back to computing it from the branch time zone. */
export function todayFor(today: Record<string, string>, branchId: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  return today[branchId] ?? todayKey(timeZone);
}

// =====================================================================================
// toolbar state
// =====================================================================================

export type QuickFilter = 'toFill' | 'pencils' | 'startingSoon' | 'aging';
export type BoardView = 'board' | 'list';
export const OWNER_ALL = 'all';
export const OWNER_NONE = 'unowned';
export const ROLE_ALL = 'all';

export interface ToolbarState {
  sort: OrderSort;
  /** 'all', 'unowned' or a person id. */
  owner: string;
  roleCategory: RoleCategory | typeof ROLE_ALL;
  hasOpenings: boolean;
  showPaused: boolean;
  /** Branch chips selected; empty means every branch in scope. */
  branchIds: string[];
  view: BoardView;
  groupByAccount: boolean;
}

export const DEFAULT_TOOLBAR: ToolbarState = {
  sort: 'need',
  owner: OWNER_ALL,
  roleCategory: ROLE_ALL,
  hasOpenings: false,
  showPaused: false,
  branchIds: [],
  view: 'board',
  groupByAccount: false,
};

const SORTS: readonly OrderSort[] = ['need', 'start', 'age', 'account'];

export const toolbarStorageKey = (userId: string) => `bs.board.toolbar.${userId}`;

/** Parse stored toolbar state, keeping only valid fields (anything unknown falls back to defaults). */
export function parseToolbar(raw: string | null): ToolbarState {
  if (!raw) return DEFAULT_TOOLBAR;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_TOOLBAR;
  }
  if (typeof v !== 'object' || v === null) return DEFAULT_TOOLBAR;
  const o = v as Record<string, unknown>;
  const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);
  return {
    sort: SORTS.includes(o.sort as OrderSort) ? (o.sort as OrderSort) : DEFAULT_TOOLBAR.sort,
    owner: typeof o.owner === 'string' && o.owner.length > 0 && o.owner.length <= 128 ? o.owner : OWNER_ALL,
    roleCategory:
      o.roleCategory === ROLE_ALL || (ROLE_CATEGORY_IDS as readonly unknown[]).includes(o.roleCategory)
        ? (o.roleCategory as ToolbarState['roleCategory'])
        : ROLE_ALL,
    hasOpenings: bool(o.hasOpenings, DEFAULT_TOOLBAR.hasOpenings),
    showPaused: bool(o.showPaused, DEFAULT_TOOLBAR.showPaused),
    branchIds: Array.isArray(o.branchIds) ? o.branchIds.filter((b): b is string => typeof b === 'string').slice(0, 100) : [],
    view: o.view === 'list' ? 'list' : 'board',
    groupByAccount: bool(o.groupByAccount, DEFAULT_TOOLBAR.groupByAccount),
  };
}

export function loadToolbar(userId: string): ToolbarState {
  return parseToolbar(readStorage(toolbarStorageKey(userId)));
}

export function saveToolbar(userId: string, state: ToolbarState): void {
  writeStorage(toolbarStorageKey(userId), JSON.stringify(state));
}

// =====================================================================================
// per-order facts
// =====================================================================================

/** A committed line starts within 0..LIMITS.startingSoonDays (same rule as boardMetrics). */
export function hasStartingSoon(order: Order, today: string): boolean {
  return order.openings.some((o) => o.state === 'committed' && startLabel(o, today).kind === 'soon');
}

/** Active, not covered, open LIMITS.agingOrderDays or more in branch-local days (same math as boardMetrics and the card). */
export function isAging(order: Order, today: string, timeZone: string = DEFAULT_TIME_ZONE): boolean {
  if (order.status !== 'active' || openingCounts(order).covered) return false;
  return orderAgeOn(order, timeZone, today) >= LIMITS.agingOrderDays;
}

export function matchesQuick(order: Order, quick: QuickFilter, today: string, timeZone: string = DEFAULT_TIME_ZONE): boolean {
  if (order.status !== 'active') return false;
  const c = openingCounts(order);
  switch (quick) {
    case 'toFill':
      return c.toFill > 0;
    case 'pencils':
      return c.tentative > 0;
    case 'startingSoon':
      return hasStartingSoon(order, today);
    case 'aging':
      return isAging(order, today, timeZone);
  }
}

/** Earliest committed/tentative start date on or after today, for display. */
export function nextStartDate(order: Order, today: string): string | null {
  let best: string | null = null;
  for (const o of order.openings) {
    if (o.state !== 'committed' && o.state !== 'tentative') continue;
    if (o.startDate === null || !isDayKey(o.startDate) || o.startDate < today) continue;
    if (best === null || o.startDate < best) best = o.startDate;
  }
  return best;
}

/** Unit path (without the account name) or ''. */
export function unitText(account: AccountLite | undefined, unitId: string | null): string {
  if (!account || unitId === null) return '';
  const full = accountLabel(account, unitId);
  return full.startsWith(account.name) ? full.slice(account.name.length).replace(/^ › /, '') : full;
}

function normalize(s: string): string {
  return s.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** Search across account name/aliases, wall code, unit path, site and role. */
export function orderMatchesSearch(order: Order, account: AccountLite | undefined, query: string): boolean {
  const q = normalize(query.trim());
  if (!q) return true;
  const haystack = [order.role, order.site, account?.name ?? '', ...(account?.aliases ?? []), account?.wall.code ?? '', account ? accountLabel(account, order.unitId) : '']
    .map(normalize)
    .join('\n');
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

// =====================================================================================
// filtering + grouping
// =====================================================================================

export interface FilterContext {
  toolbar: ToolbarState;
  search: string;
  quick: QuickFilter | null;
  today: Record<string, string>;
  lookups: BoardLookups;
  owners: Map<string, string | null>;
  /** Branches in scope (used to ignore stale branch chips). */
  scopeBranchIds: readonly string[];
  /** Branch id -> IANA time zone, for branch-local order age. Missing entries use DEFAULT_TIME_ZONE. */
  timeZones?: Record<string, string>;
}

/** Orders shown on the main board (never drafts or closed). Order of the input is preserved. */
export function filterOrders(orders: readonly Order[], ctx: FilterContext): Order[] {
  const { toolbar, quick } = ctx;
  const chips = toolbar.branchIds.filter((b) => ctx.scopeBranchIds.includes(b));
  return orders.filter((order) => {
    if (order.status === 'draft' || order.status === 'closed') return false;
    if (order.status === 'paused' && !toolbar.showPaused) return false;
    if (chips.length > 0 && !chips.includes(order.branchId)) return false;
    if (toolbar.roleCategory !== ROLE_ALL && order.roleCategory !== toolbar.roleCategory) return false;
    if (toolbar.hasOpenings && openingCounts(order).toFill === 0) return false;
    if (toolbar.owner !== OWNER_ALL) {
      const owner = ctx.owners.get(order.id) ?? null;
      if (toolbar.owner === OWNER_NONE ? owner !== null : owner !== toolbar.owner) return false;
    }
    const today = ctx.today[order.branchId];
    if (quick && (today === undefined || !matchesQuick(order, quick, today, ctx.timeZones?.[order.branchId]))) return false;
    return orderMatchesSearch(order, ctx.lookups.accountsById.get(order.accountId), ctx.search);
  });
}

export interface AccountGroup {
  accountId: string;
  orders: Order[];
}

/**
 * Group by account. With `consecutive`, only neighbouring orders of the same account share a group
 * (the account sort already puts them together). Otherwise groups appear in the position of their
 * first order and keep the sort order inside.
 */
export function groupByAccount(orders: readonly Order[], consecutive: boolean): AccountGroup[] {
  const groups: AccountGroup[] = [];
  if (consecutive) {
    for (const o of orders) {
      const last = groups[groups.length - 1];
      if (last && last.accountId === o.accountId) last.orders.push(o);
      else groups.push({ accountId: o.accountId, orders: [o] });
    }
    return groups;
  }
  const byId = new Map<string, AccountGroup>();
  for (const o of orders) {
    let g = byId.get(o.accountId);
    if (!g) {
      g = { accountId: o.accountId, orders: [] };
      byId.set(o.accountId, g);
      groups.push(g);
    }
    g.orders.push(o);
  }
  return groups;
}

/** Drafts the caller may review (managers only), oldest first. */
export function reviewableDrafts(orders: readonly Order[], canManage: (branchId: string) => boolean): Order[] {
  return orders
    .filter((o) => o.status === 'draft' && canManage(o.branchId))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** Initials from text input: uppercase only (validation happens with zInitials). */
export function normalizeInitialsInput(value: string): string {
  return value.toUpperCase();
}
