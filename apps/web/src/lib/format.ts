/**
 * Display formatting. Calendar math always goes through the shared day-key helpers so the web app
 * and API agree on branch-local days.
 */
import { addDays, daysBetween, isDayKey, shortDay } from '@branchsuite/shared';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat('en-US');

/** "$1,234.50" */
export function formatMoney(amount: number): string {
  return usd.format(amount);
}

/** "$19.50/hr", or an em dash when the rate is unknown. */
export function formatPayRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${usd.format(rate)}/hr`;
}

/** "1,204" */
export function formatCount(n: number): string {
  return count.format(n);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact age of a timestamp: "just now", "5m", "3h", "2d", "3w", then "M/D/YYYY". */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  if (Number.isNaN(ms)) return '';
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d`;
  if (ms < 8 * 7 * DAY) return `${Math.floor(ms / (7 * DAY))}w`;
  return `${then.getMonth() + 1}/${then.getDate()}/${then.getFullYear()}`;
}

/** Long form for titles and screen readers: "5 minutes ago". */
export function relativeAgeLong(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  if (ms < MINUTE) return 'just now';
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'minute');
  if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour');
  return plural(Math.floor(ms / DAY), 'day');
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Weekday of a day key ("Mon"), computed from the calendar date itself, not a time zone. */
export function weekdayOf(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** "Today", "Tomorrow", "Yesterday", or "Thu 9/14" relative to the branch's today key. */
export function dayLabel(dayKey: string, todayKey: string): string {
  if (!isDayKey(dayKey) || !isDayKey(todayKey)) return '';
  const diff = daysBetween(todayKey, dayKey);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return `${weekdayOf(dayKey)} ${shortDay(dayKey)}`;
}

/** Previous / next day keys for day pickers. */
export function stepDay(dayKey: string, delta: -1 | 1): string {
  return addDays(dayKey, delta);
}

/** "3 openings", "1 opening" */
export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : plural}`;
}
