/** Test-only helpers for the board feature. Fictional data only. */
import type { AccountLite, BoardResponse, MeResponse, Opening, Order, PersonLite } from '@branchsuite/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { BranchScopeProvider } from '../../app/BranchScope.js';
import { MeProvider } from '../../app/MeContext.js';
import { keys } from '../../lib/queryKeys.js';
import { jsonResponse, meResponse, order as baseOrder } from '../../test/fixtures.js';
import { ToastProvider } from '../../ui/Toast.js';
import { BoardActionsContext, BoardEnvContext, type BoardActions, type BoardEnv } from './BoardContext.js';
import { BoardPage } from './BoardPage.js';

export const T = '2026-03-02T15:00:00.000Z';

export function person(id: string, name: string, initials: string, marker: PersonLite['marker'], overrides: Partial<PersonLite> = {}): PersonLite {
  return { id, name, initials, marker, role: 'member', branchIds: ['br_north', 'br_south'], active: true, outDates: [], ...overrides };
}

export const PEOPLE: PersonLite[] = [
  person('usr_avery', 'Avery Quinn', 'AQ', 'teal', { role: 'manager' }),
  person('usr_blake', 'Blake Ortiz', 'BO', 'red'),
  person('usr_casey', 'Casey Lund', 'CL', 'purple'),
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
  account('acc_lakeside', 'Lakeside Foods', {
    ownerId: 'usr_blake',
    wall: { code: 'K7', color: 'w1', glyph: 'diamond' },
    units: [{ id: 'unit_dock', name: 'Dock B', parentId: null, ownerId: null, aliases: [], active: true }],
  }),
  account('acc_maple', 'Maple Freight', { wall: { code: 'M3', color: 'w2', glyph: 'circle' } }),
  account('acc_orbit', 'Orbit Plastics', { branchId: 'br_south', ownerId: 'usr_casey', wall: { code: 'R8', color: 'w4', glyph: 'square' } }),
];

export function line(id: string, overrides: Partial<Opening> = {}): Opening {
  return { id, state: 'open', initials: null, candidateId: null, startDate: null, writtenBy: null, updatedAt: T, ...overrides };
}

export function order(overrides: Partial<Order> = {}): Order {
  return baseOrder(overrides);
}

export function boardOf(orders: Order[], overrides: Partial<BoardResponse> = {}): BoardResponse {
  return {
    generatedAt: T,
    orders,
    accounts: ACCOUNTS,
    people: PEOPLE,
    today: { br_north: '2026-03-02', br_south: '2026-03-02' },
    ...overrides,
  };
}

type Handler = (init: RequestInit | undefined, url: string) => Response | Promise<Response>;

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** Mock fetch with "METHOD /path" handlers; any board GET returns `board`. */
export function mockApi(board: BoardResponse | (() => Response), handlers: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const handler = handlers[`${method} ${url}`];
    if (handler) return handler(init, url);
    if (method === 'GET' && url.startsWith('/api/board')) return typeof board === 'function' ? board() : jsonResponse(board);
    if (method === 'PATCH' && url === '/api/me/preferences') return jsonResponse({});
    return jsonResponse({ error: { code: 'not_found', message: `No mock for ${method} ${url}` } }, 404);
  });
  return calls;
}

export function renderBoardPage(opts: { me?: MeResponse; board?: BoardResponse | (() => Response); handlers?: Record<string, Handler>; path?: string } = {}) {
  const me = opts.me ?? meResponse();
  const calls = mockApi(opts.board ?? boardOf([]), opts.handlers);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(keys.me(), me);
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[opts.path ?? '/']}>
          <MeProvider me={me}>
            <BranchScopeProvider>
              <BoardPage />
            </BranchScopeProvider>
          </MeProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, calls, client, me };
}

export const noopActions: BoardActions = { open: () => undefined, create: () => undefined, publish: () => undefined, resume: () => undefined };

export function envOf(overrides: Partial<BoardEnv> = {}): BoardEnv {
  return {
    accountsById: new Map(ACCOUNTS.map((a) => [a.id, a])),
    peopleById: new Map(PEOPLE.map((p) => [p.id, p])),
    branchesById: new Map(),
    multiBranch: false,
    canManage: () => true,
    pipelineEnabled: true,
    viewerId: 'usr_avery',
    today: { br_north: '2026-03-02' },
    ...overrides,
  };
}

/** Render a fragment inside the board contexts (no page), for component tests. */
export function renderInBoard(ui: ReactNode, env: Partial<BoardEnv> = {}, me: MeResponse = meResponse()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(keys.me(), me);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <BoardEnvContext.Provider value={envOf(env)}>
              <BoardActionsContext.Provider value={noopActions}>{ui}</BoardActionsContext.Provider>
            </BoardEnvContext.Provider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  };
}
