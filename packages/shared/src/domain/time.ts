/**
 * Calendar-day helpers. A "day key" is 'YYYY-MM-DD' in a specific IANA time zone.
 * All functions are pure and DST-safe (use Intl, never fixed offsets).
 */

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** One formatter per time zone; constructing Intl.DateTimeFormat is comparatively expensive. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    // Throws RangeError for an unknown time zone, which is the behavior callers rely on.
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      calendar: 'gregory',
      numberingSystem: 'latn',
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

function keyFromDate(date: Date, timeZone: string): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');
  let y = '';
  let m = '';
  let d = '';
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type === 'year') y = part.value;
    else if (part.type === 'month') m = part.value;
    else if (part.type === 'day') d = part.value;
  }
  return `${y.padStart(4, '0')}-${m}-${d}`;
}

/** UTC midnight epoch ms for a valid day key, or null. */
function parseKey(key: unknown): number | null {
  if (typeof key !== 'string') return null;
  const match = DAY_KEY_RE.exec(key);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC maps years 0-99 to 1900-1999; setUTCFullYear restores the literal year.
  dt.setUTCFullYear(y);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.getTime();
}

function requireKey(key: string): number {
  const ms = parseKey(key);
  if (ms === null) throw new RangeError(`Invalid day key: ${JSON.stringify(key)}`);
  return ms;
}

function keyFromUtcMs(ms: number): string {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Day key for `now` in `timeZone`. */
export function todayKey(timeZone: string, now: Date = new Date()): string {
  return keyFromDate(now, timeZone);
}

/** Day key of an ISO timestamp in `timeZone`. Throws RangeError for an unparseable timestamp. */
export function dayKeyOf(iso: string, timeZone: string): string {
  return keyFromDate(new Date(iso), timeZone);
}

/** Whole days from `fromKey` to `toKey` (negative if toKey is earlier). Calendar math, not 24h blocks. */
export function daysBetween(fromKey: string, toKey: string): number {
  // Both keys are UTC midnights, so the difference is an exact multiple of 24h (UTC has no DST).
  return Math.round((requireKey(toKey) - requireKey(fromKey)) / MS_PER_DAY);
}

/** Add n calendar days to a day key. */
export function addDays(key: string, n: number): string {
  if (!Number.isInteger(n)) throw new RangeError(`Day offset must be an integer: ${n}`);
  return keyFromUtcMs(requireKey(key) + n * MS_PER_DAY);
}

/** "9/14" style short label for a day key. */
export function shortDay(key: string): string {
  const dt = new Date(requireKey(key));
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
}

/** True if string is a real calendar day key. */
export function isDayKey(s: unknown): s is string {
  return parseKey(s) !== null;
}
