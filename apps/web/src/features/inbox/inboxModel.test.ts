import type { Order } from '@branchsuite/shared';
import { describe, expect, it } from 'vitest';
import { order } from '../../test/fixtures.js';
import { orderPrefill, toOrderInput, validateOrder } from './CreateOrderDialog.js';
import {
  ageLabel,
  buildLookups,
  canClaim,
  canRecategorize,
  filterTasks,
  groupByCategory,
  inboxCounts,
  needsRouting,
  resolveView,
  safeWebLink,
  staffingChipLabel,
  staffingState,
  taskAccountText,
} from './inboxModel.js';
import { ACCOUNTS, PEOPLE, task, TODAY } from './testHarness.js';

const lookups = buildLookups(ACCOUNTS, PEOPLE, []);

describe('inboxModel', () => {
  it('groups open tasks into the three category columns and applies in-flight moves', () => {
    const tasks = [
      task({ id: 'a', category: 'client' }),
      task({ id: 'b', category: 'associate' }),
      task({ id: 'c', category: 'operations' }),
      task({ id: 'd', category: 'client', status: 'done', completedAt: '2026-03-02T16:00:00.000Z' }),
    ];
    const groups = groupByCategory(tasks);
    expect(groups.client.map((t) => t.id)).toEqual(['a']);
    expect(groups.associate.map((t) => t.id)).toEqual(['b']);
    expect(groups.operations.map((t) => t.id)).toEqual(['c']);

    const moved = groupByCategory(tasks, new Map([['a', 'operations' as const]]));
    expect(moved.client).toHaveLength(0);
    expect(moved.operations.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('labels age from board date to today', () => {
    expect(ageLabel(TODAY, TODAY)).toBe('today');
    expect(ageLabel('2026-02-28', TODAY)).toBe('2d');
    expect(ageLabel('not-a-date', TODAY)).toBe('');
  });

  it('filters by assignee, effective priority and search, then uses the shared sort', () => {
    const tasks = [
      task({ id: 'mine', assigneeId: 'usr_avery', priority: 'normal', boardDate: '2026-03-01' }),
      task({ id: 'free', assigneeId: null, priority: 'hot', title: 'Badge reprint' }),
      // Low task on a priority account counts as normal.
      task({ id: 'prio', assigneeId: 'usr_blake', priority: 'low', accountId: 'acc_maple' }),
      task({ id: 'low', assigneeId: 'usr_blake', priority: 'low' }),
    ];
    const base = { assignee: 'all' as const, priority: 'all' as const, search: '' };
    expect(filterTasks(tasks, base, 'usr_avery', lookups).map((t) => t.id)).toEqual(['free', 'mine', 'prio', 'low']);
    expect(filterTasks(tasks, { ...base, assignee: 'me' }, 'usr_avery', lookups).map((t) => t.id)).toEqual(['mine']);
    expect(filterTasks(tasks, { ...base, assignee: 'unassigned' }, 'usr_avery', lookups).map((t) => t.id)).toEqual(['free']);
    expect(filterTasks(tasks, { ...base, assignee: { userId: 'usr_blake' } }, 'usr_avery', lookups).map((t) => t.id)).toEqual(['prio', 'low']);
    expect(filterTasks(tasks, { ...base, priority: 'normal' }, 'usr_avery', lookups).map((t) => t.id)).toEqual(['mine', 'prio']);
    expect(filterTasks(tasks, { ...base, search: 'BADGE' }, 'usr_avery', lookups).map((t) => t.id)).toEqual(['free']);
    expect(filterTasks(tasks, { ...base, search: 'maple' }, 'usr_avery', lookups).map((t) => t.id)).toEqual(['prio']);
  });

  it('counts open, hot, unassigned and cleared over the whole view', () => {
    const counts = inboxCounts(
      [
        task({ id: '1', priority: 'hot' }),
        task({ id: '2', assigneeId: 'usr_blake' }),
        task({ id: '3', scope: 'personal', scopeId: 'personal:usr_avery', branchId: null, assigneeId: null }),
        task({ id: '4', status: 'reply_closed' }),
      ],
      lookups.accountsById,
    );
    expect(counts).toEqual({ open: 3, hot: 1, unassigned: 1, cleared: 1 });
  });

  it('describes account, routing and staffing state', () => {
    expect(taskAccountText(task({ accountId: 'acc_lakeside', unitId: 'unit_dock' }), lookups.accountsById)).toBe('Lakeside Foods › Dock B');
    expect(needsRouting(task({ routing: { status: 'ambiguous', candidates: [] } }))).toBe(true);
    expect(needsRouting(task({ accountId: 'acc_maple', routing: { status: 'ambiguous', candidates: [] } }))).toBe(false);

    const orders: Order[] = [order({ id: 'ord_d', status: 'draft' }), order({ id: 'ord_a', status: 'active' })];
    const byId = new Map(orders.map((o) => [o.id, o]));
    expect(staffingState(task({ staffingRequest: null }), byId)).toBeNull();
    const draft = staffingState(task({ orderId: 'ord_d' }), byId)!;
    expect(staffingChipLabel(draft)).toBe('Draft order created');
    expect(staffingChipLabel(staffingState(task({ orderId: 'ord_a' }), byId)!)).toBe('Order on board');
  });

  it('gates actions to open tasks on today’s board', () => {
    expect(canRecategorize(task(), false)).toBe(true);
    expect(canRecategorize(task(), true)).toBe(false);
    expect(canRecategorize(task({ status: 'done' }), false)).toBe(false);
    expect(canClaim(task(), false)).toBe(true);
    expect(canClaim(task({ assigneeId: 'usr_blake' }), false)).toBe(false);
    expect(canClaim(task(), true)).toBe(false);
  });

  it('only offers http(s) mail links and needs the feature for personal views', () => {
    expect(safeWebLink('https://outlook.office.com/mail/x')).toBe('https://outlook.office.com/mail/x');
    expect(safeWebLink('javascript:alert(1)')).toBeNull();
    expect(safeWebLink(null)).toBeNull();
    expect(resolveView('personal', false)).toBe('branch');
    expect(resolveView('combined', true)).toBe('combined');
  });
});

describe('create order form', () => {
  const sr = {
    role: 'Forklift driver',
    roleCategory: 'forklift' as const,
    headcount: 4,
    headcountText: '4',
    shift: '2nd',
    days: 'M-F',
    hours: '2p-10:30p',
    payRate: 19.5,
    startDate: '2026-03-09',
    site: 'Dock B',
    notes: 'Steel-toe boots required.',
    blockedReason: 'Routing was ambiguous',
  };

  it('prefills from the staffing request and the only routing candidate', () => {
    const f = orderPrefill(task({ staffingRequest: sr, routing: { status: 'ambiguous', candidates: [{ accountId: 'acc_lakeside', unitId: 'unit_dock', reason: 'Domain' }] } }));
    expect(f).toMatchObject({ accountId: 'acc_lakeside', unitId: 'unit_dock', role: 'Forklift driver', roleCategory: 'forklift', shift: '2nd', payRate: '19.5', openingCount: '4', note: 'Steel-toe boots required.' });
    expect(toOrderInput(f)).toEqual({
      accountId: 'acc_lakeside',
      unitId: 'unit_dock',
      role: 'Forklift driver',
      roleCategory: 'forklift',
      shift: '2nd',
      days: 'M-F',
      hours: '2p-10:30p',
      payRate: 19.5,
      openingCount: 4,
      note: 'Steel-toe boots required.',
    });
  });

  it('requires an account and an exact opening count', () => {
    const f = orderPrefill(task({ staffingRequest: { ...sr, headcount: null, headcountText: '3-5' } }));
    expect(f.accountId).toBe('');
    const errors = validateOrder(f);
    expect(errors.accountId).toBeTruthy();
    expect(errors.openingCount).toBeTruthy();
    expect(validateOrder({ ...f, accountId: 'acc_maple', openingCount: '3', payRate: '-1' }).payRate).toBeTruthy();
  });
});
