/**
 * Domain entities and API input schemas (zod). Types are inferred from schemas so the
 * API validates exactly what the web client sends. Server-stamped fields (ids, timestamps,
 * actor ids, etags) never appear in *Input schemas.
 *
 * Conventions
 * - Timestamps are ISO-8601 UTC strings stamped by the server.
 * - Calendar days are 'YYYY-MM-DD' in the owning branch's time zone ("day keys").
 * - Ids are opaque strings. Users reference other users by user id, never by initials.
 * - Nothing is hard-deleted except open openings and expired TTL records; records are archived.
 */
import { z } from 'zod';
import {
  DROP_REASONS,
  LIMITS,
  MARKER_IDS,
  OPENING_STATES,
  ORDER_CLOSE_REASONS,
  ORDER_STATUSES,
  PIPELINE_STAGE_IDS,
  ROLE_CATEGORY_IDS,
  ROLES,
  TASK_CATEGORY_IDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  THEMES,
  WALL_COLOR_IDS,
  WALL_GLYPHS,
} from './constants.js';

// ---------- primitives ----------
export const zId = z.string().min(1).max(128);
export const zIso = z.string().datetime({ offset: true });
export const zDayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Invalid calendar date');
export const zShort = z.string().trim().max(LIMITS.maxShortText);
export const zEmail = z.string().trim().toLowerCase().email().max(254);
export const zDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Invalid domain');
/** Candidate initials: 1-4 letters A-Z only (prevents names/phone numbers on the board). */
export const zInitials = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[A-Z]{1,${LIMITS.maxInitialsLength}}$`), 'Initials must be 1-4 letters');
export const zTimeZone = z.string().min(1).max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown IANA time zone');

const zRole = z.enum(ROLES);
const zMarker = z.enum(MARKER_IDS);

// ---------- base ----------
export const zAudited = z.object({
  createdAt: zIso,
  updatedAt: zIso,
  createdBy: zId.nullable(),
  updatedBy: zId.nullable(),
});

// ---------- wall settings ----------
export const zPayBand = z.object({ min: z.number().min(0).max(LIMITS.maxPayRate), label: z.string().min(1).max(8) });

export const zWallSettings = z.object({
  /** 'name' only for staff-only rooms; default 'code'. */
  clientDisplay: z.enum(['code', 'name', 'hidden']).default('code'),
  payDisplay: z.enum(['exact', 'band', 'hidden']).default('hidden'),
  payBands: z.array(zPayBand).min(1).max(6).optional(),
  /** marks = filled/open/started symbols only, no letters. */
  candidateDisplay: z.enum(['initials', 'marks', 'hidden']).default('marks'),
  roleDisplay: z.enum(['full', 'category']).default('full'),
  showSchedule: z.boolean().default(true),
  showLocation: z.boolean().default(false),
  ownerDisplay: z.enum(['marker', 'initials', 'hidden']).default('marker'),
  showPaused: z.boolean().default(false),
  /** Public-friendly banner, e.g. "Now hiring — ask the front desk". */
  headline: z.string().trim().max(120).default(''),
  /** Seconds per page when orders overflow one screen. */
  pageSeconds: z.number().int().min(5).max(120).default(15),
  theme: z.enum(['dark', 'light']).default('dark'),
});
export type WallSettings = z.infer<typeof zWallSettings>;

// ---------- branch ----------
export const zBranchSettings = z.object({
  /** When false (default), orders extracted from email land as 'draft' for a manager to publish. */
  autoPublishEmailOrders: z.boolean().default(false),
  /** Domains treated as internal/team senders for this branch (in addition to tenant domains). */
  internalDomains: z.array(zDomain).max(LIMITS.maxDomains).default([]),
  /** Extra shift labels offered in the order form, e.g. ["A", "B", "AM", "PM"]. */
  shiftOptions: z.array(z.string().trim().min(1).max(LIMITS.maxShiftText)).max(20).default([]),
});
export type BranchSettings = z.infer<typeof zBranchSettings>;

export const zBranch = zAudited.extend({
  id: zId,
  code: z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/),
  name: z.string().trim().min(1).max(100),
  timeZone: zTimeZone,
  brands: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  settings: zBranchSettings,
  wall: zWallSettings,
  active: z.boolean(),
});
export type Branch = z.infer<typeof zBranch>;

export const zBranchCreateInput = z.object({
  code: zBranch.shape.code,
  name: zBranch.shape.name,
  timeZone: zTimeZone.optional(),
  brands: zBranch.shape.brands.optional(),
});
export const zBranchUpdateInput = z
  .object({
    name: zBranch.shape.name,
    timeZone: zTimeZone,
    brands: zBranch.shape.brands,
    settings: zBranchSettings.partial(),
    wall: zWallSettings.partial(),
    active: z.boolean(),
  })
  .partial();
export type BranchCreateInput = z.infer<typeof zBranchCreateInput>;
export type BranchUpdateInput = z.infer<typeof zBranchUpdateInput>;

// ---------- users ----------
export const zUserPreferences = z.object({
  theme: z.enum(THEMES).default('daylight'),
  /** Last selected branch scope: a branch id or 'all'. */
  branchScope: z.string().max(128).default('all'),
  inboxView: z.enum(['branch', 'personal', 'combined']).default('branch'),
});
export type UserPreferences = z.infer<typeof zUserPreferences>;

export const zUser = zAudited.extend({
  id: zId,
  email: zEmail,
  /** Entra object id, bound on first sign-in. */
  entraOid: z.string().max(64).nullable(),
  name: z.string().trim().min(1).max(100),
  initials: zInitials,
  role: zRole,
  branchIds: z.array(zId).max(100),
  marker: zMarker,
  active: z.boolean(),
  /** Day keys (branch-local) the person is marked out. */
  outDates: z.array(zDayKey).max(60).default([]),
  preferences: zUserPreferences,
});
export type User = z.infer<typeof zUser>;

/** What any staff member may see about a coworker who shares a branch. */
export const zPersonLite = zUser.pick({ id: true, name: true, initials: true, marker: true, role: true, branchIds: true, active: true, outDates: true });
export type PersonLite = z.infer<typeof zPersonLite>;

export const zUserCreateInput = z.object({
  email: zEmail,
  name: zUser.shape.name,
  initials: zInitials,
  role: zRole,
  branchIds: z.array(zId).min(1).max(100),
  marker: zMarker,
});
export const zUserUpdateInput = z
  .object({
    name: zUser.shape.name,
    initials: zInitials,
    role: zRole,
    branchIds: z.array(zId).max(100),
    marker: zMarker,
    active: z.boolean(),
    outDates: z.array(zDayKey).max(60),
  })
  .partial();
export type UserCreateInput = z.infer<typeof zUserCreateInput>;
export type UserUpdateInput = z.infer<typeof zUserUpdateInput>;

// ---------- accounts ----------
export const zWallCode = z.object({
  code: z.string().regex(/^[A-Z][0-9]$|^[A-Z]{2}[0-9]?$/),
  color: z.enum(WALL_COLOR_IDS),
  glyph: z.enum(WALL_GLYPHS),
});
export type WallCode = z.infer<typeof zWallCode>;

export const zAccountUnit = z.object({
  id: zId,
  name: z.string().trim().min(1).max(LIMITS.maxShortText),
  parentId: zId.nullable(),
  ownerId: zId.nullable(),
  aliases: z.array(z.string().trim().min(2).max(100)).max(LIMITS.maxAliases),
  active: z.boolean(),
});
export type AccountUnit = z.infer<typeof zAccountUnit>;

/** Manager-only. Stripped from responses for members. */
export const zAccountContact = z.object({
  id: zId,
  email: zEmail,
  name: z.string().trim().max(100).default(''),
  unitId: zId.nullable(),
  active: z.boolean(),
});
export type AccountContact = z.infer<typeof zAccountContact>;

export const zAccount = zAudited.extend({
  id: zId,
  branchId: zId,
  name: z.string().trim().min(1).max(LIMITS.maxShortText),
  accountNumber: z.string().trim().max(50).nullable(),
  sourceId: z.string().trim().max(100).nullable(),
  aliases: z.array(z.string().trim().min(2).max(100)).max(LIMITS.maxAliases),
  domains: z.array(zDomain).max(LIMITS.maxDomains),
  ownerId: zId.nullable(),
  isPriority: z.boolean(),
  /** Reserved routing accounts (sender-based): 'payroll' | 'internal'. null for customers. */
  reserved: z.enum(['payroll', 'internal']).nullable(),
  wall: zWallCode,
  units: z.array(zAccountUnit).max(LIMITS.maxUnitsPerAccount),
  /** Omitted (undefined) in member-facing responses. */
  contacts: z.array(zAccountContact).max(LIMITS.maxContactsPerAccount).optional(),
  active: z.boolean(),
});
export type Account = z.infer<typeof zAccount>;

export const zAccountUnitInput = zAccountUnit.omit({ id: true }).extend({ id: zId.optional() });
export const zAccountContactInput = zAccountContact.omit({ id: true }).extend({ id: zId.optional() });
export const zAccountCreateInput = z.object({
  name: zAccount.shape.name,
  accountNumber: zAccount.shape.accountNumber.optional(),
  aliases: zAccount.shape.aliases.optional(),
  domains: zAccount.shape.domains.optional(),
  ownerId: zId.nullable().optional(),
  isPriority: z.boolean().optional(),
});
export const zAccountUpdateInput = z
  .object({
    name: zAccount.shape.name,
    accountNumber: zAccount.shape.accountNumber,
    aliases: zAccount.shape.aliases,
    domains: zAccount.shape.domains,
    ownerId: zId.nullable(),
    isPriority: z.boolean(),
    units: z.array(zAccountUnitInput).max(LIMITS.maxUnitsPerAccount),
    contacts: z.array(zAccountContactInput).max(LIMITS.maxContactsPerAccount),
    wall: zWallCode,
    active: z.boolean(),
  })
  .partial();
export type AccountCreateInput = z.infer<typeof zAccountCreateInput>;
export type AccountUpdateInput = z.infer<typeof zAccountUpdateInput>;

// ---------- orders ----------
export const zOpening = z.object({
  id: zId,
  state: z.enum(OPENING_STATES),
  /** null when open. Required for tentative/committed/started. */
  initials: zInitials.nullable(),
  /** Pipeline candidate occupying this line, if any. */
  candidateId: zId.nullable(),
  startDate: zDayKey.nullable(),
  /** User id of the person who last wrote on this line (drives marker color). */
  writtenBy: zId.nullable(),
  updatedAt: zIso,
});
export type Opening = z.infer<typeof zOpening>;

export const zOrder = zAudited.extend({
  id: zId,
  branchId: zId,
  accountId: zId,
  unitId: zId.nullable(),
  site: zShort.default(''),
  role: z.string().trim().min(1).max(LIMITS.maxShortText),
  roleCategory: z.enum(ROLE_CATEGORY_IDS),
  shift: z.string().trim().max(LIMITS.maxShiftText).default(''),
  days: zShort.default(''),
  hours: zShort.default(''),
  /** Hourly pay rate in USD, > 0. */
  payRate: z.number().positive().max(LIMITS.maxPayRate).nullable(),
  note: z.string().trim().max(LIMITS.maxNote).default(''),
  isPriority: z.boolean(),
  status: z.enum(ORDER_STATUSES),
  pause: z.object({ reason: z.string().trim().max(200), at: zIso, by: zId, resumeOn: zDayKey.nullable() }).nullable(),
  close: z.object({ reason: z.enum(ORDER_CLOSE_REASONS), note: z.string().trim().max(500), at: zIso, by: zId }).nullable(),
  openings: z.array(zOpening).min(1).max(LIMITS.maxOpeningsPerOrder),
  source: z.enum(['manual', 'email']),
  sourceTaskId: zId.nullable(),
  sourceMessageId: z.string().max(512).nullable(),
});
export type Order = z.infer<typeof zOrder>;

export const zOrderCreateInput = z.object({
  accountId: zId,
  unitId: zId.nullable().optional(),
  site: zShort.optional(),
  role: zOrder.shape.role,
  roleCategory: z.enum(ROLE_CATEGORY_IDS).optional(),
  shift: zOrder.shape.shift.optional(),
  days: zShort.optional(),
  hours: zShort.optional(),
  payRate: zOrder.shape.payRate.optional(),
  note: zOrder.shape.note.optional(),
  isPriority: z.boolean().optional(),
  openingCount: z.number().int().min(1).max(LIMITS.maxOpeningsPerOrder),
});
export const zOrderUpdateInput = z
  .object({
    accountId: zId,
    unitId: zId.nullable(),
    site: zShort,
    role: zOrder.shape.role,
    roleCategory: z.enum(ROLE_CATEGORY_IDS),
    shift: zOrder.shape.shift,
    days: zShort,
    hours: zShort,
    payRate: zOrder.shape.payRate,
    note: zOrder.shape.note,
    isPriority: z.boolean(),
  })
  .partial();
/** Member action: write on a line. state 'open' clears the line (initials/startDate/candidateId reset). */
export const zOpeningUpdateInput = z.object({
  state: z.enum(OPENING_STATES),
  initials: zInitials.nullable().optional(),
  startDate: zDayKey.nullable().optional(),
});
export const zOrderPauseInput = z.object({ reason: z.string().trim().max(200).default(''), resumeOn: zDayKey.nullable().optional() });
export const zOrderCloseInput = z.object({ reason: z.enum(ORDER_CLOSE_REASONS), note: z.string().trim().max(500).default('') });
export const zAddOpeningsInput = z.object({ count: z.number().int().min(1).max(50) });
export type OrderCreateInput = z.infer<typeof zOrderCreateInput>;
export type OrderUpdateInput = z.infer<typeof zOrderUpdateInput>;
export type OpeningUpdateInput = z.infer<typeof zOpeningUpdateInput>;
export type OrderPauseInput = z.infer<typeof zOrderPauseInput>;
export type OrderCloseInput = z.infer<typeof zOrderCloseInput>;

// ---------- pipeline ----------
export const zStageEvent = z.object({
  stage: z.enum(PIPELINE_STAGE_IDS),
  at: zIso,
  by: zId,
  note: z.string().trim().max(500).default(''),
  dropReason: z.enum(DROP_REASONS).nullable().default(null),
});
export type StageEvent = z.infer<typeof zStageEvent>;

export const zCandidate = zAudited.extend({
  id: zId,
  branchId: zId,
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).default(''),
  initials: zInitials,
  phone: z.string().trim().max(30).default(''),
  email: z.union([zEmail, z.literal('')]).default(''),
  /** User id of the recruiter working this candidate. */
  recruiterId: zId.nullable(),
  stage: z.enum(PIPELINE_STAGE_IDS),
  /** Account the candidate is in process for (may be set without a specific order). */
  accountId: zId.nullable(),
  /** Tentative fill: a specific opening on a specific order. Both set or both null. */
  orderId: zId.nullable(),
  openingId: zId.nullable(),
  startDate: zDayKey.nullable(),
  notes: z.string().trim().max(LIMITS.maxNote).default(''),
  history: z.array(zStageEvent).max(200),
  status: z.enum(['active', 'archived']),
});
export type Candidate = z.infer<typeof zCandidate>;

export const zCandidateCreateInput = z.object({
  firstName: zCandidate.shape.firstName,
  lastName: z.string().trim().max(60).optional(),
  initials: zInitials.optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.union([zEmail, z.literal('')]).optional(),
  recruiterId: zId.nullable().optional(),
  stage: z.enum(PIPELINE_STAGE_IDS).optional(),
  accountId: zId.nullable().optional(),
  notes: z.string().trim().max(LIMITS.maxNote).optional(),
});
export const zCandidateUpdateInput = z
  .object({
    firstName: zCandidate.shape.firstName,
    lastName: z.string().trim().max(60),
    initials: zInitials,
    phone: z.string().trim().max(30),
    email: z.union([zEmail, z.literal('')]),
    recruiterId: zId.nullable(),
    accountId: zId.nullable(),
    startDate: zDayKey.nullable(),
    notes: z.string().trim().max(LIMITS.maxNote),
  })
  .partial();
export const zCandidateStageInput = z.object({
  stage: z.enum(PIPELINE_STAGE_IDS),
  note: z.string().trim().max(500).optional(),
  dropReason: z.enum(DROP_REASONS).optional(),
  startDate: zDayKey.nullable().optional(),
});
/** Tentatively fill an opening. If openingId omitted, the server picks the first open line. */
export const zCandidateLinkInput = z.object({ orderId: zId, openingId: zId.optional() });
export type CandidateCreateInput = z.infer<typeof zCandidateCreateInput>;
export type CandidateUpdateInput = z.infer<typeof zCandidateUpdateInput>;
export type CandidateStageInput = z.infer<typeof zCandidateStageInput>;
export type CandidateLinkInput = z.infer<typeof zCandidateLinkInput>;

// ---------- tasks (mail-driven work) ----------
export const zRoutingCandidate = z.object({ accountId: zId, unitId: zId.nullable(), reason: z.string().max(200) });
export const zRouting = z.object({
  status: z.enum(['matched', 'ambiguous', 'unmatched', 'manual']),
  candidates: z.array(zRoutingCandidate).max(10),
});
export type Routing = z.infer<typeof zRouting>;

export const zStaffingRequest = z.object({
  role: z.string().max(LIMITS.maxShortText),
  roleCategory: z.enum(ROLE_CATEGORY_IDS),
  /** Exact headcount when the email states one number; null for ranges/vague counts. */
  headcount: z.number().int().min(1).max(LIMITS.maxOpeningsPerOrder).nullable(),
  headcountText: z.string().max(100),
  shift: z.string().max(LIMITS.maxShiftText),
  days: z.string().max(LIMITS.maxShortText),
  hours: z.string().max(LIMITS.maxShortText),
  payRate: z.number().positive().max(LIMITS.maxPayRate).nullable(),
  startDate: zDayKey.nullable(),
  site: z.string().max(LIMITS.maxShortText),
  notes: z.string().max(LIMITS.maxNote),
  /** Why no order was auto-created, when applicable. */
  blockedReason: z.string().max(200).nullable(),
});
export type StaffingRequest = z.infer<typeof zStaffingRequest>;

export const zTaskEmail = z.object({
  mailboxId: zId,
  conversationId: z.string().max(512),
  fromAddress: z.string().max(254),
  fromName: z.string().max(200),
  subject: z.string().max(500),
  receivedAt: zIso,
  webLink: z.string().max(2048).nullable(),
  messageCount: z.number().int().min(1),
  lastMessageAt: zIso,
});

export const zTask = zAudited.extend({
  id: zId,
  /** Partition: a branch id, or 'personal:<userId>' for private tasks. */
  scopeId: zId,
  scope: z.enum(['branch', 'personal']),
  /** Branch id for branch tasks; null for personal. */
  branchId: zId.nullable(),
  /** Owner of a personal task; null for branch tasks. */
  ownerUserId: zId.nullable(),
  boardDate: zDayKey,
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2000).default(''),
  category: z.enum(TASK_CATEGORY_IDS),
  categorySource: z.enum(['auto', 'manual']),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  assigneeId: zId.nullable(),
  accountId: zId.nullable(),
  unitId: zId.nullable(),
  routing: zRouting,
  email: zTaskEmail.nullable(),
  deadline: zIso.nullable(),
  staffingRequest: zStaffingRequest.nullable(),
  orderId: zId.nullable(),
  completedAt: zIso.nullable(),
  completedBy: zId.nullable(),
  closedByReply: z
    .object({ at: zIso, fromAddress: z.string().max(254), excerpt: z.string().max(500), reason: z.string().max(300) })
    .nullable(),
});
export type Task = z.infer<typeof zTask>;

export const zTaskCreateInput = z.object({
  title: zTask.shape.title,
  summary: z.string().trim().max(2000).optional(),
  category: z.enum(TASK_CATEGORY_IDS).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeId: zId.nullable().optional(),
  accountId: zId.nullable().optional(),
  unitId: zId.nullable().optional(),
});
export const zTaskUpdateInput = z
  .object({
    title: zTask.shape.title,
    summary: z.string().trim().max(2000),
    /** null restores automatic category. */
    category: z.enum(TASK_CATEGORY_IDS).nullable(),
    priority: z.enum(TASK_PRIORITIES),
    assigneeId: zId.nullable(),
    accountId: zId.nullable(),
    unitId: zId.nullable(),
  })
  .partial();
export type TaskCreateInput = z.infer<typeof zTaskCreateInput>;
export type TaskUpdateInput = z.infer<typeof zTaskUpdateInput>;

export const zEmailMessage = z.object({
  id: zId,
  scopeId: zId,
  taskId: zId.nullable(),
  mailboxId: zId,
  conversationId: z.string().max(512),
  internetMessageId: z.string().max(512),
  direction: z.enum(['inbound', 'outbound']),
  fromAddress: z.string().max(254),
  fromName: z.string().max(200),
  to: z.array(z.string().max(254)).max(100),
  cc: z.array(z.string().max(254)).max(100),
  subject: z.string().max(500),
  /** Sanitized new-content text only (quoted history removed), capped. */
  bodyText: z.string().max(LIMITS.maxEmailBodyChars),
  receivedAt: zIso,
  webLink: z.string().max(2048).nullable(),
  /** Model decision summary for this message (audit trail). */
  decision: z.string().max(500),
});
export type EmailMessage = z.infer<typeof zEmailMessage>;

/** Non-actionable mail kept briefly so misclassifications are reviewable. */
export const zFilteredMail = z.object({
  id: zId,
  scopeId: zId,
  mailboxId: zId,
  fromAddress: z.string().max(254),
  fromName: z.string().max(200),
  subject: z.string().max(500),
  excerpt: z.string().max(500),
  receivedAt: zIso,
  reason: z.string().max(300),
  stage: z.enum(['prefilter', 'model']),
  promotedTaskId: zId.nullable(),
});
export type FilteredMail = z.infer<typeof zFilteredMail>;

// ---------- mailboxes ----------
export const zMailbox = zAudited.extend({
  id: zId,
  address: zEmail,
  kind: z.enum(['branch', 'personal']),
  /** Branch mailboxes: the branch(es) it serves. One mailbox serving several branches needs routing by account. */
  branchIds: z.array(zId).max(20),
  /** Personal mailboxes: owning user. */
  userId: zId.nullable(),
  brand: z.string().trim().max(60).default(''),
  enabled: z.boolean(),
  /**
   * When the mailbox was last switched on (server-written). Mail sync never backfills before this.
   * Null while disabled, and on records written before the field existed (sync then uses updatedAt).
   */
  enabledAt: zIso.nullable().default(null),
  /** Status of Graph access, last sync and error (server-written). */
  status: z.enum(['pending', 'ok', 'no_access', 'error', 'disabled']),
  lastSyncAt: zIso.nullable(),
  lastError: z.string().max(500).nullable(),
});
export type Mailbox = z.infer<typeof zMailbox>;
export const zMailboxCreateInput = z.object({
  address: zEmail,
  branchIds: z.array(zId).min(1).max(20),
  brand: z.string().trim().max(60).optional(),
  enabled: z.boolean().optional(),
});
export const zMailboxUpdateInput = z
  .object({ branchIds: z.array(zId).min(1).max(20), brand: z.string().trim().max(60), enabled: z.boolean() })
  .partial();
export type MailboxCreateInput = z.infer<typeof zMailboxCreateInput>;
export type MailboxUpdateInput = z.infer<typeof zMailboxUpdateInput>;

// ---------- wall displays ----------
export const zDisplay = zAudited.extend({
  id: zId,
  branchId: zId,
  name: z.string().trim().min(1).max(60),
  /** First 6 chars of the token, for identification only. The token itself is never stored. */
  tokenPrefix: z.string().max(12),
  lastSeenAt: zIso.nullable(),
  revokedAt: zIso.nullable(),
});
export type Display = z.infer<typeof zDisplay>;
export const zDisplayClaimInput = z.object({
  /** Pairing code shown on the TV, e.g. "K7Q-29M" (dash optional, case-insensitive). */
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/),
  name: zDisplay.shape.name,
});
export type DisplayClaimInput = z.infer<typeof zDisplayClaimInput>;

// ---------- audit ----------
export const zAuditEvent = z.object({
  id: zId,
  branchId: zId,
  entity: z.enum(['order', 'candidate', 'account', 'task', 'branch', 'user', 'display', 'mailbox']),
  entityId: zId,
  action: z.string().max(60),
  actorId: zId.nullable(),
  at: zIso,
  summary: z.string().max(500),
});
export type AuditEvent = z.infer<typeof zAuditEvent>;

// ---------- account import ----------
export const zAccountImportInput = z.object({
  apply: z.boolean().default(false),
  accounts: z
    .array(
      z.object({
        name: zAccount.shape.name,
        accountNumber: z.string().trim().max(50).optional(),
        sourceId: z.string().trim().max(100).optional(),
        parentAccountId: zId.optional(),
        existingId: zId.optional(),
      }),
    )
    .min(1)
    .max(1000),
});
export type AccountImportInput = z.infer<typeof zAccountImportInput>;
