/**
 * Mail-driven task helpers.
 */
import type { TaskCategory, TaskPriority } from '../constants.js';
import type { Account, Task } from '../schemas.js';
import { dayKeyOf, isDayKey } from './time.js';

const ASSOCIATE_RE =
  /\b(time ?cards?|time ?sheets?|payroll|pay ?checks?|call(?:ed|ing|s)?[\s-]?offs?|no[\s-]call|ncns|attendance|associates?|employees?|workers?|injur(?:y|ies|ed)|badges?|orientation)\b/i;
const CLIENT_RE =
  /\b(orders?|requests?|need(?:s|ed)?|head ?counts?|staff(?:ing)?|coverage|invoices?|rates?|quotes?|start(?:s|ed|ing)?|shifts?)\b/i;

/**
 * Keyword fallback category when the model gives none (model category is preferred).
 * associate: timecard, timesheet, payroll, paycheck, call off/call-off, no call, NCNS, attendance, associate, employee, worker, injury, badge, orientation
 * client: order, request, need, headcount, staff, coverage, invoice, rate, quote, start, shift (when no associate hit)
 * else operations.
 * Keywords match as whole words, case-insensitive, with simple plural/tense forms.
 */
export function inferCategory(text: string): TaskCategory {
  if (ASSOCIATE_RE.test(text)) return 'associate';
  if (CLIENT_RE.test(text)) return 'client';
  return 'operations';
}

/** Priority-account rule: tasks for an isPriority account are at least 'normal' (low -> normal); otherwise unchanged. */
export function effectivePriority(task: Pick<Task, 'priority' | 'accountId'>, accountsById: Map<string, Pick<Account, 'isPriority'>>): TaskPriority {
  if (task.priority !== 'low' || task.accountId === null) return task.priority;
  return accountsById.get(task.accountId)?.isPriority ? 'normal' : 'low';
}

/** Completion instant: completedAt, else the team-reply time. null for open tasks. */
function completionIso(task: Task): string | null {
  if (task.status === 'open') return null;
  return task.completedAt ?? task.closedByReply?.at ?? null;
}

function completedOn(task: Task, date: string, timeZone: string): boolean {
  const iso = completionIso(task);
  if (iso === null || Number.isNaN(Date.parse(iso))) return false;
  return dayKeyOf(iso, timeZone) === date;
}

/**
 * Visibility for a board date view:
 * - viewing today: all open tasks with boardDate <= today (carried), plus tasks completed today.
 * - viewing a past date D: tasks with boardDate === D, plus tasks completed on D.
 * Future/malformed boardDate never shown as carried work. completedAt converted with timeZone.
 * Completed tasks without completedAt use closedByReply.at. A date other than today (including a
 * future date) uses the past-date rule.
 */
export function isVisibleOn(task: Task, date: string, today: string, timeZone: string): boolean {
  if (completedOn(task, date, timeZone)) return true;
  const validBoardDate = isDayKey(task.boardDate);
  if (date === today) return task.status === 'open' && validBoardDate && task.boardDate <= today;
  return validBoardDate && task.boardDate === date;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { hot: 0, normal: 1, low: 2 };

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Sort: open before completed; hot > normal > low; then boardDate asc (oldest first); then createdAt asc. */
export function sortTasks(tasks: Task[], accountsById: Map<string, Pick<Account, 'isPriority'>>): Task[] {
  const keyed = tasks.map((task) => ({
    task,
    done: task.status === 'open' ? 0 : 1,
    rank: PRIORITY_RANK[effectivePriority(task, accountsById)],
  }));
  keyed.sort(
    (a, b) =>
      a.done - b.done ||
      a.rank - b.rank ||
      compareStrings(a.task.boardDate, b.task.boardDate) ||
      compareStrings(a.task.createdAt, b.task.createdAt),
  );
  return keyed.map((k) => k.task);
}

/** Priority escalation: max of two priorities (hot > normal > low). */
export function maxPriority(a: TaskPriority, b: TaskPriority): TaskPriority {
  return PRIORITY_RANK[a] <= PRIORITY_RANK[b] ? a : b;
}
