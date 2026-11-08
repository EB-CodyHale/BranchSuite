import { describe, expect, it } from 'vitest';
import {
  buildLookups,
  DEFAULT_TOOLBAR,
  filterOrders,
  groupByAccount,
  hasStartingSoon,
  isAging,
  loadToolbar,
  nextStartDate,
  orderMatchesSearch,
  ownersByOrder,
  parseToolbar,
  reviewableDrafts,
  saveToolbar,
  unitText,
  type FilterContext,
  type ToolbarState,
} from './boardModel.js';
import { ACCOUNTS, line, order, PEOPLE } from './testHarness.js';

const lookups = buildLookups(ACCOUNTS, PEOPLE);
const today = { br_north: '2026-03-10', br_south: '2026-03-10' };

function ctx(orders: ReturnType<typeof order>[], patch: Partial<ToolbarState> = {}, extra: Partial<FilterContext> = {}): FilterContext {
  return {
    toolbar: { ...DEFAULT_TOOLBAR, ...patch },
    search: '',
    quick: null,
    today,
    lookups,
    owners: ownersByOrder(orders, lookups),
    scopeBranchIds: ['br_north', 'br_south'],
    ...extra,
  };
}

describe('toolbar persistence', () => {
  it('falls back to defaults for missing, corrupt or invalid values', () => {
    expect(parseToolbar(null)).toEqual(DEFAULT_TOOLBAR);
    expect(parseToolbar('{not json')).toEqual(DEFAULT_TOOLBAR);
    expect(parseToolbar(JSON.stringify({ sort: 'bogus', view: 'grid', roleCategory: 'astronaut', hasOpenings: 'yes', branchIds: [1, 'br_north'] }))).toEqual({
      ...DEFAULT_TOOLBAR,
      branchIds: ['br_north'],
    });
  });

  it('round-trips per user', () => {
    const state: ToolbarState = { ...DEFAULT_TOOLBAR, sort: 'age', view: 'list', showPaused: true, owner: 'usr_blake', roleCategory: 'forklift' };
    saveToolbar('usr_a', state);
    expect(loadToolbar('usr_a')).toEqual(state);
    expect(loadToolbar('usr_b')).toEqual(DEFAULT_TOOLBAR);
  });
});

describe('filterOrders', () => {
  const active = order({ id: 'a', accountId: 'acc_lakeside' });
  const paused = order({ id: 'p', status: 'paused', accountId: 'acc_maple' });
  const draft = order({ id: 'd', status: 'draft' });
  const covered = order({ id: 'c', accountId: 'acc_maple', openings: [line('x', { state: 'committed', initials: 'JD' })] });

  it('never shows drafts or closed orders and hides paused unless asked', () => {
    const all = [active, paused, draft, covered, order({ id: 'z', status: 'closed' })];
    expect(filterOrders(all, ctx(all)).map((o) => o.id)).toEqual(['a', 'c']);
    expect(filterOrders(all, ctx(all, { showPaused: true })).map((o) => o.id)).toEqual(['a', 'p', 'c']);
  });

  it('filters by openings, owner (incl. unowned), role category and branch chips', () => {
    const south = order({ id: 's', branchId: 'br_south', accountId: 'acc_orbit', roleCategory: 'clerical' });
    const all = [active, covered, south];
    expect(filterOrders(all, ctx(all, { hasOpenings: true })).map((o) => o.id)).toEqual(['a', 's']);
    expect(filterOrders(all, ctx(all, { owner: 'usr_blake' })).map((o) => o.id)).toEqual(['a']);
    expect(filterOrders(all, ctx(all, { owner: 'unowned' })).map((o) => o.id)).toEqual(['c']);
    expect(filterOrders(all, ctx(all, { roleCategory: 'clerical' })).map((o) => o.id)).toEqual(['s']);
    expect(filterOrders(all, ctx(all, { branchIds: ['br_south'] })).map((o) => o.id)).toEqual(['s']);
    // A stale chip for a branch no longer in scope is ignored.
    expect(filterOrders(all, ctx(all, { branchIds: ['br_gone'] })).map((o) => o.id)).toEqual(['a', 'c', 's']);
  });

  it('applies the metric quick filters with the boardMetrics rules', () => {
    const pencil = order({ id: 'pen', openings: [line('1', { state: 'tentative', initials: 'AB' }), line('2', { state: 'committed', initials: 'CD' })] });
    const soon = order({ id: 'soon', createdAt: '2026-03-09T12:00:00.000Z', openings: [line('1', { state: 'committed', initials: 'EF', startDate: '2026-03-12' })] });
    const old = order({ id: 'old', createdAt: '2026-03-01T12:00:00.000Z' });
    const fresh = order({ id: 'fresh', createdAt: '2026-03-08T12:00:00.000Z' });
    const all = [pencil, soon, old, fresh];
    expect(filterOrders(all, ctx(all, {}, { quick: 'pencils' })).map((o) => o.id)).toEqual(['pen']);
    expect(filterOrders(all, ctx(all, {}, { quick: 'startingSoon' })).map((o) => o.id)).toEqual(['soon']);
    expect(filterOrders(all, ctx(all, {}, { quick: 'toFill' })).map((o) => o.id)).toEqual(['pen', 'old', 'fresh']);
    expect(filterOrders(all, ctx(all, {}, { quick: 'aging' })).map((o) => o.id)).toEqual(['pen', 'old']);
    expect(hasStartingSoon(soon, '2026-03-10')).toBe(true);
    expect(isAging(fresh, '2026-03-10')).toBe(false);
  });

  it('searches account, unit, site, role and wall code', () => {
    const o = order({ accountId: 'acc_lakeside', unitId: 'unit_dock', site: 'North yard', role: 'Picker' });
    const acc = lookups.accountsById.get('acc_lakeside');
    expect(orderMatchesSearch(o, acc, 'lakeside')).toBe(true);
    expect(orderMatchesSearch(o, acc, 'dock b')).toBe(true);
    expect(orderMatchesSearch(o, acc, 'yard')).toBe(true);
    expect(orderMatchesSearch(o, acc, 'PICK')).toBe(true);
    expect(orderMatchesSearch(o, acc, 'k7')).toBe(true);
    expect(orderMatchesSearch(o, acc, 'maple')).toBe(false);
    expect(unitText(acc, 'unit_dock')).toBe('Dock B');
  });
});

describe('grouping, drafts and next start', () => {
  it('groups consecutive runs or by first appearance', () => {
    const list = [order({ id: '1', accountId: 'A' }), order({ id: '2', accountId: 'B' }), order({ id: '3', accountId: 'A' })];
    expect(groupByAccount(list, true).map((g) => g.orders.map((o) => o.id))).toEqual([['1'], ['2'], ['3']]);
    expect(groupByAccount(list, false).map((g) => g.orders.map((o) => o.id))).toEqual([['1', '3'], ['2']]);
  });

  it('lists only drafts in branches the caller manages, oldest first', () => {
    const list = [
      order({ id: 'new', status: 'draft', createdAt: '2026-03-05T00:00:00.000Z' }),
      order({ id: 'old', status: 'draft', createdAt: '2026-03-01T00:00:00.000Z' }),
      order({ id: 'other', status: 'draft', branchId: 'br_south' }),
      order({ id: 'act' }),
    ];
    expect(reviewableDrafts(list, (b) => b === 'br_north').map((o) => o.id)).toEqual(['old', 'new']);
    expect(reviewableDrafts(list, () => false)).toEqual([]);
  });

  it('finds the next upcoming start, ignoring past dates and open lines', () => {
    const o = order({
      openings: [
        line('1', { state: 'committed', initials: 'A', startDate: '2026-03-01' }),
        line('2', { state: 'tentative', initials: 'B', startDate: '2026-03-20' }),
        line('3', { state: 'committed', initials: 'C', startDate: '2026-03-15' }),
      ],
    });
    expect(nextStartDate(o, '2026-03-10')).toBe('2026-03-15');
  });
});
