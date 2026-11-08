/** Fictional fixtures for web tests. No real people, clients, addresses or pay data. */
import type { BoardResponse, Branch, MeResponse, Order, User } from '@branchsuite/shared';

const T = '2026-03-02T15:00:00.000Z';
const audited = { createdAt: T, updatedAt: T, createdBy: null, updatedBy: null };

export function branch(id: string, name: string): Branch {
  return {
    ...audited,
    id,
    code: id.toUpperCase().replace(/[^A-Z0-9]/g, ''),
    name,
    timeZone: 'America/Chicago',
    brands: [],
    settings: { autoPublishEmailOrders: false, internalDomains: [], shiftOptions: [] },
    wall: {
      clientDisplay: 'code',
      payDisplay: 'hidden',
      candidateDisplay: 'marks',
      roleDisplay: 'full',
      showSchedule: true,
      showLocation: false,
      ownerDisplay: 'marker',
      showPaused: false,
      headline: '',
      pageSeconds: 15,
      theme: 'dark',
    },
    active: true,
  };
}

export function user(overrides: Partial<User> = {}): User {
  return {
    ...audited,
    id: 'usr_avery',
    email: 'avery.quinn@example.test',
    entraOid: null,
    name: 'Avery Quinn',
    initials: 'AQ',
    role: 'manager',
    branchIds: ['br_north', 'br_south'],
    marker: 'teal',
    active: true,
    outDates: [],
    preferences: { theme: 'daylight', branchScope: 'all', inboxView: 'branch' },
    ...overrides,
  };
}

export function meResponse(overrides: { user?: Partial<User>; pipeline?: boolean; branches?: Branch[] } = {}): MeResponse {
  const u = user(overrides.user);
  const branches = overrides.branches ?? [branch('br_north', 'Northfield'), branch('br_south', 'Southport')];
  const ids = branches.map((b) => b.id);
  return {
    user: u,
    branches,
    permissions: { branchIds: ids, manageBranchIds: u.role === 'member' ? [] : ids, isAdmin: u.role === 'admin' },
    features: { pipeline: overrides.pipeline ?? false, personalMail: false, realtime: false },
  };
}

export function order(overrides: Partial<Order> = {}): Order {
  return {
    ...audited,
    id: 'ord_1',
    branchId: 'br_north',
    accountId: 'acc_lakeside',
    unitId: null,
    site: '',
    role: 'Forklift operator',
    roleCategory: 'forklift',
    shift: '2nd',
    days: 'M-F',
    hours: '2p-10:30p',
    payRate: null,
    note: '',
    isPriority: false,
    status: 'active',
    pause: null,
    close: null,
    openings: [
      { id: 'op_1', state: 'open', initials: null, candidateId: null, startDate: null, writtenBy: null, updatedAt: T },
      { id: 'op_2', state: 'open', initials: null, candidateId: null, startDate: null, writtenBy: null, updatedAt: T },
    ],
    source: 'manual',
    sourceTaskId: null,
    sourceMessageId: null,
    ...overrides,
  };
}

export function board(orders: Order[]): BoardResponse {
  return { generatedAt: T, orders, accounts: [], people: [], today: { br_north: '2026-03-02' } };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
