import { describe, expect, it } from 'vitest';
import type { AccountLite } from '../api.js';
import { LIMITS } from '../constants.js';
import type { Opening, Order } from '../schemas.js';
import { accountLite, opening, order, person, unit } from './fixtures.test-util.js';
import {
  OrderRuleError,
  addOpenings,
  applyOpeningUpdate,
  boardMetrics,
  effectiveOwnerId,
  isFilledState,
  newOpening,
  openingCounts,
  orderAgeDays,
  orderAgeOn,
  payText,
  removeOpening,
  scheduleText,
  sortOrders,
  startLabel,
} from './orders.js';

const NOW = '2026-03-10T16:00:00.000Z';
const TODAY = '2026-03-10';

function lines(...states: Array<Partial<Opening>>): Opening[] {
  return states.map((s, i) => opening({ id: `opn_${i + 1}`, ...s }));
}

function expectRuleError(fn: () => unknown, code: OrderRuleError['code']): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(OrderRuleError);
    expect((e as OrderRuleError).code).toBe(code);
    return;
  }
  throw new Error('expected OrderRuleError');
}

describe('openingCounts', () => {
  it('counts each state and toFill = open + tentative', () => {
    const o = order({
      openings: lines(
        { state: 'open' },
        { state: 'open' },
        { state: 'tentative', initials: 'AB' },
        { state: 'committed', initials: 'CD' },
        { state: 'started', initials: 'EF' },
      ),
    });
    expect(openingCounts(o)).toEqual({ total: 5, open: 2, tentative: 1, committed: 1, started: 1, toFill: 3, covered: false });
  });
  it('is covered when nothing is left to fill', () => {
    const o = order({ openings: lines({ state: 'committed', initials: 'AB' }, { state: 'started', initials: 'CD' }) });
    expect(openingCounts(o)).toMatchObject({ toFill: 0, covered: true });
  });
});

describe('startLabel', () => {
  it('labels every kind', () => {
    expect(startLabel(opening({ state: 'started', initials: 'AB' }), TODAY)).toEqual({ kind: 'started', label: 'started' });
    expect(startLabel(opening({ state: 'open' }), TODAY)).toEqual({ kind: 'none', label: '' });
    expect(startLabel(opening({ state: 'committed', initials: 'AB', startDate: '2026-03-08' }), TODAY)).toEqual({ kind: 'overdue', label: 'due 3/8' });
    expect(startLabel(opening({ state: 'committed', initials: 'AB', startDate: TODAY }), TODAY)).toEqual({ kind: 'soon', label: 'starts today' });
    expect(startLabel(opening({ state: 'tentative', initials: 'AB', startDate: '2026-03-12' }), TODAY)).toEqual({ kind: 'soon', label: 'starts 3/12' });
    expect(startLabel(opening({ state: 'committed', initials: 'AB', startDate: '2026-03-13' }), TODAY)).toEqual({ kind: 'scheduled', label: 'starts 3/13' });
    expect(startLabel(opening({ state: 'committed', initials: 'AB', startDate: null }), TODAY)).toEqual({ kind: 'nodate', label: 'no date' });
  });
  it('treats a malformed stored date as no date', () => {
    expect(startLabel(opening({ state: 'committed', initials: 'AB', startDate: '2026-02-30' }), TODAY).kind).toBe('nodate');
  });
  it('rolls across a month boundary', () => {
    expect(startLabel(opening({ state: 'committed', initials: 'AB', startDate: '2026-04-01' }), '2026-03-31')).toEqual({ kind: 'soon', label: 'starts 4/1' });
  });
});

describe('sortOrders', () => {
  const accounts = new Map<string, AccountLite>([
    ['acc_a', accountLite({ id: 'acc_a', name: 'alpha Works' })],
    ['acc_b', accountLite({ id: 'acc_b', name: 'Beta Supply' })],
  ]);
  const ids = (os: Order[]): string[] => os.map((o) => o.id);

  it('ranks status first in every sort: active < draft < paused < closed', () => {
    const os = [
      order({ id: 'closed', status: 'closed', createdAt: '2026-01-01T00:00:00Z' }),
      order({ id: 'paused', status: 'paused', createdAt: '2026-01-02T00:00:00Z' }),
      order({ id: 'draft', status: 'draft', createdAt: '2026-01-03T00:00:00Z' }),
      order({ id: 'active', status: 'active', createdAt: '2026-01-04T00:00:00Z' }),
    ];
    for (const sort of ['need', 'start', 'age', 'account'] as const) {
      expect(ids(sortOrders(os, sort, { today: TODAY, accountsById: accounts }))).toEqual(['active', 'draft', 'paused', 'closed']);
    }
  });

  it('need: priority first, then toFill desc, then oldest', () => {
    const os = [
      order({ id: 'two', openings: lines({}, {}), createdAt: '2026-01-02T00:00:00Z' }),
      order({ id: 'three-new', openings: lines({}, {}, {}), createdAt: '2026-01-05T00:00:00Z' }),
      order({ id: 'three-old', openings: lines({}, {}, {}), createdAt: '2026-01-01T00:00:00Z' }),
      order({ id: 'prio-one', isPriority: true, openings: lines({}), createdAt: '2026-01-09T00:00:00Z' }),
    ];
    expect(ids(sortOrders(os, 'need', { today: TODAY, accountsById: accounts }))).toEqual(['prio-one', 'three-old', 'three-new', 'two']);
  });

  it('priority does not lead outside the need sort', () => {
    const os = [
      order({ id: 'prio', isPriority: true, createdAt: '2026-01-09T00:00:00Z' }),
      order({ id: 'old', createdAt: '2026-01-01T00:00:00Z' }),
    ];
    expect(ids(sortOrders(os, 'age', { today: TODAY, accountsById: accounts }))).toEqual(['old', 'prio']);
  });

  it('start: soonest upcoming date first; past dates ignored (PoC bug fix); no date last', () => {
    const os = [
      order({ id: 'none', createdAt: '2026-01-01T00:00:00Z' }),
      // Only a past committed date and a started line: must NOT sort first.
      order({
        id: 'past',
        createdAt: '2026-01-02T00:00:00Z',
        openings: lines({ state: 'committed', initials: 'AB', startDate: '2026-03-01' }, { state: 'started', initials: 'CD', startDate: '2026-02-01' }),
      }),
      order({ id: 'later', createdAt: '2026-01-03T00:00:00Z', openings: lines({ state: 'tentative', initials: 'AB', startDate: '2026-03-20' }) }),
      order({
        id: 'soon',
        createdAt: '2026-01-04T00:00:00Z',
        openings: lines({ state: 'committed', initials: 'AB', startDate: '2026-03-01' }, { state: 'committed', initials: 'CD', startDate: TODAY }),
      }),
    ];
    expect(ids(sortOrders(os, 'start', { today: TODAY, accountsById: accounts }))).toEqual(['soon', 'later', 'none', 'past']);
  });

  it('start: per-branch today map; a missing branch has no upcoming start', () => {
    const os = [
      order({ id: 'other-branch', branchId: 'br_x', createdAt: '2026-01-01T00:00:00Z', openings: lines({ state: 'committed', initials: 'AB', startDate: '2026-03-11' }) }),
      order({ id: 'b1', branchId: 'br_1', createdAt: '2026-01-02T00:00:00Z', openings: lines({ state: 'committed', initials: 'AB', startDate: '2026-03-15' }) }),
    ];
    expect(ids(sortOrders(os, 'start', { today: { br_1: TODAY }, accountsById: accounts }))).toEqual(['b1', 'other-branch']);
  });

  it('age: oldest first', () => {
    const os = [order({ id: 'b', createdAt: '2026-02-01T00:00:00Z' }), order({ id: 'a', createdAt: '2026-01-01T00:00:00Z' })];
    expect(ids(sortOrders(os, 'age', { today: TODAY, accountsById: accounts }))).toEqual(['a', 'b']);
  });

  it('account: case-insensitive name, then shift, then role', () => {
    const os = [
      order({ id: 'b-1st', accountId: 'acc_b', shift: '1st' }),
      order({ id: 'a-2nd', accountId: 'acc_a', shift: '2nd' }),
      order({ id: 'a-1st-pick', accountId: 'acc_a', shift: '1st', role: 'Picker' }),
      order({ id: 'a-1st-fork', accountId: 'acc_a', shift: '1st', role: 'Forklift' }),
    ];
    expect(ids(sortOrders(os, 'account', { today: TODAY, accountsById: accounts }))).toEqual(['a-1st-fork', 'a-1st-pick', 'a-2nd', 'b-1st']);
  });

  it('does not mutate the input', () => {
    const os = [order({ id: 'b', createdAt: '2026-02-01T00:00:00Z' }), order({ id: 'a', createdAt: '2026-01-01T00:00:00Z' })];
    sortOrders(os, 'age', { today: TODAY, accountsById: accounts });
    expect(ids(os)).toEqual(['b', 'a']);
  });
});

describe('boardMetrics', () => {
  it('counts active orders only, with starting-soon and aging', () => {
    const os = [
      order({
        id: 'aging',
        createdAt: '2026-03-03T12:00:00Z', // 7 days before TODAY
        openings: lines(
          { state: 'open' },
          { state: 'tentative', initials: 'AB' },
          { state: 'committed', initials: 'CD', startDate: '2026-03-12' }, // soon
          { state: 'committed', initials: 'EF', startDate: '2026-03-13' }, // not soon
          { state: 'committed', initials: 'GH', startDate: '2026-03-09' }, // past
          { state: 'tentative', initials: 'IJ', startDate: TODAY }, // tentative never counts as starting soon
        ),
      }),
      order({ id: 'young', createdAt: '2026-03-04T12:00:00Z', openings: lines({ state: 'open' }) }),
      order({ id: 'covered-old', createdAt: '2026-01-01T00:00:00Z', openings: lines({ state: 'started', initials: 'AB' }) }),
      order({ id: 'paused', status: 'paused', openings: lines({}, {}) }),
      order({ id: 'draft', status: 'draft', openings: lines({}) }),
      order({ id: 'closed', status: 'closed', openings: lines({}) }),
    ];
    expect(boardMetrics(os, TODAY)).toEqual({ orders: 3, openings: 8, toFill: 4, tentative: 2, startingSoon: 1, aging: 1 });
  });

  it('skips date-based metrics for branches missing from the map', () => {
    const os = [order({ branchId: 'br_x', createdAt: '2026-01-01T00:00:00Z', openings: lines({ state: 'committed', initials: 'AB', startDate: TODAY }, {}) })];
    expect(boardMetrics(os, { br_1: TODAY })).toEqual({ orders: 1, openings: 2, toFill: 1, tentative: 0, startingSoon: 0, aging: 0 });
  });

  it('counts aging in the branch time zone so it agrees with orderAgeOn', () => {
    // 05:30Z on Mar 4 is still Mar 3 in Chicago: 7 branch-local days before Mar 10, but only 6 UTC days.
    const os = [order({ createdAt: '2026-03-04T05:30:00Z', openings: lines({}) })];
    expect(boardMetrics(os, '2026-03-10').aging).toBe(0);
    expect(boardMetrics(os, '2026-03-10', { br_1: 'America/Chicago' }).aging).toBe(1);
    expect(orderAgeOn(os[0]!, 'America/Chicago', '2026-03-10')).toBe(7);
  });
});

describe('orderAgeDays', () => {
  it('uses branch-local days and never goes negative', () => {
    // 05:30Z on Mar 8 is 23:30 CST on Mar 7, so the order is one branch-local day old by mid-morning Mar 8.
    expect(orderAgeDays({ createdAt: '2026-03-08T05:30:00Z' }, 'America/Chicago', new Date('2026-03-08T15:00:00Z'))).toBe(1);
    expect(orderAgeDays({ createdAt: '2026-03-12T00:00:00Z' }, 'America/Chicago', new Date('2026-03-10T15:00:00Z'))).toBe(0);
  });
});

describe('newOpening', () => {
  it('creates a blank line with a unique id', () => {
    const a = newOpening(NOW);
    const b = newOpening(NOW);
    expect(a).toMatchObject({ state: 'open', initials: null, candidateId: null, startDate: null, writtenBy: null, updatedAt: NOW });
    expect(a.id).toMatch(/^opn_[A-Za-z0-9_-]{22}$/);
    expect(a.id).not.toBe(b.id);
  });
});

describe('applyOpeningUpdate', () => {
  const base = order({ openings: lines({ state: 'open' }, { state: 'committed', initials: 'AB', startDate: '2026-03-12', writtenBy: 'usr_x' }) });

  it('fills a blank line and stamps writer and order', () => {
    const next = applyOpeningUpdate(base, 'opn_1', { state: 'committed', initials: 'CD', startDate: '2026-03-15' }, 'usr_2', NOW);
    expect(next.openings[0]).toEqual({ id: 'opn_1', state: 'committed', initials: 'CD', candidateId: null, startDate: '2026-03-15', writtenBy: 'usr_2', updatedAt: NOW });
    expect(next.updatedAt).toBe(NOW);
    expect(next.updatedBy).toBe('usr_2');
    expect(next.openings[1]).toBe(base.openings[1]);
  });

  it('does not mutate the input order', () => {
    const snapshot = JSON.stringify(base);
    applyOpeningUpdate(base, 'opn_1', { state: 'tentative', initials: 'CD' }, 'usr_2', NOW);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('keeps existing initials and start date when not provided; null clears the date', () => {
    const started = applyOpeningUpdate(base, 'opn_2', { state: 'started' }, 'usr_2', NOW);
    expect(started.openings[1]).toMatchObject({ state: 'started', initials: 'AB', startDate: '2026-03-12' });
    const cleared = applyOpeningUpdate(base, 'opn_2', { state: 'committed', startDate: null }, 'usr_2', NOW);
    expect(cleared.openings[1]?.startDate).toBeNull();
  });

  it('requires initials to fill a line', () => {
    expectRuleError(() => applyOpeningUpdate(base, 'opn_1', { state: 'tentative' }, 'usr_2', NOW), 'bad_request');
    expectRuleError(() => applyOpeningUpdate(base, 'opn_1', { state: 'committed', initials: null }, 'usr_2', NOW), 'bad_request');
  });

  it('clearing a line resets initials, date and candidate', () => {
    const next = applyOpeningUpdate(base, 'opn_2', { state: 'open', initials: 'ZZ', startDate: '2026-04-01' }, 'usr_2', NOW);
    expect(next.openings[1]).toMatchObject({ state: 'open', initials: null, startDate: null, candidateId: null, writtenBy: 'usr_2' });
  });

  it('allows paused orders, rejects draft and closed', () => {
    expect(() => applyOpeningUpdate({ ...base, status: 'paused' }, 'opn_1', { state: 'tentative', initials: 'AB' }, 'u', NOW)).not.toThrow();
    expectRuleError(() => applyOpeningUpdate({ ...base, status: 'draft' }, 'opn_1', { state: 'tentative', initials: 'AB' }, 'u', NOW), 'conflict');
    expectRuleError(() => applyOpeningUpdate({ ...base, status: 'closed' }, 'opn_1', { state: 'tentative', initials: 'AB' }, 'u', NOW), 'conflict');
  });

  it('rejects an unknown line', () => {
    expectRuleError(() => applyOpeningUpdate(base, 'opn_nope', { state: 'open' }, 'u', NOW), 'bad_request');
  });

  describe('candidate-held lines', () => {
    const held = order({ openings: lines({ state: 'tentative', initials: 'JF', candidateId: 'cand_1', startDate: '2026-03-20' }) });

    it('cannot be cleared', () => {
      expectRuleError(() => applyOpeningUpdate(held, 'opn_1', { state: 'open' }, 'u', NOW), 'conflict');
    });
    it('cannot change state', () => {
      expectRuleError(() => applyOpeningUpdate(held, 'opn_1', { state: 'committed' }, 'u', NOW), 'conflict');
    });
    it('cannot change initials', () => {
      expectRuleError(() => applyOpeningUpdate(held, 'opn_1', { state: 'tentative', initials: 'XY' }, 'u', NOW), 'conflict');
    });
    it('can change the start date only', () => {
      const next = applyOpeningUpdate(held, 'opn_1', { state: 'tentative', initials: 'JF', startDate: '2026-03-25' }, 'usr_9', NOW);
      expect(next.openings[0]).toMatchObject({ state: 'tentative', initials: 'JF', candidateId: 'cand_1', startDate: '2026-03-25', writtenBy: 'usr_9' });
      const kept = applyOpeningUpdate(held, 'opn_1', { state: 'tentative' }, 'usr_9', NOW);
      expect(kept.openings[0]?.startDate).toBe('2026-03-20');
    });
  });
});

describe('addOpenings / removeOpening', () => {
  it('appends blank lines', () => {
    const next = addOpenings(order(), 3, 'usr_m', NOW);
    expect(next.openings).toHaveLength(4);
    expect(next.openings.slice(1).every((o) => o.state === 'open' && o.updatedAt === NOW)).toBe(true);
    expect(new Set(next.openings.map((o) => o.id)).size).toBe(4);
    expect(next.updatedBy).toBe('usr_m');
  });

  it('enforces the maximum and positive integer counts', () => {
    const full = order({ openings: Array.from({ length: LIMITS.maxOpeningsPerOrder - 1 }, (_, i) => opening({ id: `o${i}` })) });
    expect(addOpenings(full, 1, 'u', NOW).openings).toHaveLength(LIMITS.maxOpeningsPerOrder);
    expectRuleError(() => addOpenings(full, 2, 'u', NOW), 'bad_request');
    expectRuleError(() => addOpenings(order(), 0, 'u', NOW), 'bad_request');
    expectRuleError(() => addOpenings(order(), 1.5, 'u', NOW), 'bad_request');
  });

  const o = order({
    openings: lines(
      { state: 'open' },
      { state: 'tentative', initials: 'AB' },
      { state: 'tentative', initials: 'JF', candidateId: 'cand_1' },
      { state: 'committed', initials: 'CD' },
      { state: 'started', initials: 'EF' },
    ),
  });

  it('removes open lines and penciled lines without a candidate', () => {
    expect(removeOpening(o, 'opn_1', 'u', NOW).openings.map((l) => l.id)).toEqual(['opn_2', 'opn_3', 'opn_4', 'opn_5']);
    expect(removeOpening(o, 'opn_2', 'u', NOW).openings).toHaveLength(4);
  });

  it('refuses candidate-held, committed and started lines', () => {
    expectRuleError(() => removeOpening(o, 'opn_3', 'u', NOW), 'conflict');
    expectRuleError(() => removeOpening(o, 'opn_4', 'u', NOW), 'conflict');
    expectRuleError(() => removeOpening(o, 'opn_5', 'u', NOW), 'conflict');
  });

  it('never removes the last line and rejects unknown lines', () => {
    expectRuleError(() => removeOpening(order(), 'opn_1', 'u', NOW), 'bad_request');
    expectRuleError(() => removeOpening(o, 'missing', 'u', NOW), 'bad_request');
  });
});

describe('effectiveOwnerId', () => {
  const people = new Map([
    ['usr_a', person({ id: 'usr_a' })],
    ['usr_b', person({ id: 'usr_b' })],
    ['usr_inactive', person({ id: 'usr_inactive', active: false })],
    ['usr_elsewhere', person({ id: 'usr_elsewhere', branchIds: ['br_2'] })],
  ]);
  const acct = accountLite({
    ownerId: 'usr_a',
    units: [
      unit({ id: 'root', ownerId: 'usr_b' }),
      unit({ id: 'mid', parentId: 'root', ownerId: null }),
      unit({ id: 'leaf', parentId: 'mid', ownerId: null }),
      unit({ id: 'own', parentId: 'root', ownerId: 'usr_a' }),
    ],
  });

  it('walks up the unit chain to the first owner', () => {
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: 'leaf' }, acct, people)).toBe('usr_b');
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: 'own' }, acct, people)).toBe('usr_a');
  });

  it('falls back to the account owner', () => {
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: null }, acct, people)).toBe('usr_a');
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: 'unknown' }, acct, people)).toBe('usr_a');
  });

  it('survives unit cycles', () => {
    const cyclic = accountLite({ ownerId: 'usr_a', units: [unit({ id: 'x', parentId: 'y' }), unit({ id: 'y', parentId: 'x' })] });
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: 'x' }, cyclic, people)).toBe('usr_a');
  });

  it('stops after maxUnitDepth levels', () => {
    const units = Array.from({ length: LIMITS.maxUnitDepth + 1 }, (_, i) =>
      unit({ id: `u${i}`, parentId: i === 0 ? null : `u${i - 1}`, ownerId: i === 0 ? 'usr_b' : null }),
    );
    const deep = accountLite({ ownerId: 'usr_a', units });
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: `u${LIMITS.maxUnitDepth}` }, deep, people)).toBe('usr_a');
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: `u${LIMITS.maxUnitDepth - 1}` }, deep, people)).toBe('usr_b');
  });

  it('returns null for inactive, non-member, unknown owners and missing accounts', () => {
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: null }, accountLite({ ownerId: 'usr_inactive' }), people)).toBeNull();
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: null }, accountLite({ ownerId: 'usr_elsewhere' }), people)).toBeNull();
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: null }, accountLite({ ownerId: 'usr_ghost' }), people)).toBeNull();
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: null }, accountLite({ ownerId: null }), people)).toBeNull();
    expect(effectiveOwnerId({ branchId: 'br_1', unitId: null }, undefined, people)).toBeNull();
  });
});

describe('formatting helpers', () => {
  it('scheduleText joins non-empty parts', () => {
    expect(scheduleText({ days: 'M-F', hours: '6:00a-2:30p' })).toBe('M-F · 6:00a-2:30p');
    expect(scheduleText({ days: ' ', hours: '6:00a-2:30p' })).toBe('6:00a-2:30p');
    expect(scheduleText({ days: '', hours: '' })).toBe('');
  });
  it('payText formats dollars', () => {
    expect(payText(19.5)).toBe('$19.50/hr');
    expect(payText(null)).toBe('');
    expect(payText(0)).toBe('');
  });
  it('isFilledState', () => {
    expect([isFilledState('open'), isFilledState('tentative'), isFilledState('committed'), isFilledState('started')]).toEqual([false, false, true, true]);
  });
});
