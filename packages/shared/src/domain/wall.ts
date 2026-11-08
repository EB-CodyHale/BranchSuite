/**
 * Wall (public display) coding. The API calls toWallFeed and returns ONLY its output to displays.
 * This function is the privacy boundary: it must never copy a field that settings do not allow.
 */
import type { AccountLite, WallFeed, WallOpening, WallOrder } from '../api.js';
import {
  DEFAULT_PAY_BANDS,
  LIMITS,
  ROLE_CATEGORIES,
  WALL_CODE_DIGITS,
  WALL_CODE_LETTERS,
  WALL_COLOR_IDS,
  WALL_GLYPHS,
} from '../constants.js';
import { zWallSettings, type Branch, type Opening, type Order, type PersonLite, type WallCode, type WallSettings } from '../schemas.js';
import { unitPath } from './accounts.js';
import { effectiveOwnerId, openingCounts, payText, scheduleText } from './orders.js';
import { daysBetween, isDayKey, todayKey } from './time.js';

export interface WallFeedInput {
  branch: Branch;
  orders: Order[];
  accounts: AccountLite[];
  people: PersonLite[];
  now: Date;
  /** Maps order id -> opaque stable key (API supplies an HMAC). */
  keyFor: (orderId: string) => string;
}

/** Stored settings with zod defaults applied. Invalid stored settings fall back to the (most private) defaults. */
function resolveSettings(stored: Partial<WallSettings> | undefined): WallSettings {
  const parsed = zWallSettings.safeParse(stored ?? {});
  return parsed.success ? parsed.data : zWallSettings.parse({});
}

const ROLE_CATEGORY_LABEL = new Map<string, string>(ROLE_CATEGORIES.map((r) => [r.id, r.label]));

function startsSoon(line: Opening, today: string): boolean {
  if (line.state !== 'committed' || line.startDate === null || !isDayKey(line.startDate)) return false;
  const days = daysBetween(today, line.startDate);
  return days >= 0 && days <= LIMITS.startingSoonDays;
}

function wallOpenings(lines: Opening[], settings: WallSettings, today: string): WallOpening[] {
  if (settings.candidateDisplay === 'hidden') {
    return lines
      .filter((l) => l.state === 'open' || l.state === 'tentative')
      .map(() => ({ state: 'open', mark: null, startsSoon: false }));
  }
  return lines.map((l) => ({
    state: l.state,
    mark: settings.candidateDisplay === 'initials' && l.state !== 'open' ? l.initials : null,
    startsSoon: startsSoon(l, today),
  }));
}

function locationText(order: Order, account: AccountLite): string | null {
  const unitName = order.unitId === null ? '' : (unitPath(account, order.unitId)[0]?.name ?? '');
  const text = [unitName.trim(), order.site.trim()].filter((s) => s.length > 0).join(' · ');
  return text.length > 0 ? text : null;
}

function wallPay(rate: number | null, settings: WallSettings): string | null {
  if (rate === null || settings.payDisplay === 'hidden') return null;
  if (settings.payDisplay === 'exact') return payText(rate) || null;
  return payBandLabel(rate, settings.payBands ?? DEFAULT_PAY_BANDS) || null;
}

/**
 * Build the coded feed using branch.wall settings (apply zod defaults for missing fields).
 * - Include status 'active' orders, plus 'paused' only when showPaused. Never draft/closed.
 * - Exclude orders whose account is inactive or reserved.
 * - Sort: isPriority first, then toFill desc, then account wall code asc.
 * - client: code/color/glyph unless clientDisplay 'hidden' (null). clientName only when 'name'.
 * - role: order.role when 'full', else ROLE_CATEGORIES label.
 * - schedule: scheduleText when showSchedule, else null. location: unit name/site when showLocation.
 * - pay: 'exact' -> payText; 'band' -> band label from payBands ?? DEFAULT_PAY_BANDS; 'hidden'/null rate -> null.
 * - owner: per ownerDisplay using effectiveOwnerId; 'hidden' -> null; 'marker' -> initials null.
 * - openings: mark = initials only when candidateDisplay 'initials'; 'hidden' -> openings array contains only
 *   state 'open' entries for open/tentative lines and omits filled lines entirely (toFill still accurate).
 * - totals computed over included orders. today = todayKey(branch.timeZone, now).
 * - NEVER include: order ids, account ids/names (unless 'name'), notes, contacts, candidate ids, pay when hidden.
 * Orders of another branch, and orders whose account is unknown, are excluded too.
 */
export function toWallFeed(input: WallFeedInput): WallFeed {
  const { branch, now } = input;
  const settings = resolveSettings(branch.wall);
  const today = todayKey(branch.timeZone, now);
  const accountsById = new Map(input.accounts.map((a) => [a.id, a] as const));
  const peopleById = new Map(input.people.map((p) => [p.id, p] as const));

  const included = input.orders.flatMap((order) => {
    if (order.branchId !== branch.id) return [];
    if (order.status !== 'active' && !(order.status === 'paused' && settings.showPaused)) return [];
    const account = accountsById.get(order.accountId);
    if (!account || !account.active || account.reserved !== null) return [];
    return [{ order, account, counts: openingCounts(order) }];
  });

  included.sort((a, b) => {
    if (a.order.isPriority !== b.order.isPriority) return a.order.isPriority ? -1 : 1;
    if (a.counts.toFill !== b.counts.toFill) return b.counts.toFill - a.counts.toFill;
    if (a.account.wall.code !== b.account.wall.code) return a.account.wall.code < b.account.wall.code ? -1 : 1;
    return a.order.createdAt < b.order.createdAt ? -1 : a.order.createdAt > b.order.createdAt ? 1 : 0;
  });

  const totals = { orders: 0, openings: 0, toFill: 0, startingSoon: 0 };
  const orders: WallOrder[] = included.map(({ order, account, counts }) => {
    totals.orders += 1;
    totals.openings += counts.total;
    totals.toFill += counts.toFill;
    for (const line of order.openings) if (startsSoon(line, today)) totals.startingSoon += 1;

    let owner: WallOrder['owner'] = null;
    if (settings.ownerDisplay !== 'hidden') {
      const ownerId = effectiveOwnerId(order, account, peopleById);
      const person = ownerId === null ? undefined : peopleById.get(ownerId);
      if (person) owner = { marker: person.marker, initials: settings.ownerDisplay === 'initials' ? person.initials : null };
    }
    const schedule = settings.showSchedule ? scheduleText(order) : '';

    return {
      key: input.keyFor(order.id),
      client:
        settings.clientDisplay === 'hidden'
          ? null
          : { code: account.wall.code, color: account.wall.color, glyph: account.wall.glyph },
      clientName: settings.clientDisplay === 'name' ? account.name : null,
      role: settings.roleDisplay === 'full' ? order.role : (ROLE_CATEGORY_LABEL.get(order.roleCategory) ?? 'Other'),
      roleCategory: order.roleCategory,
      shift: order.shift,
      schedule: schedule.length > 0 ? schedule : null,
      pay: wallPay(order.payRate, settings),
      location: settings.showLocation ? locationText(order, account) : null,
      isPriority: order.isPriority,
      paused: order.status === 'paused',
      owner,
      openings: wallOpenings(order.openings, settings, today),
      toFill: counts.toFill,
    };
  });

  return {
    branch: { name: branch.name, timeZone: branch.timeZone },
    generatedAt: now.toISOString(),
    today,
    settings: {
      theme: settings.theme,
      pageSeconds: settings.pageSeconds,
      headline: settings.headline,
      candidateDisplay: settings.candidateDisplay,
      payDisplay: settings.payDisplay,
      clientDisplay: settings.clientDisplay,
    },
    totals,
    orders,
  };
}

function* codeSpace(): Generator<string[]> {
  const letters = [...WALL_CODE_LETTERS];
  const digits = [...WALL_CODE_DIGITS];
  yield letters.flatMap((l) => digits.map((d) => `${l}${d}`));
  yield letters.flatMap((a) => letters.flatMap((b) => digits.map((d) => `${a}${b}${d}`)));
  yield letters.flatMap((a) => letters.map((b) => `${a}${b}`));
}

function pick<T>(items: readonly T[], rng: () => number): T {
  const i = Math.min(items.length - 1, Math.max(0, Math.floor(rng() * items.length)));
  return items[i] as T;
}

/** Items whose score is minimal. */
function leastBy<T>(items: readonly T[], score: (item: T) => number): T[] {
  const scores = items.map(score);
  const min = Math.min(...scores);
  return items.filter((_, i) => scores[i] === min);
}

/**
 * Generate a new wall code unique among `taken` codes (compare `code` only).
 * Format: one letter from WALL_CODE_LETTERS + one digit from WALL_CODE_DIGITS (e.g. 'K7');
 * when all 132 combos are taken, two letters + digit. Color and glyph chosen to spread usage:
 * least-used color, then least-used glyph among taken, ties broken by rng.
 * `rng` returns [0,1). Deterministic for a given rng sequence.
 * Glyph usage is counted first among taken codes with the chosen color, then overall, so
 * color+glyph pairs repeat only after all 48 pairs are in use. rng is called for the code, then color, then glyph.
 * Throws when every code in the alphabet is taken.
 */
export function generateWallCode(taken: WallCode[], rng: () => number): WallCode {
  const takenCodes = new Set(taken.map((t) => t.code));
  let code: string | undefined;
  for (const tier of codeSpace()) {
    const free = tier.filter((c) => !takenCodes.has(c));
    if (free.length > 0) {
      code = pick(free, rng);
      break;
    }
  }
  if (code === undefined) throw new Error('No wall codes left');

  const colorUse = (id: string): number => taken.filter((t) => t.color === id).length;
  const color = pick(leastBy(WALL_COLOR_IDS, colorUse), rng);
  const sameColor = taken.filter((t) => t.color === color);
  const glyphCandidates = leastBy(
    leastBy(WALL_GLYPHS, (g) => sameColor.filter((t) => t.glyph === g).length),
    (g) => taken.filter((t) => t.glyph === g).length,
  );
  const glyph = pick(glyphCandidates, rng);
  return { code, color, glyph };
}

/** Band label for a rate: the band with the highest `min` not above the rate (lowest band if below all). '' with no bands. */
export function payBandLabel(rate: number, bands: ReadonlyArray<{ min: number; label: string }>): string {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  let label = sorted[0]?.label ?? '';
  for (const band of sorted) if (rate >= band.min) label = band.label;
  return label;
}
