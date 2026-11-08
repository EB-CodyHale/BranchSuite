import type { RealtimeMessage } from '@branchsuite/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { keys } from './queryKeys.js';
import { invalidationsFor, parseRealtimeFrame } from './realtime.js';

const msg = (entities: RealtimeMessage['entities'], scopeId = 'b1'): RealtimeMessage => ({ type: 'invalidate', scopeId, entities, at: '2026-03-02T15:00:00.000Z' });

describe('parseRealtimeFrame', () => {
  it('reads a json.webpubsub.azure.v1 group message', () => {
    const frame = JSON.stringify({ type: 'message', from: 'group', group: 'scope:b1', dataType: 'json', data: msg(['orders']) });
    expect(parseRealtimeFrame(frame)).toEqual(msg(['orders']));
  });

  it('accepts data sent as a JSON string', () => {
    const frame = JSON.stringify({ type: 'message', from: 'server', dataType: 'text', data: JSON.stringify(msg(['tasks'])) });
    expect(parseRealtimeFrame(frame)?.entities).toEqual(['tasks']);
  });

  it('ignores system frames, malformed data and unknown entities', () => {
    expect(parseRealtimeFrame(JSON.stringify({ type: 'system', event: 'connected' }))).toBeNull();
    expect(parseRealtimeFrame('not json')).toBeNull();
    expect(parseRealtimeFrame(JSON.stringify({ type: 'message', data: { type: 'other' } }))).toBeNull();
    const frame = JSON.stringify({ type: 'message', data: { type: 'invalidate', scopeId: 'b1', entities: ['orders', 'secrets'] } });
    expect(parseRealtimeFrame(frame)?.entities).toEqual(['orders']);
  });
});

describe('invalidationsFor', () => {
  function staleAfter(message: RealtimeMessage): string[] {
    const qc = new QueryClient();
    const all = [
      keys.board(['b1', 'b2']),
      keys.board(['b2']),
      keys.accounts('b1'),
      keys.candidates('b1'),
      keys.candidates('b2'),
      keys.tasks('branch', ['b1']),
      keys.wallPreview('b1'),
      keys.wallPreview('b2'),
      keys.closedOrders('b1'),
      keys.me(),
      keys.meMail(),
    ];
    for (const k of all) qc.setQueryData(k, {});
    for (const f of invalidationsFor(message)) void qc.invalidateQueries({ ...f, refetchType: 'none' });
    return qc
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.isInvalidated)
      .map((q) => JSON.stringify(q.queryKey))
      .sort();
  }

  it('orders: boards covering the branch, its order history and its wall', () => {
    expect(staleAfter(msg(['orders']))).toEqual(
      [keys.board(['b1', 'b2']), keys.closedOrders('b1'), keys.wallPreview('b1')].map((k) => JSON.stringify(k)).sort(),
    );
  });

  it('candidates: only that branch pipeline', () => {
    expect(staleAfter(msg(['candidates']))).toEqual([JSON.stringify(keys.candidates('b1'))]);
  });

  it('people: roster, boards and me (but not my mail status)', () => {
    const stale = staleAfter(msg(['people']));
    expect(stale).toContain(JSON.stringify(keys.me()));
    expect(stale).not.toContain(JSON.stringify(keys.meMail()));
  });

  it('whiteboard: that branch whiteboards (every day and list) and its wall preview', () => {
    const qc = new QueryClient();
    const all = [keys.whiteboard('b1', '2026-03-02'), keys.whiteboards('b1', '2026-02-01', '2026-03-31'), keys.whiteboard('b2', '2026-03-02'), keys.wallPreview('b1', 'whiteboard'), keys.board(['b1'])];
    for (const k of all) qc.setQueryData(k, {});
    for (const f of invalidationsFor(msg(['whiteboard']))) void qc.invalidateQueries({ ...f, refetchType: 'none' });
    const stale = qc
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.isInvalidated)
      .map((q) => JSON.stringify(q.queryKey))
      .sort();
    expect(stale).toEqual([keys.wallPreview('b1', 'whiteboard'), keys.whiteboard('b1', '2026-03-02'), keys.whiteboards('b1', '2026-02-01', '2026-03-31')].map((k) => JSON.stringify(k)).sort());
  });

  it('parses the whiteboard entity from a frame', () => {
    expect(parseRealtimeFrame(JSON.stringify({ type: 'message', data: msg(['whiteboard']) }))?.entities).toEqual(['whiteboard']);
  });

  it('personal scope tasks touch tasks only', () => {
    expect(staleAfter(msg(['tasks'], 'personal:usr_1'))).toEqual([JSON.stringify(keys.tasks('branch', ['b1']))]);
  });
});
