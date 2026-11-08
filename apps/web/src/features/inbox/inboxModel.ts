/**
 * Pure helpers for the inbox (mail-driven task queue). Domain rules come from @branchsuite/shared
 * (sortTasks, effectivePriority, accountLabel, day-key math); this file only shapes data for the UI.
 */
import {
  accountLabel,
  daysBetween,
  effectivePriority,
  isDayKey,
  sortTasks,
  TASK_CATEGORIES,
  todayKey,
  DEFAULT_TIME_ZONE,
  type AccountLite,
  type Branch,
  type Order,
  type PersonLite,
  type Task,
  type TaskCategory,
  type TaskPriority,
} from '@branchsuite/shared';
import { readStorage, writeStorage } from '../../lib/storage.js';

export type InboxView = 'branch' | 'personal' | 'combined';
export type InboxLayout = 'queue' | 'list';
export type AssigneeFilter = 'all' | 'me' | 'unassigned' | { userId: string };
export type PriorityFilter = 'all' | TaskPriority;

export interface InboxLookups {
  accountsById: Map<string, AccountLite>;
  peopleById: Map<string, PersonLite>;
  ordersById: Map<string, Order>;
}

export function buildLookups(accounts: readonly AccountLite[], people: readonly PersonLite[], orders: readonly Order[]): InboxLookups {
  return {
    accountsById: new Map(accounts.map((a) => [a.id, a])),
    peopleById: new Map(people.map((p) => [p.id, p])),
    ordersById: new Map(orders.map((o) => [o.id, o])),
  };
}

export const categoryLabel = (id: TaskCategory): string => TASK_CATEGORIES.find((c) => c.id === id)?.label ?? id;

export const PRIORITY_LABEL: Record<TaskPriority, string> = { hot: 'Hot', normal: 'Normal', low: 'Low' };

/** The view actually shown: personal views need the personal-mail feature. */
export function resolveView(preferred: InboxView | undefined, personalMail: boolean): InboxView {
  if (!personalMail) return 'branch';
  return preferred ?? 'branch';
}

/**
 * The day key the API treats as "today" for a request: it uses the first requested branch (the
 * client sorts the list) and falls back to the default zone.
 */
export function primaryTimeZone(branchIds: readonly string[], branchesById: Map<string, Pick<Branch, 'timeZone'>>): string {
  const first = [...branchIds].sort()[0];
  return (first ? branchesById.get(first)?.timeZone : undefined) ?? DEFAULT_TIME_ZONE;
}

export function clientToday(timeZone: string, now: Date = new Date()): string {
  return todayKey(timeZone, now);
}

/** "today", "1d", "12d" from the task's board date to today. Malformed dates give ''. */
export function ageLabel(boardDate: string, today: string): string {
  if (!isDayKey(boardDate) || !isDayKey(today)) return '';
  const days = daysBetween(boardDate, today);
  return days <= 0 ? 'today' : `${days}d`;
}

export function ageLongLabel(boardDate: string, today: string): string {
  if (!isDayKey(boardDate) || !isDayKey(today)) return '';
  const days = daysBetween(boardDate, today);
  if (days <= 0) return 'Arrived today';
  return `Waiting ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Account text for a task, or null when it has no (known) account. */
export function taskAccountText(task: Pick<Task, 'accountId' | 'unitId'>, accountsById: Map<string, AccountLite>): string | null {
  if (!task.accountId) return null;
  const account = accountsById.get(task.accountId);
  return account ? accountLabel(account, task.unitId) : null;
}

/** Branch task without an account that the router could not settle. */
export function needsRouting(task: Pick<Task, 'scope' | 'accountId' | 'routing'>): boolean {
  return task.scope === 'branch' && task.accountId === null && (task.routing.status === 'ambiguous' || task.routing.status === 'unmatched');
}

export type StaffingState = { kind: 'request' } | { kind: 'order'; orderId: string; draft: boolean; closed: boolean } | null;

export function staffingState(task: Pick<Task, 'staffingRequest' | 'orderId'>, ordersById: Map<string, Order>): StaffingState {
  if (task.orderId) {
    const order = ordersById.get(task.orderId);
    return { kind: 'order', orderId: task.orderId, draft: order ? order.status === 'draft' : true, closed: order?.status === 'closed' };
  }
  return task.staffingRequest ? { kind: 'request' } : null;
}

/** Board deep link that focuses one order (BoardPage reads ?order=). */
export const boardOrderHref = (orderId: string) => `/?order=${encodeURIComponent(orderId)}`;

export function staffingChipLabel(state: Exclude<StaffingState, null>): string {
  if (state.kind === 'request') return 'Order request';
  return state.draft ? 'Draft order created' : 'Order on board';
}

export const isOpen = (t: Pick<Task, 'status'>) => t.status === 'open';

/** Everyone who can own a task in `branchId`: active people of that branch, by name. */
export function branchPeople(people: Iterable<PersonLite>, branchId: string | null): PersonLite[] {
  if (!branchId) return [];
  return [...people].filter((p) => p.active && p.branchIds.includes(branchId)).sort((a, b) => a.name.localeCompare(b.name));
}

export interface InboxFilters {
  assignee: AssigneeFilter;
  priority: PriorityFilter;
  search: string;
}

export const DEFAULT_FILTERS: InboxFilters = { assignee: 'all', priority: 'all', search: '' };

export function filtersActive(f: InboxFilters): boolean {
  return f.assignee !== 'all' || f.priority !== 'all' || f.search.trim() !== '';
}

function haystack(task: Task, lookups: InboxLookups): string {
  return [
    task.title,
    task.summary,
    task.email?.fromName,
    task.email?.fromAddress,
    task.email?.subject,
    taskAccountText(task, lookups.accountsById),
    task.staffingRequest?.role,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

/** Apply filters, then the shared sort (open first, effective priority, oldest first). */
export function filterTasks(tasks: readonly Task[], filters: InboxFilters, viewerId: string, lookups: InboxLookups): Task[] {
  const needle = filters.search.trim().toLowerCase();
  const filtered = tasks.filter((t) => {
    const a = filters.assignee;
    if (a === 'me' && t.assigneeId !== viewerId) return false;
    if (a === 'unassigned' && t.assigneeId !== null) return false;
    if (typeof a === 'object' && t.assigneeId !== a.userId) return false;
    if (filters.priority !== 'all' && effectivePriority(t, lookups.accountsById) !== filters.priority) return false;
    if (needle && !haystack(t, lookups).includes(needle)) return false;
    return true;
  });
  return sortTasks(filtered, lookups.accountsById);
}

export type CategoryGroups = Record<TaskCategory, Task[]>;

/** Open tasks per category column; `overrides` applies in-flight moves so a drop lands instantly. */
export function groupByCategory(tasks: readonly Task[], overrides: ReadonlyMap<string, TaskCategory> = new Map()): CategoryGroups {
  const groups = Object.fromEntries(TASK_CATEGORIES.map((c) => [c.id, [] as Task[]])) as CategoryGroups;
  for (const t of tasks) {
    if (!isOpen(t)) continue;
    const category = overrides.get(t.id) ?? t.category;
    (groups[category] ?? groups.operations).push(t);
  }
  return groups;
}

export interface InboxCounts {
  open: number;
  hot: number;
  unassigned: number;
  cleared: number;
}

/** Header counts over every task of the view (filters do not change them). */
export function inboxCounts(tasks: readonly Task[], accountsById: Map<string, AccountLite>): InboxCounts {
  let open = 0;
  let hot = 0;
  let unassigned = 0;
  let cleared = 0;
  for (const t of tasks) {
    if (!isOpen(t)) {
      cleared += 1;
      continue;
    }
    open += 1;
    if (effectivePriority(t, accountsById) === 'hot') hot += 1;
    if (t.assigneeId === null && t.scope === 'branch') unassigned += 1;
  }
  return { open, hot, unassigned, cleared };
}

/** Can a task move between columns? Only open tasks, only on today's board. */
export function canRecategorize(task: Pick<Task, 'status'>, readOnly: boolean): boolean {
  return !readOnly && task.status === 'open';
}

export function canClaim(task: Pick<Task, 'status' | 'assigneeId' | 'scope'>, readOnly: boolean): boolean {
  return !readOnly && task.status === 'open' && task.assigneeId === null && task.scope === 'branch';
}

/** Only http(s) links are offered as "Open in Outlook". */
export function safeWebLink(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

// ---------- per-viewer layout preference (a convenience, not shared state) ----------

const layoutKey = (userId: string) => `bs.inbox.layout.${userId}`;

export function loadLayout(userId: string): InboxLayout {
  return readStorage(layoutKey(userId)) === 'list' ? 'list' : 'queue';
}

export function saveLayout(userId: string, layout: InboxLayout): void {
  writeStorage(layoutKey(userId), layout);
}

const dateTimeFmt = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** "11/8, 9:42 AM" (viewer's clock). */
export function formatDateTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return timeZone
    ? new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(d)
    : dateTimeFmt.format(d);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : timeFmt.format(d);
}
