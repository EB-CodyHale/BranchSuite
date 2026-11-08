import { describe, expect, it } from 'vitest';
import { PIPELINE_STAGE_IDS } from '../constants.js';
import type { Candidate, Order } from '../schemas.js';
import { candidate, opening, order } from './fixtures.test-util.js';
import {
  PipelineRuleError,
  applyStage,
  daysInStage,
  deriveInitials,
  linkCandidate,
  openingStateForStage,
  unlinkCandidate,
} from './pipeline.js';

const NOW = '2026-03-10T16:00:00.000Z';
const ACTOR = 'usr_rec';

function expectPipelineError(fn: () => unknown, code: PipelineRuleError['code']): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PipelineRuleError);
    expect((e as PipelineRuleError).code).toBe(code);
    return;
  }
  throw new Error('expected PipelineRuleError');
}

/** Order with one line held by cand_1 (at `state`) plus two blank lines. */
function heldOrder(state: 'tentative' | 'committed' | 'started' = 'tentative', over: Partial<Order> = {}): Order {
  return order({
    openings: [
      opening({ id: 'opn_held', state, initials: 'JF', candidateId: 'cand_1', startDate: '2026-03-20', writtenBy: 'usr_x' }),
      opening({ id: 'opn_2' }),
      opening({ id: 'opn_3' }),
    ],
    ...over,
  });
}
const linked = (over: Partial<Candidate> = {}): Candidate =>
  candidate({ orderId: 'ord_1', openingId: 'opn_held', accountId: 'acc_1', startDate: '2026-03-20', ...over });

describe('openingStateForStage', () => {
  it('maps every stage', () => {
    expect(Object.fromEntries(PIPELINE_STAGE_IDS.map((s) => [s, openingStateForStage(s)]))).toEqual({
      sourced: 'tentative',
      screened: 'tentative',
      submitted: 'tentative',
      interviewing: 'tentative',
      accepted: 'committed',
      onboarding: 'committed',
      started: 'started',
      dropped: null,
    });
  });
  it('throws for an unknown stage', () => {
    expect(() => openingStateForStage('hired' as never)).toThrow(RangeError);
  });
});

describe('deriveInitials', () => {
  it('uses first letters of first and last name', () => {
    expect(deriveInitials('jordan', 'fictional')).toBe('JF');
    expect(deriveInitials('Élodie', 'Østby')).toBe('EO');
    expect(deriveInitials('  ', "O'Neill")).toBe('O');
    expect(deriveInitials('Sam', '')).toBe('S');
    expect(deriveInitials('123', '李')).toBe('X');
    expect(deriveInitials('李 Ana', 'Lee')).toBe('L');
    expect(deriveInitials('ßam', 'łukasz')).toBe('SL');
    expect(deriveInitials('', '')).toBe('X');
  });
});

describe('applyStage', () => {
  it('moves an unlinked candidate and appends history', () => {
    const { candidate: next, orders } = applyStage(candidate(), { stage: 'screened', note: 'Phone screen ok' }, null, ACTOR, NOW);
    expect(orders).toEqual([]);
    expect(next.stage).toBe('screened');
    expect(next.history).toHaveLength(2);
    expect(next.history[1]).toEqual({ stage: 'screened', at: NOW, by: ACTOR, note: 'Phone screen ok', dropReason: null });
    expect(next.updatedAt).toBe(NOW);
    expect(next.updatedBy).toBe(ACTOR);
  });

  it('updates the candidate start date only when provided', () => {
    const c = candidate({ startDate: '2026-03-15' });
    expect(applyStage(c, { stage: 'screened' }, null, ACTOR, NOW).candidate.startDate).toBe('2026-03-15');
    expect(applyStage(c, { stage: 'screened', startDate: '2026-03-18' }, null, ACTOR, NOW).candidate.startDate).toBe('2026-03-18');
    expect(applyStage(c, { stage: 'screened', startDate: null }, null, ACTOR, NOW).candidate.startDate).toBeNull();
  });

  it.each([
    ['screened', 'tentative'],
    ['accepted', 'committed'],
    ['onboarding', 'committed'],
    ['started', 'started'],
  ] as const)('a linked line follows stage %s -> %s', (stage, state) => {
    const o = heldOrder();
    const { candidate: next, orders } = applyStage(linked(), { stage, startDate: '2026-03-22' }, o, ACTOR, NOW);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.openings[0]).toEqual({
      id: 'opn_held',
      state,
      initials: 'JF',
      candidateId: 'cand_1',
      startDate: '2026-03-22',
      writtenBy: ACTOR,
      updatedAt: NOW,
    });
    expect(orders[0]!.updatedBy).toBe(ACTOR);
    expect(next.orderId).toBe('ord_1');
    expect(o.openings[0]!.state).toBe('tentative'); // input untouched
  });

  it('keeps the candidate start date on the line when none is given', () => {
    const { orders } = applyStage(linked(), { stage: 'accepted' }, heldOrder(), ACTOR, NOW);
    expect(orders[0]!.openings[0]!.startDate).toBe('2026-03-20');
  });

  it('dropping requires a reason', () => {
    expectPipelineError(() => applyStage(linked(), { stage: 'dropped' }, heldOrder(), ACTOR, NOW), 'bad_request');
  });

  it('dropping releases the line and unlinks the candidate', () => {
    const { candidate: next, orders } = applyStage(linked(), { stage: 'dropped', dropReason: 'no_show' }, heldOrder('committed'), ACTOR, NOW);
    expect(next).toMatchObject({ stage: 'dropped', orderId: null, openingId: null, accountId: 'acc_1' });
    expect(next.history.at(-1)).toMatchObject({ stage: 'dropped', dropReason: 'no_show' });
    expect(orders[0]!.openings[0]).toMatchObject({ state: 'open', initials: null, candidateId: null, startDate: null, writtenBy: ACTOR });
  });

  it('dropping an unlinked candidate changes no order', () => {
    const { candidate: next, orders } = applyStage(candidate(), { stage: 'dropped', dropReason: 'unreachable' }, null, ACTOR, NOW);
    expect(next.stage).toBe('dropped');
    expect(orders).toEqual([]);
  });

  it('dropping with a stale link unlinks without touching another person\'s line', () => {
    const o = heldOrder('tentative');
    o.openings[0] = { ...o.openings[0]!, candidateId: 'cand_other' };
    const { candidate: next, orders } = applyStage(linked(), { stage: 'dropped', dropReason: 'other' }, o, ACTOR, NOW);
    expect(next.orderId).toBeNull();
    expect(orders).toEqual([]);
  });

  it('a non-drop move with a stale link is a conflict', () => {
    const o = heldOrder();
    o.openings[0] = { ...o.openings[0]!, candidateId: null, state: 'open' };
    expectPipelineError(() => applyStage(linked(), { stage: 'accepted' }, o, ACTOR, NOW), 'conflict');
  });

  it('re-engaging from dropped is allowed and does not relink', () => {
    const c = candidate({ stage: 'dropped' });
    const { candidate: next, orders } = applyStage(c, { stage: 'screened' }, null, ACTOR, NOW);
    expect(next.stage).toBe('screened');
    expect(next.orderId).toBeNull();
    expect(orders).toEqual([]);
  });

  it('rejects archived candidates', () => {
    expectPipelineError(() => applyStage(candidate({ status: 'archived' }), { stage: 'screened' }, null, ACTOR, NOW), 'conflict');
  });

  it('requires the linked order when linked', () => {
    expectPipelineError(() => applyStage(linked(), { stage: 'screened' }, null, ACTOR, NOW), 'bad_request');
    expectPipelineError(() => applyStage(linked(), { stage: 'screened' }, heldOrder('tentative', { id: 'ord_other' }), ACTOR, NOW), 'bad_request');
  });

  it('caps history at 200 events, keeping the newest', () => {
    const history = Array.from({ length: 200 }, (_, i) => ({ stage: 'sourced' as const, at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`, by: 'u', note: `n${i}`, dropReason: null }));
    const next = applyStage(candidate({ history }), { stage: 'screened' }, null, ACTOR, NOW).candidate;
    expect(next.history).toHaveLength(200);
    expect(next.history[0]!.note).toBe('n1');
    expect(next.history.at(-1)!.stage).toBe('screened');
  });
});

describe('linkCandidate', () => {
  const blank = (): Order => order({ openings: [opening({ id: 'opn_a', state: 'committed', initials: 'AB' }), opening({ id: 'opn_b' }), opening({ id: 'opn_c' })] });

  it('fills the first open line when no line is given', () => {
    const c = candidate({ stage: 'interviewing', startDate: '2026-03-25' });
    const { candidate: next, orders } = linkCandidate(c, blank(), undefined, null, ACTOR, NOW);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.openings[1]).toEqual({
      id: 'opn_b',
      state: 'tentative',
      initials: 'JF',
      candidateId: 'cand_1',
      startDate: '2026-03-25',
      writtenBy: ACTOR,
      updatedAt: NOW,
    });
    expect(next).toMatchObject({ orderId: 'ord_1', openingId: 'opn_b', accountId: 'acc_1', updatedAt: NOW });
  });

  it('uses the stage to choose the line state', () => {
    const { orders } = linkCandidate(candidate({ stage: 'accepted' }), blank(), 'opn_c', null, ACTOR, NOW);
    expect(orders[0]!.openings[2]!.state).toBe('committed');
  });

  it('rejects a taken line, an unknown line, and a full order', () => {
    expectPipelineError(() => linkCandidate(candidate(), blank(), 'opn_a', null, ACTOR, NOW), 'conflict');
    expectPipelineError(() => linkCandidate(candidate(), blank(), 'opn_zz', null, ACTOR, NOW), 'bad_request');
    const full = order({ openings: [opening({ state: 'committed', initials: 'AB' })] });
    expectPipelineError(() => linkCandidate(candidate(), full, undefined, null, ACTOR, NOW), 'conflict');
  });

  it('rejects dropped or archived candidates and draft or closed orders', () => {
    expectPipelineError(() => linkCandidate(candidate({ stage: 'dropped' }), blank(), undefined, null, ACTOR, NOW), 'conflict');
    expectPipelineError(() => linkCandidate(candidate({ status: 'archived' }), blank(), undefined, null, ACTOR, NOW), 'conflict');
    expectPipelineError(() => linkCandidate(candidate(), { ...blank(), status: 'draft' }, undefined, null, ACTOR, NOW), 'conflict');
    expectPipelineError(() => linkCandidate(candidate(), { ...blank(), status: 'closed' }, undefined, null, ACTOR, NOW), 'conflict');
    expect(() => linkCandidate(candidate(), { ...blank(), status: 'paused' }, undefined, null, ACTOR, NOW)).not.toThrow();
  });

  it('rejects an order in another branch', () => {
    expectPipelineError(() => linkCandidate(candidate(), { ...blank(), branchId: 'br_2' }, undefined, null, ACTOR, NOW), 'bad_request');
  });

  it('relinking to another order releases the previous line', () => {
    const prev = heldOrder('tentative', { id: 'ord_prev', accountId: 'acc_prev' });
    const target = order({ id: 'ord_new', accountId: 'acc_new', openings: [opening({ id: 'opn_n1' })] });
    const c = linked({ orderId: 'ord_prev', accountId: 'acc_prev' });
    const { candidate: next, orders } = linkCandidate(c, target, undefined, prev, ACTOR, NOW);
    expect(orders.map((o) => o.id)).toEqual(['ord_new', 'ord_prev']);
    expect(orders[0]!.openings[0]).toMatchObject({ candidateId: 'cand_1', state: 'tentative' });
    expect(orders[1]!.openings[0]).toMatchObject({ state: 'open', candidateId: null, initials: null, startDate: null });
    expect(next).toMatchObject({ orderId: 'ord_new', openingId: 'opn_n1', accountId: 'acc_new' });
  });

  it('relinking within the same order applies both changes to one copy', () => {
    const o = heldOrder('committed');
    const { candidate: next, orders } = linkCandidate(linked({ stage: 'accepted' }), o, 'opn_3', o, ACTOR, NOW);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.openings.map((l) => [l.id, l.state, l.candidateId])).toEqual([
      ['opn_held', 'open', null],
      ['opn_2', 'open', null],
      ['opn_3', 'committed', 'cand_1'],
    ]);
    expect(next.openingId).toBe('opn_3');
  });

  it('linking to the line already held changes nothing', () => {
    const o = heldOrder();
    const c = linked();
    expect(linkCandidate(c, o, 'opn_held', o, ACTOR, NOW)).toEqual({ candidate: c, orders: [] });
    expect(linkCandidate(c, o, undefined, o, ACTOR, NOW)).toEqual({ candidate: c, orders: [] });
  });

  it('requires the previous order when already linked elsewhere', () => {
    const target = order({ id: 'ord_new', openings: [opening()] });
    expectPipelineError(() => linkCandidate(linked(), target, undefined, null, ACTOR, NOW), 'bad_request');
    expectPipelineError(() => linkCandidate(linked(), target, undefined, order({ id: 'ord_wrong' }), ACTOR, NOW), 'bad_request');
  });

  it('a stale previous link does not clear another person\'s line', () => {
    const prev = heldOrder('tentative', { id: 'ord_prev' });
    prev.openings[0] = { ...prev.openings[0]!, candidateId: 'cand_other' };
    const target = order({ id: 'ord_new', openings: [opening()] });
    const { orders } = linkCandidate(linked({ orderId: 'ord_prev' }), target, undefined, prev, ACTOR, NOW);
    expect(orders.map((o) => o.id)).toEqual(['ord_new']);
  });
});

describe('unlinkCandidate', () => {
  it('releases the line and keeps the account', () => {
    const { candidate: next, orders } = unlinkCandidate(linked(), heldOrder('committed'), ACTOR, NOW);
    expect(next).toMatchObject({ orderId: null, openingId: null, accountId: 'acc_1', updatedBy: ACTOR });
    expect(orders[0]!.openings[0]).toMatchObject({ state: 'open', candidateId: null, initials: null, startDate: null });
  });

  it('is a no-op for an unlinked candidate', () => {
    const c = candidate();
    expect(unlinkCandidate(c, null, ACTOR, NOW)).toEqual({ candidate: c, orders: [] });
  });

  it('clears the link when the order no longer exists', () => {
    const { candidate: next, orders } = unlinkCandidate(linked(), null, ACTOR, NOW);
    expect(next.orderId).toBeNull();
    expect(orders).toEqual([]);
  });

  it('rejects the wrong order', () => {
    expectPipelineError(() => unlinkCandidate(linked(), order({ id: 'ord_other' }), ACTOR, NOW), 'bad_request');
  });
});

describe('daysInStage', () => {
  it('counts whole days since the latest history event', () => {
    const c = candidate({
      history: [
        { stage: 'sourced', at: '2026-03-01T10:00:00Z', by: 'u', note: '', dropReason: null },
        { stage: 'screened', at: '2026-03-05T10:00:00Z', by: 'u', note: '', dropReason: null },
      ],
    });
    expect(daysInStage(c, new Date('2026-03-08T09:59:00Z'))).toBe(2);
    expect(daysInStage(c, new Date('2026-03-08T10:00:00Z'))).toBe(3);
  });
  it('falls back to createdAt and never goes negative', () => {
    expect(daysInStage({ history: [], createdAt: '2026-03-01T00:00:00Z' }, new Date('2026-03-04T00:00:00Z'))).toBe(3);
    expect(daysInStage({ history: [], createdAt: '2026-03-05T00:00:00Z' }, new Date('2026-03-04T00:00:00Z'))).toBe(0);
  });
});
