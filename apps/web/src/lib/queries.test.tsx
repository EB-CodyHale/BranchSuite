import type { BoardResponse, MeResponse, Order } from '@branchsuite/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { board, jsonResponse, meResponse, order } from '../test/fixtures.js';
import { useLinkCandidate, useUpdateOpening } from './queries.js';
import { keys } from './queryKeys.js';

function harness() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData<MeResponse>(keys.me(), meResponse());
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

const lineOf = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryData<BoardResponse>(key)!.orders[0]!.openings[0]!;

describe('useUpdateOpening', () => {
  it('writes the line optimistically, then keeps the server copy', async () => {
    const { qc, wrapper } = harness();
    const key = keys.board(['br_north']);
    qc.setQueryData(key, board([order()]));
    let resolve!: (r: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((r) => (resolve = r)));

    const { result } = renderHook(() => useUpdateOpening(), { wrapper });
    act(() => result.current.mutate({ branchId: 'br_north', orderId: 'ord_1', openingId: 'op_1', input: { state: 'committed', initials: 'JD' } }));

    await waitFor(() => expect(lineOf(qc, key)).toMatchObject({ state: 'committed', initials: 'JD', writtenBy: 'usr_avery' }));

    const server: Order = order({ updatedAt: '2026-03-02T16:00:00.000Z' });
    server.openings[0] = { ...server.openings[0]!, state: 'committed', initials: 'JD', writtenBy: 'usr_avery', updatedAt: '2026-03-02T16:00:00.000Z' };
    resolve(jsonResponse(server));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData<BoardResponse>(key)!.orders[0]!.updatedAt).toBe('2026-03-02T16:00:00.000Z');
  });

  it('rolls back when the server refuses', async () => {
    const { qc, wrapper } = harness();
    const key = keys.board(['br_north']);
    qc.setQueryData(key, board([order()]));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { code: 'conflict', message: 'Changed' } }, 409));

    const { result } = renderHook(() => useUpdateOpening(), { wrapper });
    act(() => result.current.mutate({ branchId: 'br_north', orderId: 'ord_1', openingId: 'op_1', input: { state: 'committed', initials: 'JD' } }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.code).toBe('conflict');
    expect(lineOf(qc, key)).toMatchObject({ state: 'open', initials: null });
  });

  it('undoes only the failed line while another write is still in flight', async () => {
    const { qc, wrapper } = harness();
    const key = keys.board(['br_north']);
    qc.setQueryData(key, board([order()]));
    const pending: Array<(r: Response) => void> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((r) => pending.push(r)));

    const first = renderHook(() => useUpdateOpening(), { wrapper }).result;
    const second = renderHook(() => useUpdateOpening(), { wrapper }).result;
    act(() => first.current.mutate({ branchId: 'br_north', orderId: 'ord_1', openingId: 'op_1', input: { state: 'committed', initials: 'JD' } }));
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => second.current.mutate({ branchId: 'br_north', orderId: 'ord_1', openingId: 'op_2', input: { state: 'committed', initials: 'KL' } }));
    await waitFor(() => expect(pending).toHaveLength(2));

    pending[0]!(jsonResponse({ error: { code: 'conflict', message: 'Changed' } }, 409));
    await waitFor(() => expect(first.current.isError).toBe(true));
    const lines = qc.getQueryData<BoardResponse>(key)!.orders[0]!.openings;
    expect(lines[0]).toMatchObject({ state: 'open', initials: null });
    expect(lines[1]).toMatchObject({ state: 'committed', initials: 'KL' });
  });
});

describe('candidate mutations', () => {
  it('update both the candidate list and the board from the mutation result', async () => {
    const { qc, wrapper } = harness();
    const boardKey = keys.board(['br_north', 'br_south']);
    qc.setQueryData(boardKey, board([order()]));
    const candidate = { id: 'cand_1', branchId: 'br_north', status: 'active', stage: 'sourced', orderId: null, openingId: null };
    qc.setQueryData(keys.candidates('br_north'), [candidate]);

    const linkedOrder = order();
    linkedOrder.openings[0] = { ...linkedOrder.openings[0]!, state: 'tentative', initials: 'TB', candidateId: 'cand_1' };
    const linked = { ...candidate, orderId: 'ord_1', openingId: 'op_1' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ candidate: linked, orders: [linkedOrder] }));

    const { result } = renderHook(() => useLinkCandidate(), { wrapper });
    act(() => result.current.mutate({ branchId: 'br_north', candidateId: 'cand_1', input: { orderId: 'ord_1' } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryData<Array<{ orderId: string | null }>>(keys.candidates('br_north'))![0]!.orderId).toBe('ord_1');
    expect(lineOf(qc, boardKey)).toMatchObject({ state: 'tentative', candidateId: 'cand_1' });
  });
});
