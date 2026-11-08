/** Fictional test builders for domain tests. Not exported from the package. */
import type { AccountLite } from '../api.js';
import { zBranchSettings, zUserPreferences, zWallSettings } from '../schemas.js';
import type { Account, AccountContact, AccountUnit, Branch, Candidate, Opening, Order, PersonLite, Task, User } from '../schemas.js';

export const T0 = '2026-03-01T15:00:00.000Z';

export function opening(over: Partial<Opening> = {}): Opening {
  return { id: 'opn_1', state: 'open', initials: null, candidateId: null, startDate: null, writtenBy: null, updatedAt: T0, ...over };
}

export function order(over: Partial<Order> = {}): Order {
  return {
    id: 'ord_1',
    branchId: 'br_1',
    accountId: 'acc_1',
    unitId: null,
    site: '',
    role: 'Forklift operator',
    roleCategory: 'forklift',
    shift: '1st',
    days: 'M-F',
    hours: '6:00a-2:30p',
    payRate: null,
    note: '',
    isPriority: false,
    status: 'active',
    pause: null,
    close: null,
    openings: [opening()],
    source: 'manual',
    sourceTaskId: null,
    sourceMessageId: null,
    createdAt: T0,
    updatedAt: T0,
    createdBy: 'usr_mgr',
    updatedBy: 'usr_mgr',
    ...over,
  };
}

export function unit(over: Partial<AccountUnit> = {}): AccountUnit {
  return { id: 'unit_1', name: 'Building A', parentId: null, ownerId: null, aliases: [], active: true, ...over };
}

export function contact(over: Partial<AccountContact> = {}): AccountContact {
  return { id: 'ct_1', email: 'pat@northwind-example.com', name: 'Pat Example', unitId: null, active: true, ...over };
}

export function account(over: Partial<Account> = {}): Account {
  return {
    id: 'acc_1',
    branchId: 'br_1',
    name: 'Northwind Fabrication',
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
    createdAt: T0,
    updatedAt: T0,
    createdBy: null,
    updatedBy: null,
    ...over,
  };
}

export function accountLite(over: Partial<Account> = {}): AccountLite {
  const { contacts: _omit, ...lite } = account(over);
  return lite;
}

export function person(over: Partial<PersonLite> = {}): PersonLite {
  return { id: 'usr_1', name: 'Robin Sample', initials: 'RS', marker: 'green', role: 'member', branchIds: ['br_1'], active: true, outDates: [], ...over };
}

export function user(over: Partial<User> = {}): User {
  return {
    id: 'usr_1',
    email: 'robin.sample@example.com',
    entraOid: null,
    name: 'Robin Sample',
    initials: 'RS',
    role: 'member',
    branchIds: ['br_1'],
    marker: 'green',
    active: true,
    outDates: [],
    preferences: zUserPreferences.parse({}),
    createdAt: T0,
    updatedAt: T0,
    createdBy: null,
    updatedBy: null,
    ...over,
  };
}

export function branch(over: Partial<Branch> = {}): Branch {
  return {
    id: 'br_1',
    code: 'TST-01',
    name: 'Riverbend Test Branch',
    timeZone: 'America/Chicago',
    brands: [],
    settings: zBranchSettings.parse({}),
    wall: zWallSettings.parse({}),
    active: true,
    createdAt: T0,
    updatedAt: T0,
    createdBy: null,
    updatedBy: null,
    ...over,
  };
}

export function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    id: 'cand_1',
    branchId: 'br_1',
    firstName: 'Jordan',
    lastName: 'Fictional',
    initials: 'JF',
    phone: '',
    email: '',
    recruiterId: 'usr_1',
    stage: 'sourced',
    accountId: null,
    orderId: null,
    openingId: null,
    startDate: null,
    notes: '',
    history: [{ stage: 'sourced', at: T0, by: 'usr_1', note: '', dropReason: null }],
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
    createdBy: 'usr_1',
    updatedBy: 'usr_1',
    ...over,
  };
}

export function task(over: Partial<Task> = {}): Task {
  return {
    id: 'tsk_1',
    scopeId: 'br_1',
    scope: 'branch',
    branchId: 'br_1',
    ownerUserId: null,
    boardDate: '2026-03-10',
    title: 'Follow up',
    summary: '',
    category: 'operations',
    categorySource: 'auto',
    priority: 'normal',
    status: 'open',
    assigneeId: null,
    accountId: null,
    unitId: null,
    routing: { status: 'manual', candidates: [] },
    email: null,
    deadline: null,
    staffingRequest: null,
    orderId: null,
    completedAt: null,
    completedBy: null,
    closedByReply: null,
    createdAt: T0,
    updatedAt: T0,
    createdBy: null,
    updatedBy: null,
    ...over,
  };
}
