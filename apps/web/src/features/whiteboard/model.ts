/**
 * Pure helpers for the whiteboard editor, presenter and status strip. No React, no DOM (except the
 * File type), so every rule is unit-testable.
 *
 * The API is authoritative for "is it live" and for resolving references; these helpers only drive
 * what the editor shows between server round trips.
 */
import {
  DEFAULT_HUDDLE_WINDOW,
  newId,
  todayKey,
  WHITEBOARD_LIMITS,
  type Whiteboard,
  type WhiteboardBlock,
  type WhiteboardBlockKind,
  type WhiteboardUpsertInput,
} from '@branchsuite/shared';

// ---------- editor draft ----------

/**
 * The editable part of a whiteboard. Image blocks may have an empty mediaId while their upload is
 * pending; such blocks (and empty list items) stay local and are left out of the PUT.
 */
export interface WhiteboardDraft {
  title: string;
  window: { start: string; end: string };
  orderLabels: 'name' | 'code';
  blocks: WhiteboardBlock[];
}

export function draftOf(wb: Whiteboard | null): WhiteboardDraft {
  if (!wb) return { title: 'Morning huddle', window: { ...DEFAULT_HUDDLE_WINDOW }, orderLabels: 'name', blocks: [] };
  return { title: wb.title, window: { ...wb.window }, orderLabels: wb.orderLabels, blocks: wb.blocks };
}

const trimTo = (s: string, max: number) => s.trim().slice(0, max);

/** The PUT body for a draft: unfinished items and image blocks without an upload are dropped, text is trimmed to the limits. */
export function toUpsertInput(draft: WhiteboardDraft): WhiteboardUpsertInput {
  const blocks: WhiteboardBlock[] = [];
  for (const b of draft.blocks) {
    switch (b.kind) {
      case 'talking_points':
        blocks.push({ ...b, items: b.items.map((i) => ({ ...i, text: trimTo(i.text, WHITEBOARD_LIMITS.maxItemText) })).filter((i) => i.text !== '') });
        break;
      case 'assignments':
        blocks.push({ ...b, items: b.items.map((i) => ({ ...i, text: trimTo(i.text, WHITEBOARD_LIMITS.maxItemText) })).filter((i) => i.text !== '') });
        break;
      case 'priority_orders':
        blocks.push({ ...b, items: b.items.slice(0, WHITEBOARD_LIMITS.maxPriorityOrders).map((i) => ({ ...i, note: trimTo(i.note, 200) })) });
        break;
      case 'image':
        if (b.mediaId) blocks.push({ ...b, caption: trimTo(b.caption, 200), title: trimTo(b.title, 80) });
        break;
      case 'note':
        blocks.push({ ...b, text: trimTo(b.text, WHITEBOARD_LIMITS.maxNoteText) });
        break;
      case 'metrics':
        blocks.push(b);
        break;
    }
  }
  return { title: trimTo(draft.title, 100) || 'Morning huddle', window: draft.window, orderLabels: draft.orderLabels, blocks };
}

export const BLOCK_KINDS: ReadonlyArray<{ kind: WhiteboardBlockKind; label: string; hint: string }> = [
  { kind: 'talking_points', label: 'Talking points', hint: 'A short list to cover in the huddle' },
  { kind: 'assignments', label: 'Assignments', hint: 'Who does what today' },
  { kind: 'priority_orders', label: 'Priority orders', hint: 'Orders the team should push today' },
  { kind: 'image', label: 'Graph / screenshot', hint: 'Paste or upload an image' },
  { kind: 'note', label: 'Note', hint: 'Safety reminder, shout-out or alert' },
  { kind: 'metrics', label: "Today's numbers", hint: 'Live counts from the board' },
];

export function blockKindLabel(kind: WhiteboardBlockKind): string {
  return BLOCK_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

export function newBlock(kind: WhiteboardBlockKind): WhiteboardBlock {
  const id = newId('wbb');
  switch (kind) {
    case 'talking_points':
      return { id, kind, title: 'Talking points', items: [{ id: newId('wbi'), text: '' }] };
    case 'assignments':
      return { id, kind, title: 'Assignments', items: [newAssignment()] };
    case 'priority_orders':
      return { id, kind, title: 'Priority orders', items: [] };
    case 'image':
      return { id, kind, title: '', mediaId: '', caption: '' };
    case 'note':
      return { id, kind, title: '', text: '', tone: 'neutral' };
    case 'metrics':
      return { id, kind, title: "Today's numbers" };
  }
}

export function newAssignment(userId: string | null = null): Extract<WhiteboardBlock, { kind: 'assignments' }>['items'][number] {
  return { id: newId('wbi'), userId, text: '', taskId: null, done: false };
}

/** Move the element at `from` to `to` (both clamped). Returns the same array when nothing moves. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item!);
  return next;
}

// ---------- images ----------

export const IMAGE_TYPES: readonly string[] = WHITEBOARD_LIMITS.imageTypes;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

/** Client-side check before upload. Returns a friendly message, or null when the file is fine. */
export function validateImageFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Use a PNG, JPEG or WebP image. Screenshots pasted with Ctrl+V are PNG and work as is.';
  if (file.size <= 0) return 'That image is empty.';
  if (file.size > WHITEBOARD_LIMITS.maxImageBytes)
    return `That image is ${formatBytes(file.size)}. The limit is ${formatBytes(WHITEBOARD_LIMITS.maxImageBytes)}; crop it or save it as JPEG.`;
  return null;
}

/** First image file in a clipboard or drop payload, if any. */
export function imageFromTransfer(data: Pick<DataTransfer, 'files' | 'items'> | null): File | null {
  if (!data) return null;
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith('image/')) return f;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

// ---------- window + live state ----------

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClock(s: string): boolean {
  return CLOCK_RE.test(s);
}

/** "07:30" -> "7:30"; "13:05" -> "1:05". */
export function clockLabel(hhmm: string): string {
  const m = CLOCK_RE.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]}`;
}

/** "7:30–8:15" (en dash). */
export function windowLabel(w: { start: string; end: string }): string {
  return `${clockLabel(w.start)}–${clockLabel(w.end)}`;
}

/** Message when a window is not usable, else null. */
export function windowError(w: { start: string; end: string }): string | null {
  if (!isClock(w.start) || !isClock(w.end)) return 'Enter both times.';
  if (w.start >= w.end) return 'The huddle must end after it starts.';
  return null;
}

function localClock(timeZone: string, now: Date): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  }
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

export type HuddleState = 'live' | 'scheduled' | 'off';

/**
 * What the status pill says. Mirrors the server rule (isWhiteboardLive): 'on' is live only on its own
 * date; 'auto' is live inside the window on its date; 'off' never. A day that has not started, or
 * whose window is still ahead, is 'scheduled'. A finished window on a past day reads 'off'.
 */
export function huddleState(wb: Pick<Whiteboard, 'date' | 'window' | 'live'> | null, timeZone: string, now: Date): HuddleState {
  if (!wb) return 'scheduled';
  if (wb.live === 'off') return 'off';
  let today: string;
  try {
    today = todayKey(timeZone, now);
  } catch {
    today = todayKey('UTC', now);
  }
  if (wb.date < today) return 'off';
  if (wb.date > today) return 'scheduled';
  if (wb.live === 'on') return 'live';
  const clock = localClock(timeZone, now);
  if (clock >= wb.window.start && clock < wb.window.end) return 'live';
  return clock < wb.window.start ? 'scheduled' : 'off';
}

export const HUDDLE_STATE_LABEL: Record<HuddleState, string> = {
  live: 'Live on displays',
  scheduled: 'Scheduled',
  off: 'Off today',
};

// ---------- note text ----------

export type NoteSegment = { kind: 'para'; text: string } | { kind: 'bullets'; items: string[] };

/** Plain text into paragraphs and bullet lists: lines starting with "- " become bullets. No HTML. */
export function noteSegments(text: string): NoteSegment[] {
  const out: NoteSegment[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-•]\s+(.*)$/.exec(line);
    const last = out[out.length - 1];
    if (bullet) {
      if (last?.kind === 'bullets') last.items.push(bullet[1]!);
      else out.push({ kind: 'bullets', items: [bullet[1]!] });
    } else if (line.trim() === '') {
      if (last && !(last.kind === 'para' && last.text === '')) out.push({ kind: 'para', text: '' });
    } else if (last?.kind === 'para' && last.text !== '') {
      last.text += `\n${line}`;
    } else {
      if (last?.kind === 'para' && last.text === '') out.pop();
      out.push({ kind: 'para', text: line });
    }
  }
  while (out.length && out[out.length - 1]!.kind === 'para' && (out[out.length - 1] as { text: string }).text === '') out.pop();
  return out;
}

// ---------- dates ----------

function utcDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "Sunday, November 8" for a day key (calendar math, no zone shifts). */
export function longDate(key: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(utcDate(key));
}

/** "Sun 8" for the date strip. */
export function shortDateParts(key: string): { weekday: string; day: string; month: string } {
  const d = utcDate(key);
  return {
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d),
    day: String(d.getUTCDate()),
    month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d),
  };
}

/** Two-letter initials from a name, for display only. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')).toUpperCase();
}
