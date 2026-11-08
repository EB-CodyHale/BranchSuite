/** Test-only helpers for the pipeline feature. Fictional data only. */
import type { AccountLite, BoardResponse, Candidate, MeResponse, Opening, Order, PersonLite } from '@branchsuite/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { vi } from 'vitest';
import { BranchScopeProvider } from '../../app/BranchScope.js';
import { MeProvider } from '../../app/MeContext.js';
import { keys } from '../../lib/queryKeys.js';
import { jsonResponse, meResponse, order as baseOrder } from '../../test/fixtures.js';
import { ToastProvider } from '../../ui/Toast.js';
import { PipelinePage } from './PipelinePage.js';

export const T = '2026-03-02T15:00:00.000Z';
export const NOW_TODAY = '2026-03-02';

export function person(id: string, name: string, initials: string, marker: PersonLite['marker'], overrides: Partial<PersonLite> = {}): PersonLite {
  return { id, name, initials, marker, role: 'member', branchIds: ['br_north', 'br_south'], active: true, outDates: [], ...overrides };
}

export const PEOPLE: PersonLite[] = [
  person('usr_avery', 'Avery Quinn', 'AQ', 'teal', { role: 'manager' }),
  person('usr_blake', 'Blake Ortiz', 'BO', 'red'),
];

export function account(id: string, name: string, overrides: Partial<AccountLite> = {}): AccountLite {
  return {
    createdAt: T,
    updatedAt: T,
    createdBy: null,
    updatedBy: null,
    id,
    branchId: 'br_north',
    name,
    accountNumber: null,
    sourceId: null,
    aliases: [],
    domains: [],
    ownerId: null,
    isPriority: false,
    reserved: null,
    wall: { code: 'K7', color: 'w1', glyph: 'diamond' },
    units: [],
    active: true,
    ...overrides,
  };
}

export const ACCOUNTS: AccountLite[] = [
  account('acc_lakeside', 'Lakeside Foods'),
  account('acc_maple', 'Maple Freight', { wall: { code: 'M3', color: 'w2', glyph: 'circle' } }),
  account('acc_orbit', 'Orbit Plastics', { branchId: 'br_south', wall: { code: 'R8', color: 'w4', glyph: 'square' } }),
];

export function line(id: string, overrides: Partial<Opening> = {}): Opening {
  return { id, state: 'open', initials: null, candidateId: null, startDate: null, writtenBy: null, updatedAt: T, ...overrides };
}

export function order(overrides: Partial<Order> = {}): Order {
  return baseOrder(overrides);
}

export function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    createdAt: T,
    updatedAt: T,
    createdBy: 'usr_avery',
    updatedBy: 'usr_avery',
    id: 'cand_jamie',
    branchId: 'br_north',
    firstName: 'Jamie',
    lastName: 'Lowell',
    initials: 'JL',
    phone: '',
    email: '',
    recruiterId: 'usr_avery',
    stage: 'sourced',
    accountId: null,
    orderId: null,
    openingId: null,
    startDate: null,
    notes: '',
    history: [{ stage: 'sourced', at: T, by: 'usr_avery', note: '', dropReason: null }],
    status: 'active',
    ...overrides,
  };
}

export function boardOf(orders: Order[], overrides: Partial<BoardResponse> = {}): BoardResponse {
  return { generatedAt: T, orders, accounts: ACCOUNTS, people: PEOPLE, today: { br_north: NOW_TODAY, br_south: NOW_TODAY }, ...overrides };
}

type Handler = (body: unknown, url: string) => Response | Promise<Response>;

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

export interface PipelineSetup {
  path?: string;
  me?: MeResponse;
  board?: BoardResponse;
  /** Active candidates per branch id. */
  candidates?: Record<string, Candidate[]>;
  archived?: Record<string, Candidate[]>;
  handlers?: Record<string, Handler>;
}

export function renderPipeline(opts: PipelineSetup = {}) {
  const me = opts.me ?? meResponse({ pipeline: true });
  const board = opts.board ?? boardOf([]);
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const handler = opts.handlers?.[`${method} ${url}`];
    if (handler) return handler(body, url);
    if (method === 'GET' && url.startsWith('/api/board')) return jsonResponse(board);
    const list = /^\/api\/branches\/([^/]+)\/candidates\?status=(active|archived)$/.exec(url);
    if (method === 'GET' && list) {
      const source = list[2] === 'archived' ? opts.archived : opts.candidates;
      return jsonResponse(source?.[decodeURIComponent(list[1]!)] ?? []);
    }
    if (method === 'PATCH' && url === '/api/me/preferences') return jsonResponse(me.user);
    return jsonResponse({ error: { code: 'not_found', message: `No mock for ${method} ${url}` } }, 404);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(keys.me(), me);
  const router = createMemoryRouter(
    [
      {
        path: '/pipeline',
        element: (
          <MeProvider me={me}>
            <BranchScopeProvider>
              <PipelinePage />
            </BranchScopeProvider>
          </MeProvider>
        ),
      },
    ],
    { initialEntries: [opts.path ?? '/pipeline'] },
  );
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, calls, client, router, me };
}

/** A CandidateMutationResult response built from the request body. */
export function stageResult(c: Candidate, orders: Order[] = []): Handler {
  return (body) => {
    const input = body as { stage: Candidate['stage']; startDate?: string | null };
    return jsonResponse({ candidate: { ...c, stage: input.stage, startDate: input.startDate ?? c.startDate, updatedAt: '2026-03-02T16:00:00.000Z' }, orders });
  };
}
