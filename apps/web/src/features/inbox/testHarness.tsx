/** Test-only helpers for the inbox. Fictional data only. */
import type { AccountLite, BoardResponse, MeResponse, PersonalMailStatus, PersonLite, Task, TasksResponse } from '@branchsuite/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { BranchScopeProvider } from '../../app/BranchScope.js';
import { MeProvider } from '../../app/MeContext.js';
import { keys } from '../../lib/queryKeys.js';
import { branch, jsonResponse, meResponse } from '../../test/fixtures.js';
import { ToastProvider } from '../../ui/Toast.js';
import { InboxPage } from './InboxPage.js';

export const T = '2026-03-02T15:00:00.000Z';
export const TODAY = '2026-03-02';

export function person(id: string, name: string, initials: string, marker: PersonLite['marker'], overrides: Partial<PersonLite> = {}): PersonLite {
  return { id, name, initials, marker, role: 'member', branchIds: ['br_north'], active: true, outDates: [], ...overrides };
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
  account('acc_lakeside', 'Lakeside Foods', { units: [{ id: 'unit_dock', name: 'Dock B', parentId: null, ownerId: null, aliases: [], active: true }] }),
  account('acc_maple', 'Maple Freight', { isPriority: true, wall: { code: 'M3', color: 'w2', glyph: 'circle' } }),
];

export function task(overrides: Partial<Task> = {}): Task {
  return {
    createdAt: T,
    updatedAt: T,
    createdBy: null,
    updatedBy: null,
    id: 'task_1',
    scopeId: 'br_north',
    scope: 'branch',
    branchId: 'br_north',
    ownerUserId: null,
    boardDate: TODAY,
    title: 'Need two forklift drivers Monday',
    summary: 'Client asks for two drivers on second shift.',
    category: 'client',
    categorySource: 'auto',
    priority: 'normal',
    status: 'open',
    assigneeId: null,
    accountId: null,
    unitId: null,
    routing: { status: 'matched', candidates: [] },
    email: {
      mailboxId: 'mbx_north',
      conversationId: 'conv_1',
      fromAddress: 'pat@lakeside.example.com',
      fromName: 'Pat Rivers',
      subject: 'Drivers for Monday',
      receivedAt: T,
      webLink: 'https://outlook.office.com/mail/id/abc',
      messageCount: 2,
      lastMessageAt: T,
    },
    deadline: null,
    staffingRequest: null,
    orderId: null,
    completedAt: null,
    completedBy: null,
    closedByReply: null,
    ...overrides,
  };
}

export function tasksOf(tasks: Task[], overrides: Partial<TasksResponse> = {}): TasksResponse {
  return { generatedAt: T, tasks, date: TODAY, isToday: true, ...overrides };
}

export function boardData(overrides: Partial<BoardResponse> = {}): BoardResponse {
  return { generatedAt: T, orders: [], accounts: ACCOUNTS, people: PEOPLE, today: { br_north: TODAY, br_south: TODAY }, ...overrides };
}

export const singleBranchMe = (role: 'manager' | 'member' = 'manager', personalMail = false, inboxView: 'branch' | 'personal' | 'combined' = 'branch'): MeResponse => {
  const me = meResponse({ user: { role, branchIds: ['br_north'], preferences: { theme: 'daylight', branchScope: 'all', inboxView } }, branches: [branch('br_north', 'Northfield')] });
  return { ...me, features: { ...me.features, personalMail } };
};

export function mailStatus(overrides: Partial<PersonalMailStatus> = {}): PersonalMailStatus {
  return { connected: false, address: null, status: 'not_connected', lastSyncAt: null, lastError: null, help: null, ...overrides };
}

type Handler = (init: RequestInit | undefined, url: string) => Response | Promise<Response>;

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

export interface InboxMockOptions {
  /** Response for GET /api/tasks; a function receives the URL (to answer per date/view). */
  tasks?: TasksResponse | ((url: string) => TasksResponse);
  board?: BoardResponse;
  mail?: PersonalMailStatus;
  handlers?: Record<string, Handler>;
}

export function mockInboxApi(opts: InboxMockOptions = {}) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const exact = opts.handlers?.[`${method} ${url}`];
    if (exact) return exact(init, url);
    if (method === 'GET' && url.startsWith('/api/tasks?')) {
      const t = opts.tasks ?? tasksOf([]);
      return jsonResponse(typeof t === 'function' ? t(url) : t);
    }
    if (method === 'GET' && url.startsWith('/api/board')) return jsonResponse(opts.board ?? boardData());
    if (method === 'GET' && url === '/api/me/mail') return jsonResponse(opts.mail ?? mailStatus());
    if (method === 'PATCH' && url === '/api/me/preferences') return jsonResponse({});
    return jsonResponse({ error: { code: 'not_found', message: `No mock for ${method} ${url}` } }, 404);
  });
  return calls;
}

export function renderInbox(opts: InboxMockOptions & { me?: MeResponse } = {}) {
  const me = opts.me ?? singleBranchMe();
  const calls = mockInboxApi(opts);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(keys.me(), me);
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <MeProvider me={me}>
            <BranchScopeProvider>
              <InboxPage />
            </BranchScopeProvider>
          </MeProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, calls, client, me };
}

/** Minimal DataTransfer stand-in for drag-and-drop tests (jsdom has none). */
export function dataTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
  };
}
