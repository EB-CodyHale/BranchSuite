import { describe, expect, it } from 'vitest';
import type { WallFeed } from '../api.js';
import { WALL_CODE_DIGITS, WALL_CODE_LETTERS, WALL_COLOR_IDS, WALL_GLYPHS } from '../constants.js';
import { zWallCode, zWallSettings, type Order, type WallCode, type WallSettings } from '../schemas.js';
import { accountLite, branch, opening, order, person, unit } from './fixtures.test-util.js';
import { generateWallCode, payBandLabel, toWallFeed, type WallFeedInput } from './wall.js';

const NOW = new Date('2026-03-10T16:00:00Z'); // 10:00 CDT, today = 2026-03-10

const SECRET = {
  accountName: 'Quillfeather Ceramics',
  accountId: 'acc_secret_77',
  orderId: 'ord_secret_99',
  note: 'Gate code 4417 call Dana',
  site: 'Dock 9 rear lot',
  unitName: 'Kiln Hall',
  initials: 'QZ',
  ownerInitials: 'MW',
  candidateId: 'cand_secret_5',
  payRate: 23.75,
};

function fixture(wall: Partial<WallSettings> = {}, extraOrders: Order[] = []): WallFeedInput {
  const acct = accountLite({
    id: SECRET.accountId,
    name: SECRET.accountName,
    aliases: ['Quill'],
    ownerId: 'usr_owner',
    wall: { code: 'K7', color: 'w3', glyph: 'star' },
    units: [unit({ id: 'unit_k', name: SECRET.unitName })],
  });
  const main = order({
    id: SECRET.orderId,
    accountId: SECRET.accountId,
    unitId: 'unit_k',
    site: SECRET.site,
    role: 'Kiln loader',
    roleCategory: 'production',
    payRate: SECRET.payRate,
    note: SECRET.note,
    openings: [
      opening({ id: 'opn_a', state: 'open' }),
      opening({ id: 'opn_b', state: 'tentative', initials: SECRET.initials, candidateId: SECRET.candidateId }),
      opening({ id: 'opn_c', state: 'committed', initials: SECRET.initials, startDate: '2026-03-11' }),
      opening({ id: 'opn_d', state: 'started', initials: SECRET.initials }),
    ],
  });
  return {
    branch: branch({ wall: zWallSettings.parse(wall) }),
    orders: [main, ...extraOrders],
    accounts: [acct],
    people: [person({ id: 'usr_owner', initials: SECRET.ownerInitials, marker: 'purple' })],
    now: NOW,
    keyFor: (id) => `k_${id.length}`,
  };
}

function feedJson(feed: WallFeed): string {
  return JSON.stringify(feed);
}

describe('toWallFeed privacy (default settings)', () => {
  const feed = toWallFeed(fixture());
  const json = feedJson(feed);

  it.each([
    ['account name', SECRET.accountName],
    ['account alias', 'Quill'],
    ['account id', SECRET.accountId],
    ['order id', SECRET.orderId],
    ['note text', SECRET.note],
    ['note fragment', 'Gate code'],
    ['site', SECRET.site],
    ['unit name', SECRET.unitName],
    ['candidate initials', SECRET.initials],
    ['owner initials', SECRET.ownerInitials],
    ['candidate id', SECRET.candidateId],
    ['pay number', '23.75'],
    ['dollar sign', '$'],
  ])('never contains the %s', (_label, secret) => {
    expect(json).not.toContain(secret);
  });

  it('carries only coded, public-safe fields', () => {
    expect(feed.orders).toHaveLength(1);
    const o = feed.orders[0]!;
    expect(o.key).toBe(`k_${SECRET.orderId.length}`);
    expect(o.client).toEqual({ code: 'K7', color: 'w3', glyph: 'star' });
    expect(o.clientName).toBeNull();
    expect(o.pay).toBeNull();
    expect(o.location).toBeNull();
    expect(o.owner).toEqual({ marker: 'purple', initials: null });
    expect(o.openings.map((l) => l.mark)).toEqual([null, null, null, null]);
    expect(o.openings.map((l) => l.state)).toEqual(['open', 'tentative', 'committed', 'started']);
    expect(o.openings.map((l) => l.startsSoon)).toEqual([false, false, true, false]);
    expect(o.toFill).toBe(2);
    expect(o.schedule).toBe('M-F · 6:00a-2:30p');
    expect(o.role).toBe('Kiln loader');
    expect(Object.keys(o).sort()).toEqual(
      ['client', 'clientName', 'isPriority', 'key', 'location', 'openings', 'owner', 'paused', 'pay', 'role', 'roleCategory', 'schedule', 'shift', 'toFill'].sort(),
    );
  });

  it('reports totals, today and the public settings subset', () => {
    expect(feed.today).toBe('2026-03-10');
    expect(feed.generatedAt).toBe(NOW.toISOString());
    expect(feed.totals).toEqual({ orders: 1, openings: 4, toFill: 2, startingSoon: 1 });
    expect(feed.settings).toEqual({ theme: 'dark', pageSeconds: 15, headline: '', candidateDisplay: 'marks', payDisplay: 'hidden', clientDisplay: 'code' });
    expect(Object.keys(feed.settings)).not.toContain('showLocation');
  });

  it('falls back to private defaults when stored settings are invalid', () => {
    const input = fixture();
    input.branch = { ...input.branch, wall: { ...input.branch.wall, payDisplay: 'everything' as never, clientDisplay: 'name' } };
    const json2 = feedJson(toWallFeed(input));
    expect(json2).not.toContain(SECRET.accountName);
    expect(json2).not.toContain('23.75');
  });
});

describe('toWallFeed settings toggle exactly one thing', () => {
  const baseline = toWallFeed(fixture()).orders[0]!;
  const only = (wall: Partial<WallSettings>) => toWallFeed(fixture(wall)).orders[0]!;
  const diffKeys = (o: object): string[] =>
    Object.keys(o).filter((k) => JSON.stringify((o as Record<string, unknown>)[k]) !== JSON.stringify((baseline as unknown as Record<string, unknown>)[k]));

  it('clientDisplay name adds the name; hidden removes the code', () => {
    const named = only({ clientDisplay: 'name' });
    expect(named.clientName).toBe(SECRET.accountName);
    expect(diffKeys(named)).toEqual(['clientName']);
    const hidden = only({ clientDisplay: 'hidden' });
    expect(hidden.client).toBeNull();
    expect(diffKeys(hidden)).toEqual(['client']);
  });

  it('payDisplay exact and band', () => {
    const exact = only({ payDisplay: 'exact' });
    expect(exact.pay).toBe('$23.75/hr');
    expect(diffKeys(exact)).toEqual(['pay']);
    expect(only({ payDisplay: 'band' }).pay).toBe('$$$');
    expect(only({ payDisplay: 'band', payBands: [{ min: 0, label: 'L' }, { min: 30, label: 'H' }] }).pay).toBe('L');
  });

  it('pay stays null when the order has no rate', () => {
    const input = fixture({ payDisplay: 'exact' });
    input.orders = [{ ...input.orders[0]!, payRate: null }];
    expect(toWallFeed(input).orders[0]!.pay).toBeNull();
  });

  it('candidateDisplay initials shows marks on filled lines only', () => {
    const o = only({ candidateDisplay: 'initials' });
    expect(o.openings.map((l) => l.mark)).toEqual([null, SECRET.initials, SECRET.initials, SECRET.initials]);
    expect(diffKeys(o)).toEqual(['openings']);
  });

  it('candidateDisplay hidden lists only lines to fill, as open, with toFill intact', () => {
    const o = only({ candidateDisplay: 'hidden' });
    expect(o.openings).toEqual([
      { state: 'open', mark: null, startsSoon: false },
      { state: 'open', mark: null, startsSoon: false },
    ]);
    expect(o.toFill).toBe(2);
    expect(diffKeys(o)).toEqual(['openings']);
  });

  it('roleDisplay category uses the category label', () => {
    const o = only({ roleDisplay: 'category' });
    expect(o.role).toBe('Production / assembly');
    expect(diffKeys(o)).toEqual(['role']);
  });

  it('showSchedule false hides the schedule', () => {
    const o = only({ showSchedule: false });
    expect(o.schedule).toBeNull();
    expect(diffKeys(o)).toEqual(['schedule']);
  });

  it('showLocation shows unit and site', () => {
    const o = only({ showLocation: true });
    expect(o.location).toBe(`${SECRET.unitName} · ${SECRET.site}`);
    expect(diffKeys(o)).toEqual(['location']);
  });

  it('ownerDisplay initials and hidden', () => {
    const withInitials = only({ ownerDisplay: 'initials' });
    expect(withInitials.owner).toEqual({ marker: 'purple', initials: SECRET.ownerInitials });
    expect(diffKeys(withInitials)).toEqual(['owner']);
    const hidden = only({ ownerDisplay: 'hidden' });
    expect(hidden.owner).toBeNull();
    expect(diffKeys(hidden)).toEqual(['owner']);
  });

  it('notes and ids are never shown, even with every setting open', () => {
    const json = feedJson(
      toWallFeed(fixture({ clientDisplay: 'name', payDisplay: 'exact', candidateDisplay: 'initials', showLocation: true, ownerDisplay: 'initials' })),
    );
    expect(json).not.toContain(SECRET.note);
    expect(json).not.toContain(SECRET.orderId);
    expect(json).not.toContain(SECRET.accountId);
    expect(json).not.toContain(SECRET.candidateId);
  });

  it('headline, theme and pageSeconds pass through', () => {
    const feed = toWallFeed(fixture({ headline: 'Now hiring', theme: 'light', pageSeconds: 30 }));
    expect(feed.settings).toMatchObject({ headline: 'Now hiring', theme: 'light', pageSeconds: 30 });
  });
});

describe('toWallFeed inclusion and order', () => {
  let seqNo = 0;
  const extra = (over: Partial<Order>): Order => order({ id: `ord_extra_${++seqNo}`, accountId: SECRET.accountId, ...over });

  it('excludes draft, closed and (by default) paused orders', () => {
    const feed = toWallFeed(fixture({}, [extra({ status: 'draft' }), extra({ status: 'closed' }), extra({ status: 'paused' })]));
    expect(feed.orders).toHaveLength(1);
    expect(feed.totals.orders).toBe(1);
  });

  it('includes paused orders when showPaused, flagged as paused', () => {
    const feed = toWallFeed(fixture({ showPaused: true }, [extra({ status: 'paused' }), extra({ status: 'draft' })]));
    expect(feed.orders).toHaveLength(2);
    expect(feed.orders.filter((o) => o.paused)).toHaveLength(1);
  });

  it('excludes reserved, inactive and unknown accounts, and other branches', () => {
    const input = fixture();
    const reserved = accountLite({ id: 'acc_res', reserved: 'internal', wall: { code: 'A3', color: 'w1', glyph: 'circle' } });
    const inactive = accountLite({ id: 'acc_off', active: false, wall: { code: 'B3', color: 'w1', glyph: 'circle' } });
    input.accounts = [...input.accounts, reserved, inactive];
    input.orders = [
      ...input.orders,
      extra({ accountId: 'acc_res' }),
      extra({ accountId: 'acc_off' }),
      extra({ accountId: 'acc_missing' }),
      extra({ branchId: 'br_other' }),
    ];
    expect(toWallFeed(input).orders).toHaveLength(1);
  });

  it('sorts priority first, then toFill desc, then wall code', () => {
    const input = fixture();
    const other = accountLite({ id: 'acc_2', wall: { code: 'A4', color: 'w2', glyph: 'square' } });
    input.accounts = [...input.accounts, other];
    input.keyFor = (id) => id;
    input.orders = [
      order({ id: 'k7-one', accountId: SECRET.accountId, openings: [opening()] }),
      order({ id: 'a4-one', accountId: 'acc_2', openings: [opening()] }),
      order({ id: 'a4-three', accountId: 'acc_2', openings: [opening({ id: 'x1' }), opening({ id: 'x2' }), opening({ id: 'x3' })] }),
      order({ id: 'k7-prio', accountId: SECRET.accountId, isPriority: true, openings: [opening({ state: 'started', initials: 'AB' })] }),
    ];
    expect(toWallFeed(input).orders.map((o) => o.key)).toEqual(['k7-prio', 'a4-three', 'a4-one', 'k7-one']);
  });

  it('computes today in the branch time zone', () => {
    const input = fixture();
    input.now = new Date('2026-03-11T04:30:00Z'); // 23:30 CDT on Mar 10
    expect(toWallFeed(input).today).toBe('2026-03-10');
  });
});

describe('generateWallCode', () => {
  const seq = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length]!;
  };
  const allSingle = [...WALL_CODE_LETTERS].flatMap((l) => [...WALL_CODE_DIGITS].map((d) => `${l}${d}`));

  it('produces a valid letter+digit code from the safe alphabet', () => {
    const c = generateWallCode([], seq(0.5));
    expect(zWallCode.safeParse(c).success).toBe(true);
    expect(c.code).toMatch(new RegExp(`^[${WALL_CODE_LETTERS}][${WALL_CODE_DIGITS}]$`));
  });

  it('is deterministic for a given rng sequence', () => {
    const taken: WallCode[] = [{ code: 'K7', color: 'w1', glyph: 'circle' }];
    expect(generateWallCode(taken, seq(0.1, 0.7, 0.3))).toEqual(generateWallCode(taken, seq(0.1, 0.7, 0.3)));
    expect(generateWallCode([], seq(0))).toEqual({ code: 'A3', color: 'w1', glyph: 'circle' });
  });

  it('never returns a taken code', () => {
    const taken: WallCode[] = [];
    for (let i = 0; i < 132; i++) {
      const c = generateWallCode(taken, Math.random);
      expect(taken.some((t) => t.code === c.code)).toBe(false);
      taken.push(c);
    }
    expect(new Set(taken.map((t) => t.code)).size).toBe(132);
    expect(taken.every((t) => /^[A-Z][0-9]$/.test(t.code))).toBe(true);
  });

  it('falls back to two letters + digit after all 132 single codes are taken', () => {
    const taken = allSingle.map((code) => ({ code, color: 'w1' as const, glyph: 'circle' as const }));
    const c = generateWallCode(taken, seq(0));
    expect(c.code).toMatch(/^[A-Z]{2}[0-9]$/);
    expect(zWallCode.safeParse(c).success).toBe(true);
  });

  it('spreads colors: picks the least-used color', () => {
    const taken: WallCode[] = WALL_COLOR_IDS.filter((c) => c !== 'w6').map((color, i) => ({ code: allSingle[i]!, color, glyph: 'circle' }));
    expect(generateWallCode(taken, seq(0.99)).color).toBe('w6');
  });

  it('spreads glyphs within the chosen color, so pairs repeat only after all 48 are used', () => {
    const taken: WallCode[] = [];
    for (let i = 0; i < WALL_COLOR_IDS.length * WALL_GLYPHS.length; i++) taken.push(generateWallCode(taken, Math.random));
    const pairs = new Set(taken.map((t) => `${t.color}/${t.glyph}`));
    expect(pairs.size).toBe(48);
    const colorCounts = WALL_COLOR_IDS.map((c) => taken.filter((t) => t.color === c).length);
    expect(Math.max(...colorCounts) - Math.min(...colorCounts)).toBe(0);
  });

  it('keeps color usage balanced over many codes', () => {
    const taken: WallCode[] = [];
    for (let i = 0; i < 100; i++) taken.push(generateWallCode(taken, Math.random));
    const colorCounts = WALL_COLOR_IDS.map((c) => taken.filter((t) => t.color === c).length);
    expect(Math.max(...colorCounts) - Math.min(...colorCounts)).toBeLessThanOrEqual(1);
  });

  it('calls rng exactly three times (code, color, glyph)', () => {
    let calls = 0;
    generateWallCode([], () => {
      calls += 1;
      return 0.4;
    });
    expect(calls).toBe(3);
  });

  it('tolerates rng returning the upper edge', () => {
    expect(() => generateWallCode([], () => 0.9999999999)).not.toThrow();
  });
});

describe('payBandLabel', () => {
  const bands = [
    { min: 0, label: '$' },
    { min: 18, label: '$$' },
    { min: 22, label: '$$$' },
  ];
  it('picks the highest band at or below the rate', () => {
    expect(payBandLabel(15, bands)).toBe('$');
    expect(payBandLabel(18, bands)).toBe('$$');
    expect(payBandLabel(21.99, bands)).toBe('$$');
    expect(payBandLabel(40, bands)).toBe('$$$');
  });
  it('uses the lowest band below all mins, sorts unsorted bands, and returns empty with none', () => {
    expect(payBandLabel(5, [{ min: 10, label: 'A' }, { min: 20, label: 'B' }])).toBe('A');
    expect(payBandLabel(25, [{ min: 20, label: 'B' }, { min: 10, label: 'A' }])).toBe('B');
    expect(payBandLabel(25, [])).toBe('');
  });
});
