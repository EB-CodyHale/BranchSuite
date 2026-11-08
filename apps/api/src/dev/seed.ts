/**
 * FICTIONAL seed data for local development and demos. Every name, company, address and rate here
 * is invented (Microsoft sample company names and example.com domains). Dates are relative to now.
 */
import { createHash } from 'node:crypto';
import {
  addDays,
  generateWallCode,
  newId,
  PIPELINE_STAGES,
  todayKey,
  zBranchSettings,
  zUserPreferences,
  zWallSettings,
  type Account,
  type Branch,
  type Candidate,
  type EmailMessage,
  type FilteredMail,
  type MarkerId,
  type Opening,
  type OpeningState,
  type Order,
  type PipelineStage,
  type Role,
  type RoleCategory,
  type Task,
  type User,
  type WallCode,
  type WhiteboardBlock,
} from '@branchsuite/shared';
import { DOC_KINDS, toDoc, whiteboardId, type DocumentRepo } from '../data/documentRepo.js';
import type { MediaStore } from '../media/store.js';
import { sha256Hex } from '../security/crypto.js';
import { seedChartPng } from './png.js';

export const DEV_DISPLAY_TOKEN = 'dev-wall-token-riverside-do-not-use-in-azure';

const TZ = 'America/Chicago';
const B1 = 'branch-1001';
const B2 = 'branch-1002';

/** Deterministic rng (mulberry32) so seed wall codes are stable between restarts. */
function seededRng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface UserSpec {
  id: string;
  name: string;
  initials: string;
  role: Role;
  branchIds: string[];
  marker: MarkerId;
}

const USERS: UserSpec[] = [
  { id: 'usr_avery', name: 'Avery Quinn', initials: 'AQ', role: 'admin', branchIds: [B1, B2], marker: 'navy' },
  { id: 'usr_morgan', name: 'Morgan Reyes', initials: 'MR', role: 'manager', branchIds: [B1], marker: 'blue' },
  { id: 'usr_jordan', name: 'Jordan Patel', initials: 'JP', role: 'manager', branchIds: [B2], marker: 'green' },
  { id: 'usr_casey', name: 'Casey Brooks', initials: 'CB', role: 'member', branchIds: [B1], marker: 'red' },
  { id: 'usr_riley', name: 'Riley Chen', initials: 'RC', role: 'member', branchIds: [B1, B2], marker: 'purple' },
  { id: 'usr_taylor', name: 'Taylor Nguyen', initials: 'TN', role: 'member', branchIds: [B2], marker: 'orange' },
];

export const seedEmail = (id: string) => `${id.replace('usr_', '')}@branchsuite.example.com`;

interface AccountSpec {
  key: string;
  branchId: string;
  name: string;
  domain: string;
  aliases?: string[];
  ownerId?: string;
  isPriority?: boolean;
  units?: Array<{ key: string; name: string; parent?: string; ownerId?: string; aliases?: string[] }>;
  contacts?: Array<{ name: string; local: string; unit?: string }>;
}

const ACCOUNTS: AccountSpec[] = [
  {
    key: 'northwind', branchId: B1, name: 'Northwind Logistics', domain: 'northwind.example.com', aliases: ['Northwind', 'NWL'], ownerId: 'usr_casey', isPriority: true,
    units: [
      { key: 'dock', name: 'Dock A', aliases: ['Dock 1'] },
      { key: 'cold', name: 'Cold Chain', ownerId: 'usr_riley' },
      { key: 'freezer', name: 'Freezer Team', parent: 'cold' },
    ],
    contacts: [{ name: 'Dana Whitfield', local: 'dana.whitfield' }, { name: 'Lee Okafor', local: 'lee.okafor', unit: 'cold' }],
  },
  { key: 'contoso', branchId: B1, name: 'Contoso Cold Storage', domain: 'contoso.example.com', aliases: ['Contoso'], ownerId: 'usr_riley', contacts: [{ name: 'Sam Ortega', local: 'sam.ortega' }] },
  { key: 'fabrikam', branchId: B1, name: 'Fabrikam Plastics', domain: 'fabrikam.example.com', aliases: ['Fabrikam'], ownerId: 'usr_casey', contacts: [{ name: 'Robin Hale', local: 'robin.hale' }] },
  { key: 'tailspin', branchId: B1, name: 'Tailspin Packaging', domain: 'tailspin.example.com', aliases: ['Tailspin'], units: [{ key: 'line2', name: 'Line 2' }] },
  { key: 'adventure', branchId: B1, name: 'Adventure Works Assembly', domain: 'adventureworks.example.com', aliases: ['Adventure Works'], ownerId: 'usr_morgan' },
  { key: 'woodgrove', branchId: B1, name: 'Woodgrove Distribution', domain: 'woodgrove.example.com', aliases: ['Woodgrove'] },
  { key: 'litware', branchId: B2, name: 'Litware Foods', domain: 'litware.example.com', aliases: ['Litware'], ownerId: 'usr_taylor', isPriority: true, contacts: [{ name: 'Kim Alvarez', local: 'kim.alvarez' }] },
  { key: 'proseware', branchId: B2, name: 'Proseware Metals', domain: 'proseware.example.com', aliases: ['Proseware'], ownerId: 'usr_riley' },
  { key: 'wingtip', branchId: B2, name: 'Wingtip Fulfillment', domain: 'wingtip.example.com', aliases: ['Wingtip'], units: [{ key: 'east', name: 'East Building' }, { key: 'west', name: 'West Building' }] },
  { key: 'alpine', branchId: B2, name: 'Alpine Ski Parts', domain: 'alpineparts.example.com', aliases: ['Alpine'] },
  { key: 'fourth', branchId: B2, name: 'Fourth Coffee Roasters', domain: 'fourthcoffee.example.com', aliases: ['Fourth Coffee'], ownerId: 'usr_jordan' },
];

type LineSpec = OpeningState | [OpeningState, string, number | null];

interface OrderSpec {
  key: string;
  account: string;
  unit?: string;
  role: string;
  category: RoleCategory;
  shift: string;
  days?: string;
  hours?: string;
  pay?: number;
  lines: LineSpec[];
  priority?: boolean;
  status?: Order['status'];
  ageDays: number;
  note?: string;
  pausedResumeIn?: number;
}

const ORDERS: OrderSpec[] = [
  { key: 'o1', account: 'northwind', unit: 'dock', role: 'Forklift Operator', category: 'forklift', shift: '1st', days: 'M-F', hours: '6:00a-2:30p', pay: 19.5, lines: ['open', 'open', ['committed', 'JL', 1], ['started', 'MK', -3]], priority: true, ageDays: 9 },
  { key: 'o2', account: 'northwind', unit: 'freezer', role: 'Freezer Order Picker', category: 'order_picker', shift: '2nd', days: 'M-F', hours: '3:00p-11:30p', pay: 21, lines: ['open', 'open', 'open', ['tentative', 'AB', 2]], ageDays: 3 },
  { key: 'o3', account: 'contoso', role: 'Reach Truck Driver', category: 'reach', shift: '3rd', days: 'Su-Th', hours: '10:00p-6:30a', pay: 22.75, lines: [['committed', 'TS', 0], 'open'], ageDays: 12 },
  { key: 'o4', account: 'fabrikam', role: 'Machine Operator', category: 'machine_operator', shift: '1st', days: 'M-F', hours: '7:00a-3:30p', pay: 18.25, lines: ['open', 'open', 'open', 'open', 'open'], ageDays: 1 },
  { key: 'o5', account: 'tailspin', unit: 'line2', role: 'Packer', category: 'production', shift: '2nd', days: 'M-Sa', hours: '2:00p-10:30p', pay: 17, lines: [['started', 'RW', -10], ['started', 'GH', -8], ['committed', 'PD', 4]], ageDays: 20 },
  { key: 'o6', account: 'adventure', role: 'Assembler', category: 'production', shift: 'Weekend', days: 'Sa-Su', hours: '6:00a-6:30p', pay: 20, lines: ['open', 'open'], status: 'paused', pausedResumeIn: 3, ageDays: 15, note: 'Client paused hiring until inventory count is done.' },
  { key: 'o7', account: 'woodgrove', role: 'General Labor', category: 'general_labor', shift: '1st', days: 'M-F', hours: '8:00a-4:30p', pay: 16.5, lines: ['open', 'open', 'open'], status: 'draft', ageDays: 0 },
  { key: 'o8', account: 'contoso', role: 'Inventory Clerk', category: 'clerical', shift: '1st', days: 'M-F', hours: '8:00a-5:00p', pay: 19, lines: [['started', 'EV', -30]], status: 'closed', ageDays: 40 },
  { key: 'o9', account: 'fabrikam', role: 'Maintenance Tech', category: 'maintenance', shift: '2nd', days: 'M-F', hours: '3:00p-11:30p', pay: 28, lines: ['open'], priority: true, ageDays: 6 },
  { key: 'o10', account: 'litware', role: 'Sanitation Associate', category: 'general_labor', shift: '3rd', days: 'Su-Th', hours: '11:00p-7:30a', pay: 18.5, lines: ['open', 'open', ['committed', 'NB', 2], 'open'], priority: true, ageDays: 8 },
  { key: 'o11', account: 'litware', role: 'Line Lead', category: 'production', shift: '1st', days: 'M-F', hours: '6:00a-2:30p', pay: 23, lines: [['tentative', 'OF', null]], ageDays: 2 },
  { key: 'o12', account: 'proseware', role: 'Press Brake Operator', category: 'machine_operator', shift: '2nd', days: 'M-F', hours: '2:30p-11:00p', pay: 21.5, lines: ['open', 'open', ['started', 'CW', -5]], ageDays: 11 },
  { key: 'o13', account: 'wingtip', unit: 'east', role: 'Order Picker', category: 'order_picker', shift: '1st', days: 'M-F', hours: '7:00a-3:30p', pay: 17.75, lines: ['open', 'open', 'open', 'open', ['committed', 'HY', 1], ['committed', 'SM', 1]], ageDays: 4 },
  { key: 'o14', account: 'wingtip', unit: 'west', role: 'Shipping Clerk', category: 'clerical', shift: '2nd', days: 'M-F', hours: '3:00p-11:30p', pay: 18, lines: ['open'], ageDays: 1 },
  { key: 'o15', account: 'alpine', role: 'CDL-A Driver', category: 'driver', shift: '1st', days: 'M-F', hours: '5:00a-3:00p', pay: 27.5, lines: ['open', 'open'], ageDays: 14 },
  { key: 'o16', account: 'fourth', role: 'Roaster Helper', category: 'production', shift: '1st', days: 'Tu-Sa', hours: '6:00a-2:30p', pay: 17.25, lines: [['committed', 'DQ', -1], 'open'], status: 'paused', pausedResumeIn: 0, ageDays: 18 },
];

interface CandidateSpec {
  first: string;
  last: string;
  branchId: string;
  stage: PipelineStage;
  recruiter: string;
  account?: string;
  /** Link to the first open line of this order. */
  order?: string;
  startIn?: number;
}

const CANDIDATES: CandidateSpec[] = [
  { first: 'Jamie', last: 'Lowell', branchId: B1, stage: 'screened', recruiter: 'usr_casey', account: 'northwind', order: 'o1' },
  { first: 'Alex', last: 'Moreno', branchId: B1, stage: 'interviewing', recruiter: 'usr_riley', account: 'fabrikam', order: 'o4', startIn: 5 },
  { first: 'Priya', last: 'Desai', branchId: B1, stage: 'accepted', recruiter: 'usr_casey', account: 'fabrikam', order: 'o9', startIn: 2 },
  { first: 'Chris', last: 'Fontaine', branchId: B1, stage: 'sourced', recruiter: 'usr_casey' },
  { first: 'Dev', last: 'Ramsey', branchId: B1, stage: 'submitted', recruiter: 'usr_riley', account: 'contoso' },
  { first: 'Morgan', last: 'Ellis', branchId: B1, stage: 'dropped', recruiter: 'usr_casey', account: 'tailspin' },
  { first: 'Noah', last: 'Brandt', branchId: B2, stage: 'onboarding', recruiter: 'usr_taylor', account: 'litware', order: 'o10', startIn: 3 },
  { first: 'Ivy', last: 'Kowalski', branchId: B2, stage: 'screened', recruiter: 'usr_taylor', account: 'wingtip', order: 'o13' },
  { first: 'Omar', last: 'Farouk', branchId: B2, stage: 'sourced', recruiter: 'usr_riley' },
  { first: 'Lena', last: 'Park', branchId: B2, stage: 'started', recruiter: 'usr_taylor', account: 'alpine', order: 'o15', startIn: -1 },
];

/** Populate an EMPTY repository. */
/** Seed whiteboard image id (Riverside). */
export const SEED_MEDIA_ID = 'med_seed_fillrate';

/**
 * `media`: when given, the seed whiteboard also gets an image block backed by a generated PNG chart.
 */
export async function seedDevData(repo: DocumentRepo, now: Date = new Date(), media?: MediaStore): Promise<void> {
  const nowIso = now.toISOString();
  const today = todayKey(TZ, now);
  const isoDaysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const audited = (by: string | null, at = nowIso) => ({ createdAt: at, updatedAt: at, createdBy: by, updatedBy: by });

  // ----- branches -----
  const branches: Branch[] = [
    { id: B1, code: '1001', name: 'Riverside, IL', brands: ['Industrial'] },
    { id: B2, code: '1002', name: 'Lakeview, IL', brands: ['Industrial', 'Light Industrial'] },
  ].map((b) => ({
    ...b,
    timeZone: TZ,
    settings: zBranchSettings.parse({ internalDomains: ['branchsuite.example.com'], shiftOptions: ['A', 'B'] }),
    wall: zWallSettings.parse({ headline: 'Now hiring — ask the front desk' }),
    active: true,
    ...audited(null),
  }));
  for (const b of branches) await repo.createBranch(b);

  // ----- users -----
  for (const u of USERS) {
    const user: User = {
      ...u,
      email: seedEmail(u.id),
      entraOid: null,
      active: true,
      outDates: u.id === 'usr_taylor' ? [addDays(today, 1)] : [],
      preferences: zUserPreferences.parse({}),
      ...audited(null),
    };
    await repo.createUser(user);
  }

  // ----- accounts -----
  const rng = seededRng(1001);
  const takenByBranch = new Map<string, WallCode[]>();
  const accountIds = new Map<string, string>();
  const unitIds = new Map<string, string>();
  const nextCode = (branchId: string) => {
    const taken = takenByBranch.get(branchId) ?? [];
    const code = generateWallCode(taken, rng);
    takenByBranch.set(branchId, [...taken, code]);
    return code;
  };
  for (const spec of ACCOUNTS) {
    const id = `acc_${spec.key}`;
    accountIds.set(spec.key, id);
    for (const u of spec.units ?? []) unitIds.set(`${spec.key}.${u.key}`, `unit_${spec.key}_${u.key}`);
    const account: Account = {
      id,
      branchId: spec.branchId,
      name: spec.name,
      accountNumber: `AC-${1000 + accountIds.size}`,
      sourceId: null,
      aliases: spec.aliases ?? [],
      domains: [spec.domain],
      ownerId: spec.ownerId ?? null,
      isPriority: spec.isPriority ?? false,
      reserved: null,
      wall: nextCode(spec.branchId),
      units: (spec.units ?? []).map((u) => ({
        id: unitIds.get(`${spec.key}.${u.key}`) as string,
        name: u.name,
        parentId: u.parent ? (unitIds.get(`${spec.key}.${u.parent}`) as string) : null,
        ownerId: u.ownerId ?? null,
        aliases: u.aliases ?? [],
        active: true,
      })),
      contacts: (spec.contacts ?? []).map((c, i) => ({
        id: `con_${spec.key}_${i + 1}`,
        email: `${c.local}@${spec.domain}`,
        name: c.name,
        unitId: c.unit ? (unitIds.get(`${spec.key}.${c.unit}`) as string) : null,
        active: true,
      })),
      active: true,
      ...audited('usr_avery', isoDaysAgo(60)),
    };
    await repo.createAccount(account);
  }
  for (const branchId of [B1, B2]) {
    await repo.createAccount({
      id: `acc_internal_${branchId}`,
      branchId,
      name: 'Internal',
      accountNumber: null,
      sourceId: null,
      aliases: [],
      domains: [],
      ownerId: null,
      isPriority: false,
      reserved: 'internal',
      wall: nextCode(branchId),
      units: [],
      contacts: [],
      active: true,
      ...audited(null, isoDaysAgo(60)),
    });
  }

  // ----- orders -----
  const orders = new Map<string, Order>();
  for (const spec of ORDERS) {
    const account = ACCOUNTS.find((a) => a.key === spec.account) as AccountSpec;
    const createdAt = isoDaysAgo(spec.ageDays);
    const writer = account.ownerId ?? (account.branchId === B1 ? 'usr_casey' : 'usr_taylor');
    const openings: Opening[] = spec.lines.map((line) => {
      const [state, initials, startIn] = typeof line === 'string' ? [line, null, null] : line;
      return {
        id: newId('opn'),
        state,
        initials: state === 'open' ? null : initials,
        candidateId: null,
        startDate: startIn === null || startIn === undefined ? null : addDays(today, startIn),
        writtenBy: state === 'open' ? null : writer,
        updatedAt: createdAt,
      };
    });
    const status = spec.status ?? 'active';
    const manager = account.branchId === B1 ? 'usr_morgan' : 'usr_jordan';
    const order: Order = {
      id: `ord_${spec.key}`,
      branchId: account.branchId,
      accountId: accountIds.get(spec.account) as string,
      unitId: spec.unit ? (unitIds.get(`${spec.account}.${spec.unit}`) as string) : null,
      site: '',
      role: spec.role,
      roleCategory: spec.category,
      shift: spec.shift,
      days: spec.days ?? '',
      hours: spec.hours ?? '',
      payRate: spec.pay ?? null,
      note: spec.note ?? '',
      isPriority: spec.priority ?? false,
      status,
      pause: status === 'paused' ? { reason: spec.note ?? 'Client request', at: isoDaysAgo(2), by: manager, resumeOn: addDays(today, spec.pausedResumeIn ?? 7) } : null,
      close: status === 'closed' ? { reason: 'filled', note: 'All lines started.', at: isoDaysAgo(25), by: manager } : null,
      openings,
      source: spec.key === 'o11' ? 'email' : 'manual',
      sourceTaskId: null,
      sourceMessageId: null,
      ...audited(manager, createdAt),
    };
    orders.set(spec.key, order);
  }

  // ----- candidates (linked lines are written onto their orders before the orders are stored) -----
  for (const spec of CANDIDATES) {
    const id = newId('cand');
    const initials = `${spec.first[0]}${spec.last[0]}`.toUpperCase();
    const startDate = spec.startIn === undefined ? null : addDays(today, spec.startIn);
    let orderId: string | null = null;
    let openingId: string | null = null;
    if (spec.order) {
      const order = orders.get(spec.order) as Order;
      const line = order.openings.find((o) => o.state === 'open' && o.candidateId === null);
      const state = PIPELINE_STAGES.find((s) => s.id === spec.stage)?.opening ?? null;
      if (line && state) {
        Object.assign(line, { state, initials, candidateId: id, startDate, writtenBy: spec.recruiter });
        orderId = order.id;
        openingId = line.id;
      }
    }
    const created = isoDaysAgo(10);
    const stages = PIPELINE_STAGES.map((s) => s.id).filter((s) => s !== 'dropped');
    const reached = spec.stage === 'dropped' ? ['sourced', 'dropped'] : stages.slice(0, stages.indexOf(spec.stage) + 1);
    const candidate: Candidate = {
      id,
      branchId: spec.branchId,
      firstName: spec.first,
      lastName: spec.last,
      initials,
      phone: '555-0100',
      email: `${spec.first.toLowerCase()}.${spec.last.toLowerCase()}@mail.example.org`,
      recruiterId: spec.recruiter,
      stage: spec.stage,
      accountId: spec.account ? (accountIds.get(spec.account) as string) : null,
      orderId,
      openingId,
      startDate,
      notes: '',
      history: reached.map((stage, i) => ({
        stage: stage as PipelineStage,
        at: isoDaysAgo(10 - i),
        by: spec.recruiter,
        note: '',
        dropReason: stage === 'dropped' ? ('candidate_withdrew' as const) : null,
      })),
      status: 'active',
      ...audited(spec.recruiter, created),
    };
    await repo.createCandidate(candidate);
  }
  for (const order of orders.values()) await repo.createOrder(order);

  // ----- mailboxes -----
  const mailboxes = [
    { id: 'mbx_riverside', address: 'riverside.orders@branchsuite.example.com', kind: 'branch' as const, branchIds: [B1], userId: null },
    { id: 'mbx_lakeview', address: 'lakeview.orders@branchsuite.example.com', kind: 'branch' as const, branchIds: [B2], userId: null },
    { id: 'mbx_casey', address: seedEmail('usr_casey'), kind: 'personal' as const, branchIds: [], userId: 'usr_casey' },
  ];
  for (const m of mailboxes) {
    await repo.createMailbox({ ...m, brand: '', enabled: true, enabledAt: isoDaysAgo(30), status: 'ok', lastSyncAt: isoDaysAgo(0), lastError: null, ...audited('usr_avery', isoDaysAgo(30)) });
  }

  // ----- tasks, messages, filtered mail -----
  const task = (fields: Partial<Task> & Pick<Task, 'title' | 'scopeId'>, receivedHoursAgo: number, from: { address: string; name: string }, mailboxId: string): Task => {
    const received = new Date(now.getTime() - receivedHoursAgo * 3_600_000).toISOString();
    const personal = fields.scopeId.startsWith('personal:');
    return {
      id: newId('task'),
      scope: personal ? 'personal' : 'branch',
      branchId: personal ? null : fields.scopeId,
      ownerUserId: personal ? fields.scopeId.slice('personal:'.length) : null,
      boardDate: todayKey(TZ, new Date(received)),
      summary: '',
      category: 'client',
      categorySource: 'auto',
      priority: 'normal',
      status: 'open',
      assigneeId: null,
      accountId: null,
      unitId: null,
      routing: { status: 'unmatched', candidates: [] },
      email: {
        mailboxId,
        conversationId: `conv-${newId('c')}`,
        fromAddress: from.address,
        fromName: from.name,
        subject: fields.title,
        receivedAt: received,
        webLink: null,
        messageCount: 1,
        lastMessageAt: received,
      },
      deadline: null,
      staffingRequest: null,
      orderId: null,
      completedAt: null,
      completedBy: null,
      closedByReply: null,
      ...audited(null, received),
      ...fields,
    };
  };
  const dana = { address: 'dana.whitfield@northwind.example.com', name: 'Dana Whitfield' };
  const kim = { address: 'kim.alvarez@litware.example.com', name: 'Kim Alvarez' };
  const sam = { address: 'sam.ortega@contoso.example.com', name: 'Sam Ortega' };
  const tasks: Task[] = [
    task({
      scopeId: B1, title: 'Need 3 more pickers for Cold Chain starting Monday', priority: 'hot', accountId: 'acc_northwind', unitId: 'unit_northwind_cold',
      routing: { status: 'matched', candidates: [{ accountId: 'acc_northwind', unitId: 'unit_northwind_cold', reason: 'Sender is contact Dana Whitfield' }] },
      summary: 'Northwind asks for 3 freezer pickers on 2nd shift starting Monday at $21/hr.',
      staffingRequest: { role: 'Freezer Order Picker', roleCategory: 'order_picker', headcount: 3, headcountText: '3', shift: '2nd', days: 'M-F', hours: '3:00p-11:30p', payRate: 21, startDate: addDays(today, 3), site: 'Cold Chain', notes: 'Freezer gear provided.', blockedReason: 'Drafts need manager review' },
    }, 2, dana, 'mbx_riverside'),
    task({ scopeId: B1, title: 'Timecard correction for last week', category: 'associate', assigneeId: 'usr_casey', accountId: 'acc_contoso', routing: { status: 'matched', candidates: [{ accountId: 'acc_contoso', unitId: null, reason: 'Sender is contact Sam Ortega' }] } }, 5, sam, 'mbx_riverside'),
    task({ scopeId: B1, title: 'Badge access for new starters', category: 'associate', priority: 'low' }, 26, dana, 'mbx_riverside'),
    task({ scopeId: B1, title: 'Invoice question on PO 4471', category: 'client', status: 'done', completedAt: isoDaysAgo(0), completedBy: 'usr_morgan' }, 8, sam, 'mbx_riverside'),
    task({ scopeId: B1, title: 'Safety orientation schedule', category: 'operations' }, 50, { address: 'safety@branchsuite.example.com', name: 'Safety Team' }, 'mbx_riverside'),
    task({ scopeId: B2, title: 'Sanitation crew short tonight', priority: 'hot', category: 'client', accountId: 'acc_litware', assigneeId: 'usr_taylor' }, 1, kim, 'mbx_lakeview'),
    task({ scopeId: B2, title: 'Rate confirmation for line leads', category: 'client', accountId: 'acc_litware' }, 30, kim, 'mbx_lakeview'),
    task({ scopeId: B2, title: 'Call-off: two associates out Friday', category: 'associate' }, 4, { address: 'ops@wingtip.example.com', name: 'Wingtip Ops' }, 'mbx_lakeview'),
    task({ scopeId: B2, title: 'Quarterly review meeting', category: 'operations', priority: 'low', status: 'done', completedAt: isoDaysAgo(1), completedBy: 'usr_jordan' }, 48, { address: 'gm@fourthcoffee.example.com', name: 'Fourth Coffee GM' }, 'mbx_lakeview'),
    task({ scopeId: 'personal:usr_casey', title: 'Follow up with Dana about holiday coverage', category: 'client', assigneeId: 'usr_casey' }, 3, dana, 'mbx_casey'),
  ];
  for (const t of tasks) await repo.createTask(t);

  const messages: EmailMessage[] = tasks.slice(0, 3).concat(tasks[9] as Task).map((t) => ({
    id: newId('msg'),
    scopeId: t.scopeId,
    taskId: t.id,
    mailboxId: t.email!.mailboxId,
    conversationId: t.email!.conversationId,
    internetMessageId: `<${newId('m')}@mail.example.com>`,
    direction: 'inbound',
    fromAddress: t.email!.fromAddress,
    fromName: t.email!.fromName,
    to: [t.scopeId.startsWith('personal:') ? seedEmail('usr_casey') : 'riverside.orders@branchsuite.example.com'],
    cc: [],
    subject: t.title,
    bodyText: `Hi team,\n\n${t.summary || t.title}.\n\nThanks,\n${t.email!.fromName}`,
    receivedAt: t.email!.receivedAt,
    webLink: null,
    decision: 'Actionable request',
  }));
  const filtered: FilteredMail[] = [
    { id: newId('flt'), scopeId: B1, mailboxId: 'mbx_riverside', fromAddress: 'noreply@newsletter.example.net', fromName: 'Industry Weekly', subject: 'This week in logistics', excerpt: 'Top stories from the warehouse world…', receivedAt: isoDaysAgo(1), reason: 'Newsletter / no-reply sender', stage: 'prefilter', promotedTaskId: null },
    { id: newId('flt'), scopeId: B1, mailboxId: 'mbx_riverside', fromAddress: 'robin.hale@fabrikam.example.com', fromName: 'Robin Hale', subject: 'Automatic reply: Out of office', excerpt: 'I am out of the office until Monday.', receivedAt: isoDaysAgo(0), reason: 'Auto-reply', stage: 'prefilter', promotedTaskId: null },
    { id: newId('flt'), scopeId: B2, mailboxId: 'mbx_lakeview', fromAddress: 'kim.alvarez@litware.example.com', fromName: 'Kim Alvarez', subject: 'Thanks!', excerpt: 'Thanks for the quick turnaround yesterday.', receivedAt: isoDaysAgo(0), reason: 'Thank-you note, no action needed', stage: 'model', promotedTaskId: null },
  ];
  for (const m of messages) await repo.store.create('mail', toDoc(DOC_KINDS.message, m, m.scopeId));
  for (const f of filtered) await repo.store.create('mail', toDoc(DOC_KINDS.filtered, f, f.scopeId));

  // ----- today's morning whiteboard (Riverside), every block kind -----
  const blocks: WhiteboardBlock[] = [
    {
      id: 'blk_talk', kind: 'talking_points', title: 'Talking points',
      items: [
        { id: 'itm_talk_1', text: 'Northwind Cold Chain wants 3 more pickers by Monday. Freezer gear is provided.' },
        { id: 'itm_talk_2', text: 'Fabrikam machine operator order is brand new: five lines, all open.' },
        { id: 'itm_talk_3', text: 'Thanks, everyone: fill rate is up four weeks in a row.' },
      ],
    },
    {
      id: 'blk_assign', kind: 'assignments', title: 'Assignments',
      items: [
        { id: 'itm_asg_1', userId: 'usr_casey', text: 'Call back yesterday’s forklift applicants before 10a', taskId: null, done: false },
        { id: 'itm_asg_2', userId: 'usr_riley', text: 'Confirm Contoso 3rd-shift start for Monday', taskId: null, done: true },
        { id: 'itm_asg_3', userId: null, text: 'Everyone: update pencils on the board before lunch', taskId: null, done: false },
      ],
    },
    {
      id: 'blk_orders', kind: 'priority_orders', title: 'Priority orders',
      items: [
        { orderId: 'ord_o1', note: 'Two open forklift lines on 1st' },
        { orderId: 'ord_o2', note: 'Client asked twice this week' },
        { orderId: 'ord_o9', note: 'Hard to fill: maintenance tech' },
      ],
    },
    { id: 'blk_safety', kind: 'note', title: 'Safety minute', text: 'Cold-weather PPE reminders:\n- Insulated gloves for every freezer start\n- Check boots before the shift', tone: 'safety' },
    { id: 'blk_numbers', kind: 'metrics', title: "Today's numbers" },
  ];
  if (media) {
    const png = seedChartPng();
    const dims = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    await media.put(B1, SEED_MEDIA_ID, png, 'image/png');
    await repo.createMedia({
      id: SEED_MEDIA_ID, branchId: B1, contentType: 'image/png', bytes: png.length, ...dims,
      fileName: 'fill-rate-last-5-days.png', sha256: createHash('sha256').update(png).digest('hex'), uploadedBy: 'usr_morgan', uploadedAt: nowIso,
    });
    blocks.splice(4, 0, { id: 'blk_chart', kind: 'image', title: 'Fill rate, last 5 days', mediaId: SEED_MEDIA_ID, caption: 'Fictional sample data' });
  }
  await repo.upsertWhiteboard(B1, today, () => ({
    id: whiteboardId(B1, today),
    branchId: B1,
    date: today,
    title: 'Morning huddle',
    window: { start: '07:30', end: '08:15' },
    live: 'auto',
    orderLabels: 'name',
    blocks,
    ...audited('usr_morgan', isoDaysAgo(0)),
  }));

  // ----- one paired lobby display (dev token printed by the dev server) -----
  await repo.createDisplay(
    { id: 'dsp_riverside_lobby', branchId: B1, name: 'Riverside lobby TV', tokenPrefix: DEV_DISPLAY_TOKEN.slice(0, 6), lastSeenAt: null, revokedAt: null, content: 'auto', ...audited('usr_morgan', isoDaysAgo(20)) },
    sha256Hex(DEV_DISPLAY_TOKEN),
  );
}
