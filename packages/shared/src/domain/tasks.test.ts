import { describe, expect, it } from 'vitest';
import type { Account } from '../schemas.js';
import { task } from './fixtures.test-util.js';
import { effectivePriority, inferCategory, isVisibleOn, maxPriority, sortTasks } from './tasks.js';

const CHI = 'America/Chicago';
const TODAY = '2026-03-10';

describe('inferCategory', () => {
  it.each([
    'Timecard missing for last week',
    'Time sheets due Friday',
    'Payroll correction',
    'Paycheck question',
    'Associate called off today',
    'Two call-offs on 2nd shift',
    'No call no show',
    'NCNS on Tuesday',
    'Attendance points',
    'Employee badge not working',
    'Worker injury report',
    'Injured on the line',
    'Orientation tomorrow at 8',
  ])('associate: %s', (text) => {
    expect(inferCategory(text)).toBe('associate');
  });

  it.each(['New order for 5 pickers', 'Staffing request', 'We need coverage', 'Headcount for Monday', 'Invoice question', 'Rate increase', 'Quote please', 'Start date confirm', 'Shift change'])(
    'client: %s',
    (text) => {
      expect(inferCategory(text)).toBe('client');
    },
  );

  it('associate keywords win over client keywords', () => {
    expect(inferCategory('Need a replacement after the call off on 1st shift')).toBe('associate');
  });

  it('falls back to operations and matches whole words only', () => {
    expect(inferCategory('Office printer is jammed')).toBe('operations');
    expect(inferCategory('')).toBe('operations');
    expect(inferCategory('Disorder in the breakroom')).toBe('operations');
    expect(inferCategory('Restarted the server')).toBe('operations');
  });
});

describe('effectivePriority / maxPriority', () => {
  const accounts = new Map<string, Pick<Account, 'isPriority'>>([
    ['acc_vip', { isPriority: true }],
    ['acc_std', { isPriority: false }],
  ]);
  it('raises low to normal for priority accounts only', () => {
    expect(effectivePriority({ priority: 'low', accountId: 'acc_vip' }, accounts)).toBe('normal');
    expect(effectivePriority({ priority: 'normal', accountId: 'acc_vip' }, accounts)).toBe('normal');
    expect(effectivePriority({ priority: 'hot', accountId: 'acc_vip' }, accounts)).toBe('hot');
    expect(effectivePriority({ priority: 'low', accountId: 'acc_std' }, accounts)).toBe('low');
    expect(effectivePriority({ priority: 'low', accountId: 'acc_unknown' }, accounts)).toBe('low');
    expect(effectivePriority({ priority: 'low', accountId: null }, accounts)).toBe('low');
  });
  it('maxPriority picks the higher one', () => {
    expect(maxPriority('low', 'hot')).toBe('hot');
    expect(maxPriority('normal', 'low')).toBe('normal');
    expect(maxPriority('hot', 'normal')).toBe('hot');
    expect(maxPriority('low', 'low')).toBe('low');
  });
});

describe('isVisibleOn', () => {
  // 04:30Z on Mar 11 is 23:30 CDT on Mar 10.
  const doneToday = { status: 'done' as const, completedAt: '2026-03-11T04:30:00Z' };
  const doneYesterday = { status: 'done' as const, completedAt: '2026-03-09T20:00:00Z' };

  describe('viewing today', () => {
    it('shows open tasks dated today and carried open tasks from earlier days', () => {
      expect(isVisibleOn(task({ boardDate: TODAY }), TODAY, TODAY, CHI)).toBe(true);
      expect(isVisibleOn(task({ boardDate: '2026-02-20' }), TODAY, TODAY, CHI)).toBe(true);
    });
    it('shows tasks completed today in the branch time zone', () => {
      expect(isVisibleOn(task({ boardDate: '2026-03-01', ...doneToday }), TODAY, TODAY, CHI)).toBe(true);
      expect(isVisibleOn(task({ boardDate: '2026-03-01', ...doneToday }), TODAY, TODAY, 'UTC')).toBe(false);
    });
    it('uses closedByReply.at for reply-closed tasks without completedAt', () => {
      const t = task({ boardDate: '2026-03-01', status: 'reply_closed', closedByReply: { at: '2026-03-10T15:00:00Z', fromAddress: 'a@b.co', excerpt: '', reason: '' } });
      expect(isVisibleOn(t, TODAY, TODAY, CHI)).toBe(true);
    });
    it('hides tasks completed on earlier days', () => {
      expect(isVisibleOn(task({ boardDate: '2026-03-09', ...doneYesterday }), TODAY, TODAY, CHI)).toBe(false);
    });
    it('never carries future or malformed board dates', () => {
      expect(isVisibleOn(task({ boardDate: '2026-03-11' }), TODAY, TODAY, CHI)).toBe(false);
      expect(isVisibleOn(task({ boardDate: '2026-02-30' }), TODAY, TODAY, CHI)).toBe(false);
      expect(isVisibleOn(task({ boardDate: 'yesterday' }), TODAY, TODAY, CHI)).toBe(false);
    });
  });

  describe('viewing a past date', () => {
    const PAST = '2026-03-09';
    it('shows tasks dated that day regardless of status', () => {
      expect(isVisibleOn(task({ boardDate: PAST }), PAST, TODAY, CHI)).toBe(true);
      expect(isVisibleOn(task({ boardDate: PAST, status: 'done', completedAt: '2026-03-10T15:00:00Z' }), PAST, TODAY, CHI)).toBe(true);
    });
    it('shows tasks completed that day', () => {
      expect(isVisibleOn(task({ boardDate: '2026-03-01', ...doneYesterday }), PAST, TODAY, CHI)).toBe(true);
    });
    it('does not invent carryover into history', () => {
      expect(isVisibleOn(task({ boardDate: '2026-03-01' }), PAST, TODAY, CHI)).toBe(false);
    });
  });

  it('treats a reopened task as having no completion day', () => {
    expect(isVisibleOn(task({ boardDate: '2026-03-01', status: 'open', completedAt: '2026-03-09T20:00:00Z' }), '2026-03-09', TODAY, CHI)).toBe(false);
  });
});

describe('sortTasks', () => {
  const accounts = new Map<string, Pick<Account, 'isPriority'>>([['acc_vip', { isPriority: true }]]);
  it('orders open first, then priority, then board date, then createdAt', () => {
    const tasks = [
      task({ id: 'done-hot', status: 'done', priority: 'hot', completedAt: '2026-03-10T12:00:00Z' }),
      task({ id: 'low', priority: 'low' }),
      // Effectively normal (priority account): sorts with normals, ahead of 'low' despite a later createdAt.
      task({ id: 'vip-low', priority: 'low', accountId: 'acc_vip', boardDate: '2026-03-10', createdAt: '2026-03-10T10:00:00Z' }),
      task({ id: 'normal-new', priority: 'normal', boardDate: '2026-03-10', createdAt: '2026-03-10T09:00:00Z' }),
      task({ id: 'normal-old-day', priority: 'normal', boardDate: '2026-03-08' }),
      task({ id: 'normal-early', priority: 'normal', boardDate: '2026-03-10', createdAt: '2026-03-10T08:00:00Z' }),
      task({ id: 'hot', priority: 'hot' }),
    ];
    expect(sortTasks(tasks, accounts).map((t) => t.id)).toEqual(['hot', 'normal-old-day', 'normal-early', 'normal-new', 'vip-low', 'low', 'done-hot']);
    expect(tasks[0]!.id).toBe('done-hot'); // input untouched
  });
});
