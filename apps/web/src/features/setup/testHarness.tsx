/** Test-only helpers for setup. Fictional data only. */
import type { Account, MeResponse, User } from '@branchsuite/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { BranchScopeProvider } from '../../app/BranchScope.js';
import { MeProvider } from '../../app/MeContext.js';
import { keys } from '../../lib/queryKeys.js';
import { jsonResponse, meResponse, user } from '../../test/fixtures.js';
import { ToastProvider } from '../../ui/Toast.js';
import { SetupBranchProvider } from './SetupBranchContext.js';

const T = '2026-03-02T15:00:00.000Z';

export function rosterUser(id: string, name: string, initials: string, overrides: Partial<User> = {}): User {
  return user({ id, name, initials, email: `${id.replace('usr_', '')}@example.test`, role: 'member', branchIds: ['br_north'], marker: 'blue', ...overrides });
}

export function fullAccount(id: string, name: string, overrides: Partial<Account> = {}): Account {
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
    contacts: [],
    active: true,
    ...overrides,
  };
}

type Handler = (body: unknown, url: string) => Response | Promise<Response>;
export interface Call {
  method: string;
  url: string;
  body: unknown;
}

export function mockApi(me: MeResponse, handlers: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const handler = handlers[`${method} ${url}`];
    if (handler) return handler(body, url);
    if (method === 'GET' && url === '/api/branches') return jsonResponse(me.branches);
    if (method === 'PATCH' && url === '/api/me/preferences') return jsonResponse(me.user);
    return jsonResponse({ error: { code: 'not_found', message: `No mock for ${method} ${url}` } }, 404);
  });
  return calls;
}

export function renderSetup(ui: ReactNode, opts: { me?: MeResponse; handlers?: Record<string, Handler>; path?: string; routePath?: string } = {}) {
  const me = opts.me ?? meResponse();
  const calls = mockApi(me, opts.handlers);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(keys.me(), me);
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[opts.path ?? '/setup']}>
          <MeProvider me={me}>
            <BranchScopeProvider>
              <Routes>
                <Route path={opts.routePath ?? '*'} element={<SetupBranchProvider>{ui}</SetupBranchProvider>} />
              </Routes>
            </BranchScopeProvider>
          </MeProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, calls, client, me };
}

/** A manager of Northfield only, and an admin of both fixture branches. */
export const managerMe = (): MeResponse => {
  const me = meResponse({ user: { role: 'manager', branchIds: ['br_north'] } });
  return { ...me, permissions: { branchIds: ['br_north'], manageBranchIds: ['br_north'], isAdmin: false } };
};
export const adminMe = () => meResponse({ user: { role: 'admin', branchIds: [] } });
