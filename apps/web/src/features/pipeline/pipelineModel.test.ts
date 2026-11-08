import { describe, expect, it } from 'vitest';
import { editForm, emptyForm, formFromCandidate, diffForm, validateForm } from './candidateForm.js';
import { accountNeeds, DEFAULT_FILTERS, fillableOrders, filterCandidates, groupByStage, isStale, openLines, startInfo } from './pipelineModel.js';
import { ACCOUNTS, candidate, line, order } from './testHarness.js';

const accountsById = new Map(ACCOUNTS.map((a) => [a.id, a]));

describe('pipeline model', () => {
  it('filters by recruiter, account, search and archived status', () => {
    const list = [
      candidate({ id: 'a', recruiterId: 'usr_avery', accountId: 'acc_lakeside', phone: '(555) 010-2233' }),
      candidate({ id: 'b', firstName: 'Ivy', lastName: 'Kowal', recruiterId: 'usr_blake', accountId: null }),
      candidate({ id: 'c', firstName: 'Zoë', lastName: 'Park', recruiterId: 'usr_avery', status: 'archived' }),
    ];
    const ids = (f: Partial<typeof DEFAULT_FILTERS>) => filterCandidates(list, { ...DEFAULT_FILTERS, ...f }, 'usr_avery').map((c) => c.id);
    expect(ids({})).toEqual(['a']);
    expect(ids({ recruiter: 'all' })).toEqual(['a', 'b']);
    expect(ids({ recruiter: 'usr_blake' })).toEqual(['b']);
    expect(ids({ recruiter: 'all', account: 'none' })).toEqual(['b']);
    expect(ids({ recruiter: 'all', account: 'acc_lakeside' })).toEqual(['a']);
    expect(ids({ showArchived: true, search: 'zoe' })).toEqual(['c']);
    expect(ids({ search: '010 22' })).toEqual(['a']);
    expect(ids({ recruiter: 'all', search: 'ivy kow' })).toEqual(['b']);
  });

  it('groups by stage, longest in stage first', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const groups = groupByStage(
      [
        candidate({ id: 'new', history: [{ stage: 'sourced', at: '2026-03-09T12:00:00Z', by: 'u', note: '', dropReason: null }] }),
        candidate({ id: 'old', history: [{ stage: 'sourced', at: '2026-03-01T12:00:00Z', by: 'u', note: '', dropReason: null }] }),
        candidate({ id: 'gone', stage: 'dropped' }),
      ],
      now,
    );
    expect(groups.get('sourced')!.map((c) => c.id)).toEqual(['old', 'new']);
    expect(groups.get('dropped')!.map((c) => c.id)).toEqual(['gone']);
    expect(groups.get('started')).toEqual([]);
    expect(isStale(7)).toBe(true);
    expect(isStale(6)).toBe(false);
  });

  it('offers only open, unheld lines on active/paused orders in the branch', () => {
    const o = order({ openings: [line('1'), line('2', { candidateId: 'x', state: 'tentative', initials: 'AB' }), line('3', { state: 'committed', initials: 'CD' }), line('4')] });
    expect(openLines(o).map((l) => [l.line.id, l.index])).toEqual([
      ['1', 0],
      ['4', 3],
    ]);
    const orders = [
      o,
      order({ id: 'closed', status: 'closed' }),
      order({ id: 'draft', status: 'draft' }),
      order({ id: 'paused', status: 'paused' }),
      order({ id: 'south', branchId: 'br_south' }),
      order({ id: 'maple', accountId: 'acc_maple' }),
      order({ id: 'full', openings: [line('f', { state: 'started', initials: 'EF' })] }),
    ];
    expect(fillableOrders(orders, 'br_north', 'acc_lakeside').map((x) => x.id).sort()).toEqual(['ord_1', 'paused']);
    expect(fillableOrders(orders, 'br_north', null).map((x) => x.id).sort()).toEqual(['maple', 'ord_1', 'paused']);
  });

  it('summarizes openings to fill vs candidates in process, biggest gap first', () => {
    const orders = [
      order({ id: 'l1', accountId: 'acc_lakeside', openings: [line('a'), line('b', { state: 'tentative', initials: 'JL', candidateId: 'c1' })] }),
      order({ id: 'l2', accountId: 'acc_lakeside', status: 'paused', openings: [line('c')] }),
      order({ id: 'm1', accountId: 'acc_maple', openings: [line('d')] }),
      order({ id: 'covered', accountId: 'acc_maple', openings: [line('e', { state: 'committed', initials: 'XY' })] }),
      order({ id: 'draft', accountId: 'acc_maple', status: 'draft', openings: [line('f')] }),
    ];
    const cands = [
      candidate({ id: 'c1', accountId: 'acc_lakeside' }),
      candidate({ id: 'c2', accountId: 'acc_maple' }),
      candidate({ id: 'c3', accountId: 'acc_maple' }),
      candidate({ id: 'dropped', accountId: 'acc_lakeside', stage: 'dropped' }),
    ];
    const needs = accountNeeds(orders, cands, accountsById, 'br_north');
    expect(needs.map((n) => [n.account.id, n.toFill, n.inProcess, n.orders])).toEqual([
      ['acc_lakeside', 3, 1, 2],
      ['acc_maple', 1, 2, 1],
    ]);
  });

  it('labels start dates relative to the branch day', () => {
    expect(startInfo(null, '2026-03-02')).toBeNull();
    expect(startInfo('2026-03-02', '2026-03-02')).toEqual({ label: 'Starts today', tone: 'soon' });
    expect(startInfo('2026-03-04', '2026-03-02')).toEqual({ label: 'Starts 3/4', tone: 'soon' });
    expect(startInfo('2026-03-20', '2026-03-02')).toEqual({ label: 'Starts 3/20', tone: 'later' });
    expect(startInfo('2026-02-27', '2026-03-02')).toEqual({ label: 'Start 2/27', tone: 'past' });
  });
});

describe('candidate form', () => {
  it('auto-derives initials from the name until edited', () => {
    let f = emptyForm('usr_avery');
    f = editForm(f, { firstName: 'jamie' });
    expect(f.initials).toBe('J');
    f = editForm(f, { lastName: 'Ørsted' });
    expect(f.initials).toBe('JO');
    f = editForm(f, { initials: 'j-q1' });
    expect(f).toMatchObject({ initials: 'JQ', initialsEdited: true });
    f = editForm(f, { firstName: 'Alex' });
    expect(f.initials).toBe('JQ');
    f = editForm(f, { initialsEdited: false });
    expect(f.initials).toBe('AO');
  });

  it('treats hand-made initials on an existing candidate as edited', () => {
    expect(formFromCandidate(candidate({ initials: 'JL' })).initialsEdited).toBe(false);
    expect(formFromCandidate(candidate({ initials: 'JAL' })).initialsEdited).toBe(true);
  });

  it('validates with the shared schema and diffs only changed fields', () => {
    const c = candidate();
    const f = editForm(formFromCandidate(c), { email: 'not-an-email', firstName: ' ' });
    expect(Object.keys(validateForm(f, 'update')).sort()).toEqual(['email', 'firstName']);
    const ok = editForm(formFromCandidate(c), { phone: '555-0100', accountId: 'acc_maple', startDate: '2026-03-09' });
    expect(validateForm(ok, 'update')).toEqual({});
    expect(diffForm(c, ok)).toEqual({ phone: '555-0100', accountId: 'acc_maple', startDate: '2026-03-09' });
  });
});
