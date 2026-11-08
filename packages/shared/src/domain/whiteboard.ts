/**
 * Whiteboard (huddle) rules. Pure; shared by API (authoritative) and web (editor preview / presenter).
 */
import type { AccountLite } from '../api.js';
import { LIMITS } from '../constants.js';
import type { Order, PersonLite } from '../schemas.js';
import type { Media, Whiteboard, WhiteboardView, WhiteboardViewBlock } from '../whiteboard.js';
import { boardMetrics, openingCounts } from './orders.js';
import { daysBetween, isDayKey, todayKey } from './time.js';

// ---------- branch-local clock (DST-safe via Intl) ----------

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = clockFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      calendar: 'gregory',
      numberingSystem: 'latn',
    });
    clockFormatters.set(timeZone, fmt);
  }
  return fmt;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(ms: number, timeZone: string): LocalParts {
  const out: LocalParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of clockFormatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type in out) out[part.type as keyof LocalParts] = Number(part.value);
  }
  // Some engines print midnight as "24" even with h23; normalize.
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** 'HH:MM' local wall-clock time of `ms` in `timeZone`. */
function localClock(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Offset (local - UTC) in ms at instant `ms`. */
function offsetAt(ms: number, timeZone: string): number {
  const p = localParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const MINUTE = 60_000;

/**
 * First instant on `date` (branch-local) at which the local clock reads `clock` or later.
 * For a time inside a spring-forward gap this is the end of the gap (when the clock first passes it).
 */
function localInstant(date: string, clock: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = clock.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let t = naive - offsetAt(naive, timeZone);
  t = naive - offsetAt(t, timeZone);
  // Inside a DST gap the offset guess can land on either side: settle on the first minute where
  // "same date and clock >= target" holds (at most the gap length away).
  const satisfies = (ms: number) => todayKey(timeZone, new Date(ms)) === date && localClock(ms, timeZone) >= clock;
  for (let i = 0; i < 180 && !satisfies(t); i++) t += MINUTE;
  for (let i = 0; i < 180 && satisfies(t - MINUTE); i++) t -= MINUTE;
  return t;
}

/**
 * Is the board live at `now`? live 'on' -> true (only for its own date == today in tz); 'off' -> false;
 * 'auto' -> today(tz) === wb.date AND window.start <= local HH:MM < window.end. DST-safe via Intl.
 */
export function isWhiteboardLive(wb: Pick<Whiteboard, 'date' | 'window' | 'live'>, timeZone: string, now: Date): boolean {
  if (wb.live === 'off') return false;
  if (todayKey(timeZone, now) !== wb.date) return false;
  if (wb.live === 'on') return true;
  const clock = localClock(now.getTime(), timeZone);
  return wb.window.start <= clock && clock < wb.window.end;
}

/**
 * ISO time of the next board <-> whiteboard switch for this board, or null when none is scheduled:
 * - no board, a board for another date, or a manual 'on'/'off' board -> null (manual changes are pushed);
 * - 'auto' before the window -> window start; inside it -> window end; after it -> null.
 */
export function nextModeChange(wb: Pick<Whiteboard, 'date' | 'window' | 'live'> | null, timeZone: string, now: Date): string | null {
  if (!wb || wb.live !== 'auto') return null;
  if (todayKey(timeZone, now) !== wb.date) return null;
  if (wb.window.start >= wb.window.end) return null;
  const clock = localClock(now.getTime(), timeZone);
  const target = clock < wb.window.start ? wb.window.start : clock < wb.window.end ? wb.window.end : null;
  if (target === null) return null;
  const at = localInstant(wb.date, target, timeZone);
  return at > now.getTime() ? new Date(at).toISOString() : null;
}

/** Validation errors: window.start < window.end; unique block ids and item ids; image blocks reference existing media ids. [] when valid. */
export function validateWhiteboard(wb: Pick<Whiteboard, 'window' | 'blocks'>, mediaIds: Set<string>): string[] {
  const errors: string[] = [];
  if (!(wb.window.start < wb.window.end)) errors.push('The huddle window must end after it starts.');
  const blockIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const block of wb.blocks) {
    if (blockIds.has(block.id)) errors.push(`Duplicate block id ${block.id}.`);
    blockIds.add(block.id);
    switch (block.kind) {
      case 'talking_points':
      case 'assignments':
        for (const item of block.items) {
          if (itemIds.has(item.id)) errors.push(`Duplicate item id ${item.id}.`);
          itemIds.add(item.id);
        }
        break;
      case 'priority_orders': {
        const seen = new Set<string>();
        for (const item of block.items) {
          if (seen.has(item.orderId)) errors.push(`Order ${item.orderId} is listed twice in one block.`);
          seen.add(item.orderId);
        }
        break;
      }
      case 'image':
        if (!mediaIds.has(block.mediaId)) errors.push(`Image ${block.mediaId} was not found. Upload it again.`);
        break;
      case 'note':
      case 'metrics':
        break;
    }
  }
  return errors;
}

export interface WhiteboardViewContext {
  timeZone: string;
  now: Date;
  orders: Order[];
  accounts: AccountLite[];
  people: PersonLite[];
  /** Media id -> URL (staff vs wall paths) ; media missing -> block omitted. */
  mediaUrl: (mediaId: string) => string | null;
  media: Map<string, Pick<Media, 'width' | 'height'>>;
}

function startingSoonLines(order: Order, today: string): number {
  let n = 0;
  for (const line of order.openings) {
    if (line.state !== 'committed' || line.startDate === null || !isDayKey(line.startDate)) continue;
    const days = daysBetween(today, line.startDate);
    if (days >= 0 && days <= LIMITS.startingSoonDays) n += 1;
  }
  return n;
}

/**
 * Resolve references for display:
 * - priority_orders: skip orders that are missing/closed/draft or from another branch; label = account name,
 *   or wall code text when wb.orderLabels === 'code'; counts via openingCounts; startingSoon = committed lines
 *   starting within LIMITS.startingSoonDays.
 * - assignments: person resolved from people (null if unassigned or unknown).
 * - image: omitted if mediaUrl returns null.
 * - metrics: boardMetrics over the branch's orders with today in tz.
 * - empty talking_points/assignments/priority_orders blocks are omitted.
 * isLive via isWhiteboardLive.
 * Only the fields listed in WhiteboardView are copied: never order/account ids, notes, pay or contacts.
 */
export function toWhiteboardView(wb: Whiteboard, ctx: WhiteboardViewContext): WhiteboardView {
  const today = todayKey(ctx.timeZone, ctx.now);
  const ordersById = new Map(ctx.orders.map((o) => [o.id, o] as const));
  const accountsById = new Map(ctx.accounts.map((a) => [a.id, a] as const));
  const peopleById = new Map(ctx.people.map((p) => [p.id, p] as const));
  const branchOrders = ctx.orders.filter((o) => o.branchId === wb.branchId);

  const blocks: WhiteboardViewBlock[] = [];
  for (const block of wb.blocks) {
    switch (block.kind) {
      case 'talking_points':
        if (block.items.length === 0) break;
        blocks.push({ id: block.id, kind: block.kind, title: block.title, items: block.items.map((i) => ({ id: i.id, text: i.text })) });
        break;
      case 'assignments':
        if (block.items.length === 0) break;
        blocks.push({
          id: block.id,
          kind: block.kind,
          title: block.title,
          items: block.items.map((i) => {
            const p = i.userId === null ? undefined : peopleById.get(i.userId);
            return { id: i.id, text: i.text, done: i.done, person: p ? { name: p.name, initials: p.initials, marker: p.marker } : null };
          }),
        });
        break;
      case 'priority_orders': {
        const items = block.items.flatMap((item) => {
          const order = ordersById.get(item.orderId);
          if (!order || order.branchId !== wb.branchId || order.status === 'closed' || order.status === 'draft') return [];
          const account = accountsById.get(order.accountId);
          if (!account || account.branchId !== wb.branchId) return [];
          const counts = openingCounts(order);
          return [
            {
              label: wb.orderLabels === 'code' ? account.wall.code : account.name,
              client: { code: account.wall.code, color: account.wall.color, glyph: account.wall.glyph },
              role: order.role,
              roleCategory: order.roleCategory,
              shift: order.shift,
              toFill: counts.toFill,
              total: counts.total,
              startingSoon: startingSoonLines(order, today),
              note: item.note,
            },
          ];
        });
        if (items.length === 0) break;
        blocks.push({ id: block.id, kind: block.kind, title: block.title, items });
        break;
      }
      case 'image': {
        const url = ctx.mediaUrl(block.mediaId);
        if (url === null) break;
        const meta = ctx.media.get(block.mediaId);
        blocks.push({
          id: block.id,
          kind: block.kind,
          title: block.title,
          caption: block.caption,
          mediaUrl: url,
          width: meta?.width ?? null,
          height: meta?.height ?? null,
        });
        break;
      }
      case 'note':
        blocks.push({ id: block.id, kind: block.kind, title: block.title, text: block.text, tone: block.tone });
        break;
      case 'metrics':
        blocks.push({ id: block.id, kind: block.kind, title: block.title, metrics: boardMetrics(branchOrders, today, ctx.timeZone) });
        break;
    }
  }

  return {
    date: wb.date,
    title: wb.title,
    window: { start: wb.window.start, end: wb.window.end },
    isLive: isWhiteboardLive(wb, ctx.timeZone, ctx.now),
    blocks,
  };
}

/** New board from another date's blocks: fresh block/item ids NOT required (ids kept), assignment done=false & taskId=null; live reset to 'auto'. */
export function copyWhiteboardBlocks(from: Pick<Whiteboard, 'blocks'>): Whiteboard['blocks'] {
  return from.blocks.map((block) => {
    const copy = structuredClone(block);
    if (copy.kind === 'assignments') copy.items = copy.items.map((i) => ({ ...i, done: false, taskId: null }));
    return copy;
  });
}

// ---------- image sniffing ----------

export type SniffedImageType = 'image/png' | 'image/jpeg' | 'image/webp';

const positive = (n: number): number | null => (Number.isInteger(n) && n > 0 ? n : null);
const be16 = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const be32 = (b: Uint8Array, i: number) => (((b[i] ?? 0) << 24) >>> 0) + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
const le16 = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const le24 = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(b: Uint8Array): { width: number | null; height: number | null } {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return { width: null, height: null };
  return { width: positive(be32(b, 16)), height: positive(be32(b, 20)) };
}

/** Start-of-frame markers carrying dimensions (SOF0..SOF15 minus DHT C4, JPG C8, DAC CC). */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function jpegSize(b: Uint8Array): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return { width: null, height: null };
    while (b[i] === 0xff && i < b.length) i++; // fill bytes
    const marker = b[i] ?? 0;
    i++;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
    if (i + 1 >= b.length) break;
    const len = be16(b, i);
    if (len < 2) break;
    if (isSof(marker)) {
      if (i + 6 >= b.length) break;
      return { height: positive(be16(b, i + 3)), width: positive(be16(b, i + 5)) };
    }
    i += len;
  }
  return { width: null, height: null };
}

function webpSize(b: Uint8Array): { width: number | null; height: number | null } {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: positive(le16(b, 26) & 0x3fff), height: positive(le16(b, 28) & 0x3fff) };
  }
  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = ((b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  }
  return { width: null, height: null };
}

/**
 * Detect image type from magic bytes: PNG 89 50 4E 47 0D 0A 1A 0A; JPEG FF D8 FF; WebP 'RIFF'....'WEBP'.
 * Returns content type and dimensions when readable (PNG IHDR; JPEG SOFn scan; WebP VP8/VP8L/VP8X), else null type.
 */
export function sniffImage(bytes: Uint8Array): { contentType: SniffedImageType | null; width: number | null; height: number | null } {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return { contentType: 'image/png', ...pngSize(bytes) };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: 'image/jpeg', ...jpegSize(bytes) };
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return { contentType: 'image/webp', ...webpSize(bytes) };
  return { contentType: null, width: null, height: null };
}
