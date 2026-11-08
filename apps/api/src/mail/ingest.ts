/**
 * Per-message pipeline (ARCHITECTURE §7 steps 1-8).
 *
 *  1. Receipt: idempotency on sha256(mailboxId|graphId). A replay is skipped (a changed payload is logged).
 *  2. Prefilter: auto-replies, NDRs, no-reply senders, empty mail -> FilteredMail (inbox only).
 *  3. Direction: SentItems, the mailbox itself, tenant or branch internal domains -> team (outbound).
 *  4. Content: sanitized uniqueBody, capped.
 *  5. Thread: the OPEN task for conversationId in the candidate scopes (any boardDate: carry-over).
 *  6. Route: deterministic routeEmail across all the mailbox's branches (branch scope only).
 *  7. Classify: triage (new thread) / followup (inbound on open task) / reply (team mail on open task).
 *  8. Write: task (+ draft order in ONE transactional batch), message, thread link, receipt LAST, notify.
 *
 * Personal mailboxes use the partition personal:<userId>: no routing, no orders, no reply closure.
 * Nothing here logs addresses, subjects or bodies at info level.
 */
import {
  DEFAULT_TIME_ZONE,
  effectiveOwnerId,
  effectivePriority,
  maxPriority,
  newId,
  newOpening,
  routeEmail,
  todayKey,
  type Account,
  type Branch,
  type EmailMessage,
  type FilteredMail,
  type Mailbox,
  type Order,
  type RealtimeMessage,
  type Routing,
  type StaffingRequest,
  type Task,
  type User,
} from '@branchsuite/shared';
import type { Config } from '../config.js';
import { DOC_KINDS, fromDoc, toDoc } from '../data/documentRepo.js';
import type { Repo } from '../data/repo.js';
import { AlreadyExistsError, type DocStore } from '../data/store.js';
import { transact } from '../data/transaction.js';
import type { Logger } from '../log.js';
import { groups, type Publisher } from '../realtime/publisher.js';
import { sha256Hex } from '../security/crypto.js';
import type { Classifier, TriageResult } from './classify.js';
import type { GraphMessage, MailFolder } from './graph.js';
import { MailStore } from './mailStore.js';
import { prefilter } from './prefilter.js';
import type { PromptInput } from './prompts.js';
import { excerpt, sanitizeBody } from './sanitize.js';

export const PERSONAL_PREFIX = 'personal:';

export interface IngestDeps {
  config: Config;
  repo: Repo;
  store: DocStore;
  mailStore: MailStore;
  classifier: Classifier;
  publisher: Publisher;
  log: Logger;
  now: () => Date;
}

export type IngestOutcome =
  | 'ignored'
  | 'duplicate'
  | 'before_enable'
  | 'filtered'
  | 'team_no_task'
  | 'task_created'
  | 'task_updated'
  | 'reply_closed'
  | 'reply_open'
  | 'no_scope';

export interface IngestResult {
  outcome: IngestOutcome;
  scopeId: string | null;
  taskId: string | null;
  orderId: string | null;
}

export interface IngestOptions {
  /** Messages received before this instant are skipped without a receipt (no history backfill). */
  processAfter?: string;
  /** Per-run read cache shared by every message of one sync run. */
  cache?: IngestCache;
}

/** Read cache for one sync run: branches, accounts and the roster change rarely within a run. */
export class IngestCache {
  private readonly branches = new Map<string, Promise<Branch | null>>();
  private readonly accounts = new Map<string, Promise<Account[]>>();
  private users: Promise<User[]> | null = null;

  constructor(private readonly repo: Repo) {}

  branch(id: string): Promise<Branch | null> {
    let p = this.branches.get(id);
    if (!p) this.branches.set(id, (p = this.repo.getBranch(id)));
    return p;
  }
  accountsOf(branchId: string): Promise<Account[]> {
    let p = this.accounts.get(branchId);
    if (!p) this.accounts.set(branchId, (p = this.repo.listAccounts(branchId)));
    return p;
  }
  roster(): Promise<User[]> {
    this.users ??= this.repo.listUsers();
    return this.users;
  }
}

interface Normalized {
  graphId: string;
  internetMessageId: string;
  conversationId: string;
  fromAddress: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  receivedAt: string;
  webLink: string | null;
  headers: Array<{ name: string; value: string }>;
  payloadHash: string;
}

const clip = (s: string | null | undefined, max: number) => (s ?? '').trim().slice(0, max);

function normalizeIso(value: string | null | undefined, fallback: Date): string {
  const ms = value ? Date.parse(value) : Number.NaN;
  return new Date(Number.isNaN(ms) ? fallback.getTime() : ms).toISOString();
}

function recipients(list: GraphMessage['toRecipients']): string[] {
  return (list ?? [])
    .map((r) => clip(r.emailAddress?.address, 254).toLowerCase())
    .filter(Boolean)
    .slice(0, 100);
}

export function normalizeMessage(msg: GraphMessage, now: Date): Normalized {
  const fromAddress = clip(msg.from?.emailAddress?.address, 254).toLowerCase();
  const subject = clip(msg.subject, 500);
  const receivedAt = normalizeIso(msg.receivedDateTime ?? msg.sentDateTime, now);
  const internetMessageId = clip(msg.internetMessageId, 512) || `graph:${msg.id}`.slice(0, 512);
  const link = clip(msg.webLink, 2048);
  return {
    graphId: msg.id,
    internetMessageId,
    conversationId: clip(msg.conversationId, 512),
    fromAddress,
    fromName: clip(msg.from?.emailAddress?.name, 200),
    to: recipients(msg.toRecipients),
    cc: recipients(msg.ccRecipients),
    subject,
    receivedAt,
    webLink: link.startsWith('https://') ? link : null,
    headers: (msg.internetMessageHeaders ?? []).filter((h) => typeof h?.name === 'string' && typeof h?.value === 'string'),
    payloadHash: sha256Hex(`${internetMessageId}|${subject}|${receivedAt}|${fromAddress}`),
  };
}

const domainOf = (address: string) => (address.includes('@') ? address.slice(address.lastIndexOf('@') + 1) : '');
const hashId = (prefix: string, ...parts: string[]) => `${prefix}_${sha256Hex(parts.join('|'))}`;
/** Deterministic id of the draft order created from one email in one scope (ARCHITECTURE §7). */
export const emailOrderId = (scopeId: string, internetMessageId: string) => hashId('eo', scopeId, internetMessageId);

interface ScopeInfo {
  scopeId: string;
  kind: 'branch' | 'personal';
  branch: Branch | null;
  owner: User | null;
  timeZone: string;
}

interface RouteDecision {
  scope: ScopeInfo;
  routing: Routing;
  account: Account | null;
  accountsById: Map<string, Account>;
}

/** Process one Graph message. Safe to call again with the same message (idempotent). */
export async function ingestMessage(
  deps: IngestDeps,
  mailbox: Mailbox,
  folder: MailFolder,
  msg: GraphMessage,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const none = (outcome: IngestOutcome, scopeId: string | null = null): IngestResult => ({ outcome, scopeId, taskId: null, orderId: null });
  if (msg['@removed'] || msg.isDraft || !msg.id) return none('ignored');

  const now = deps.now();
  const nowIso = now.toISOString();
  const cache = options.cache ?? new IngestCache(deps.repo);
  const m = normalizeMessage(msg, now);

  // 1. Receipt.
  const receipt = await deps.mailStore.getReceipt(mailbox.id, m.graphId);
  if (receipt) {
    if (receipt.payloadHash !== m.payloadHash) deps.log.warn('Mail message changed after it was processed; skipped', { mailboxId: mailbox.id, receipt: receipt.id });
    return none('duplicate', receipt.targetScopeId);
  }
  if (options.processAfter && m.receivedAt < options.processAfter) return none('before_enable');

  const finish = async (result: IngestResult): Promise<IngestResult> => {
    await deps.mailStore.putReceipt({
      mailboxId: mailbox.id,
      graphId: m.graphId,
      payloadHash: m.payloadHash,
      outcome: result.outcome,
      targetScopeId: result.scopeId,
      taskId: result.taskId,
      at: nowIso,
    });
    deps.log.info('Mail message processed', { mailboxId: mailbox.id, folder, outcome: result.outcome, taskId: result.taskId, orderId: result.orderId });
    return result;
  };

  // Candidate scopes.
  const scopes = await candidateScopes(deps, cache, mailbox);
  if (scopes.length === 0) return finish(none('no_scope'));
  const personal = mailbox.kind === 'personal';

  // 3. Direction.
  const internalDomains = new Set<string>(deps.config.tenantDomains);
  for (const s of scopes) for (const d of s.branch?.settings.internalDomains ?? []) internalDomains.add(d.toLowerCase());
  const isSelf = m.fromAddress === mailbox.address.toLowerCase();
  const isTeam = folder === 'sentitems' || isSelf || (!personal && internalDomains.has(domainOf(m.fromAddress)));

  // 4. Content.
  const body = sanitizeBody(msg);

  // 5. Thread.
  const thread = await findOpenThreadTask(deps, scopes, m.conversationId);

  // 2. Prefilter (needs the sanitized body for the empty-message rule).
  const filtered = prefilter({ fromAddress: m.fromAddress, subject: m.subject, body, headers: m.headers });
  if (filtered) {
    if (folder === 'sentitems' || isSelf) return finish(none('ignored'));
    const scope = thread ? thread.scope : (await decideRoute(deps, cache, scopes, m, body, internalDomains)).scope;
    await saveFiltered(deps, mailbox, scope.scopeId, m, body, filtered.reason, 'prefilter');
    return finish(none('filtered', scope.scopeId));
  }

  const promptBase = (scope: ScopeInfo, task?: Task): PromptInput => ({
    email: { fromName: m.fromName, fromAddress: m.fromAddress, subject: m.subject, receivedAt: m.receivedAt, body },
    mailboxKind: personal ? 'personal' : 'branch',
    today: todayKey(scope.timeZone, now),
    timeZone: scope.timeZone,
    ...(task ? { task: { title: task.title, summary: task.summary, priority: task.priority, deadline: task.deadline } } : {}),
  });

  // 7/8 for an open thread task.
  if (thread) {
    const { scope, task } = thread;
    if (isTeam) {
      if (personal) return finish(none('ignored', scope.scopeId));
      const { result, source } = await deps.classifier.reply(promptBase(scope, task));
      let closed = false;
      const updated = await deps.repo.updateTask(scope.scopeId, task.id, (t) => {
        const next = countMessage(t, m.receivedAt, nowIso);
        closed = result.resolves && t.status === 'open';
        if (!closed) return next;
        return {
          ...next,
          status: 'reply_closed',
          completedAt: m.receivedAt,
          completedBy: null,
          closedByReply: { at: m.receivedAt, fromAddress: m.fromAddress, excerpt: excerpt(body, 500), reason: result.reason.slice(0, 300) },
        };
      });
      await saveMessage(deps, mailbox, scope.scopeId, updated.id, m, body, 'outbound', `${source}: ${result.resolves ? 'resolves' : 'does not resolve'} — ${result.reason}`);
      notify(deps, scope.scopeId, ['tasks'], false);
      return finish({ outcome: closed ? 'reply_closed' : 'reply_open', scopeId: scope.scopeId, taskId: updated.id, orderId: null });
    }
    const { result, source } = await deps.classifier.followup(promptBase(scope, task));
    const updated = await deps.repo.updateTask(scope.scopeId, task.id, (t) => {
      const next = countMessage(t, m.receivedAt, nowIso);
      return {
        ...next,
        // Escalation only: maxPriority never lowers a priority. Status is never changed by inbound mail.
        priority: maxPriority(t.priority, result.priority),
        summary: result.summaryUpdate ? result.summaryUpdate.slice(0, 2000) : t.summary,
        deadline: result.deadline ?? t.deadline,
      };
    });
    await saveMessage(deps, mailbox, scope.scopeId, updated.id, m, body, 'inbound', `${source}: follow-up${result.escalate ? ', escalated' : ''}`);
    notify(deps, scope.scopeId, ['tasks'], false);
    return finish({ outcome: 'task_updated', scopeId: scope.scopeId, taskId: updated.id, orderId: null });
  }

  // No open task: team mail out of the shared box is not new work.
  if (folder === 'sentitems' || isSelf) return finish(none('team_no_task'));

  // 6. Route.
  const route = await decideRoute(deps, cache, scopes, m, body, internalDomains);
  const { scope } = route;

  // 7. Triage.
  const { result, source } = await deps.classifier.triage(promptBase(scope));
  const hint = result.accountHint ? ` Suggested account (unverified): ${result.accountHint}.` : '';
  if (!result.actionable) {
    await saveFiltered(deps, mailbox, scope.scopeId, m, body, `${result.reason || 'No action needed'}`.slice(0, 300), 'model');
    return finish(none('filtered', scope.scopeId));
  }

  // 8. Create the task (and maybe a draft order).
  const created = await createTask(deps, cache, mailbox, scope, route, m, result, now);
  await saveMessage(deps, mailbox, scope.scopeId, created.task.id, m, body, isTeam ? 'outbound' : 'inbound', `${source}: new task — ${result.reason}.${hint}`);
  await deps.mailStore.putThread({ scopeId: scope.scopeId, conversationId: m.conversationId, taskId: created.task.id, mailboxId: mailbox.id, updatedAt: nowIso });
  if (created.order) {
    await deps.repo
      .addEvent({
        id: newId('evt'),
        branchId: scope.scopeId,
        entity: 'order',
        entityId: created.order.id,
        action: 'create',
        actorId: null,
        at: nowIso,
        summary: `Created a ${created.order.status} order (${created.order.openings.length} openings) from email`,
      })
      .catch((err: unknown) => deps.log.warn('Audit write failed', { error: String(err) }));
  }
  notify(deps, scope.scopeId, created.order ? ['tasks', 'orders'] : ['tasks'], created.order !== null);
  return finish({ outcome: 'task_created', scopeId: scope.scopeId, taskId: created.task.id, orderId: created.order?.id ?? null });
}

// ---------- scopes, threads and routing ----------
async function candidateScopes(deps: IngestDeps, cache: IngestCache, mailbox: Mailbox): Promise<ScopeInfo[]> {
  if (mailbox.kind === 'personal') {
    if (!mailbox.userId) return [];
    const owner = (await cache.roster()).find((u) => u.id === mailbox.userId) ?? null;
    if (!owner || !owner.active) return [];
    const home = owner.branchIds[0] ? await cache.branch(owner.branchIds[0]) : null;
    return [{ scopeId: `${PERSONAL_PREFIX}${owner.id}`, kind: 'personal', branch: null, owner, timeZone: home?.timeZone ?? DEFAULT_TIME_ZONE }];
  }
  const out: ScopeInfo[] = [];
  for (const id of mailbox.branchIds) {
    const branch = await cache.branch(id);
    if (branch && branch.active) out.push({ scopeId: branch.id, kind: 'branch', branch, owner: null, timeZone: branch.timeZone });
  }
  return out;
}

async function findOpenThreadTask(deps: IngestDeps, scopes: ScopeInfo[], conversationId: string): Promise<{ scope: ScopeInfo; task: Task } | null> {
  if (!conversationId) return null;
  for (const scope of scopes) {
    const link = await deps.mailStore.getThread(scope.scopeId, conversationId);
    if (!link) continue;
    const task = await deps.repo.getTask(scope.scopeId, link.taskId);
    if (task && task.status === 'open') return { scope, task };
  }
  // Fallback for tasks created before a thread link existed: any open task in scope with this conversation.
  for (const scope of scopes) {
    const docs = await deps.store.query('board', {
      partition: scope.scopeId,
      type: DOC_KINDS.task.type,
      filters: [
        { field: 'status', op: '=', value: 'open' },
        { field: 'email.conversationId', op: '=', value: conversationId },
      ],
      limit: 1,
    });
    if (docs[0]) return { scope, task: fromDoc<Task>(DOC_KINDS.task, docs[0]) };
  }
  return null;
}

/**
 * Routing across every branch the mailbox serves. A matched account picks its branch. When nothing
 * (or several branches) match, the first branch is used and a multi-branch mailbox marks routing
 * 'ambiguous'. Candidates are limited to the chosen branch so no other branch's accounts leak.
 */
export async function decideRoute(
  deps: Pick<IngestDeps, 'repo'>,
  cache: IngestCache,
  scopes: ScopeInfo[],
  m: Pick<Normalized, 'fromAddress' | 'subject'>,
  body: string,
  internalDomains: Set<string>,
): Promise<RouteDecision> {
  const first = scopes[0] as ScopeInfo;
  if (first.kind === 'personal') return { scope: first, routing: { status: 'unmatched', candidates: [] }, account: null, accountsById: new Map() };

  const perBranch = await Promise.all(scopes.map(async (s) => ({ scope: s, accounts: await cache.accountsOf(s.scopeId) })));
  const all = perBranch.flatMap((p) => p.accounts);
  const branchOf = new Map<string, ScopeInfo>();
  for (const p of perBranch) for (const a of p.accounts) branchOf.set(a.id, p.scope);
  const accountsById = new Map(all.map((a) => [a.id, a] as const));

  const routed = routeEmail({ fromAddress: m.fromAddress, subject: m.subject, body, internalDomains: [...internalDomains] }, all).routing;
  let scope: ScopeInfo = first;
  let status = routed.status;
  if (routed.status === 'matched' && routed.candidates[0]) {
    scope = branchOf.get(routed.candidates[0].accountId) ?? first;
  } else if (scopes.length > 1) {
    const branches = new Set(routed.candidates.map((c) => branchOf.get(c.accountId)?.scopeId).filter(Boolean));
    if (branches.size === 1) {
      scope = branchOf.get(routed.candidates[0]?.accountId ?? '') ?? first;
    } else {
      status = 'ambiguous';
    }
  }
  const candidates = routed.candidates.filter((c) => branchOf.get(c.accountId)?.scopeId === scope.scopeId);
  const account = status === 'matched' && candidates[0] ? (accountsById.get(candidates[0].accountId) ?? null) : null;
  return { scope, routing: { status, candidates }, account, accountsById };
}

// ---------- writes ----------
function countMessage(task: Task, receivedAt: string, nowIso: string): Task {
  const email = task.email
    ? { ...task.email, messageCount: task.email.messageCount + 1, lastMessageAt: receivedAt > task.email.lastMessageAt ? receivedAt : task.email.lastMessageAt }
    : null;
  return { ...task, email, updatedAt: nowIso, updatedBy: null };
}

function blockedReasonFor(scope: ScopeInfo, route: RouteDecision, sr: NonNullable<TriageResult['staffingRequest']>): string | null {
  if (scope.kind === 'personal') return 'Personal mail does not create orders.';
  if (route.routing.status !== 'matched' || !route.account) return 'The client account needs review before an order is created.';
  if (route.account.reserved !== null) return 'The sender is not a client account.';
  if (sr.headcount === null) return 'The email does not state one exact headcount.';
  return null;
}

async function createTask(
  deps: IngestDeps,
  cache: IngestCache,
  mailbox: Mailbox,
  scope: ScopeInfo,
  route: RouteDecision,
  m: Normalized,
  result: TriageResult,
  now: Date,
): Promise<{ task: Task; order: Order | null }> {
  const nowIso = now.toISOString();
  const taskId = hashId('task', scope.scopeId, mailbox.id, m.graphId);
  const branch = scope.branch;
  const matched = route.routing.status === 'matched' ? route.routing.candidates[0] : undefined;
  const accountId = matched && route.account ? route.account.id : null;
  const unitId = matched && route.account ? matched.unitId : null;

  let assigneeId: string | null = null;
  if (scope.kind === 'personal') assigneeId = scope.owner?.id ?? null;
  else if (branch && route.account) {
    const people = new Map((await cache.roster()).map((u) => [u.id, u] as const));
    assigneeId = effectiveOwnerId({ branchId: branch.id, unitId }, route.account, people);
  }

  let staffingRequest: StaffingRequest | null = null;
  let wantOrder = false;
  if (result.staffingRequest) {
    const blockedReason = blockedReasonFor(scope, route, result.staffingRequest);
    staffingRequest = { ...result.staffingRequest, blockedReason };
    wantOrder = blockedReason === null;
  }

  const title = (result.title.trim() || m.subject || '(no subject)').slice(0, 200);
  const task: Task = {
    id: taskId,
    scopeId: scope.scopeId,
    scope: scope.kind,
    branchId: branch?.id ?? null,
    ownerUserId: scope.kind === 'personal' ? (scope.owner?.id ?? null) : null,
    boardDate: todayKey(scope.timeZone, now),
    title,
    summary: result.summary.slice(0, 2000),
    category: result.category,
    categorySource: 'auto',
    priority: effectivePriority({ priority: result.priority, accountId }, route.accountsById),
    status: 'open',
    assigneeId,
    accountId,
    unitId,
    routing: scope.kind === 'personal' ? { status: 'unmatched', candidates: [] } : route.routing,
    email: {
      mailboxId: mailbox.id,
      conversationId: m.conversationId,
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      subject: m.subject,
      receivedAt: m.receivedAt,
      webLink: m.webLink,
      messageCount: 1,
      lastMessageAt: m.receivedAt,
    },
    deadline: result.deadline,
    staffingRequest,
    orderId: null,
    completedAt: null,
    completedBy: null,
    closedByReply: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: null,
    updatedBy: null,
  };

  const order: Order | null =
    wantOrder && branch && route.account && staffingRequest && staffingRequest.headcount !== null
      ? buildDraftOrder(branch, route.account, unitId, taskId, m.internetMessageId, staffingRequest, staffingRequest.headcount, title, nowIso)
      : null;

  // Task and order in ONE transactional batch (same branch partition); deterministic ids make replays safe.
  return transact<{ task: Task; order: Order | null }>(deps.store, 'board', scope.scopeId, async (tx) => {
    const existing = await tx.get(taskId);
    if (existing) {
      const t = fromDoc<Task>(DOC_KINDS.task, existing);
      return { writes: [], result: { task: t, order: null } };
    }
    if (!order) return { writes: [toDoc(DOC_KINDS.task, task, scope.scopeId)], result: { task, order: null } };
    if (await tx.get(order.id)) {
      // The same email already produced an order in this branch (e.g. it reached two mailboxes).
      const linked: Task = { ...task, staffingRequest: staffingRequest ? { ...staffingRequest, blockedReason: 'An order was already created from this email.' } : null };
      return { writes: [toDoc(DOC_KINDS.task, linked, scope.scopeId)], result: { task: linked, order: null } };
    }
    const linked: Task = { ...task, orderId: order.id };
    return {
      writes: [toDoc(DOC_KINDS.task, linked, scope.scopeId), toDoc(DOC_KINDS.order, order, scope.scopeId)],
      result: { task: linked, order },
    };
  });
}

export function buildDraftOrder(
  branch: Branch,
  account: Account,
  unitId: string | null,
  taskId: string,
  internetMessageId: string,
  sr: StaffingRequest,
  headcount: number,
  fallbackRole: string,
  nowIso: string,
): Order {
  const note = [sr.notes.trim(), sr.startDate ? `Requested start: ${sr.startDate}.` : '', sr.headcountText && sr.headcountText !== String(headcount) ? `Headcount as written: ${sr.headcountText}.` : '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
  return {
    id: emailOrderId(branch.id, internetMessageId),
    branchId: branch.id,
    accountId: account.id,
    unitId,
    site: sr.site.slice(0, 200),
    role: (sr.role.trim() || fallbackRole).slice(0, 200),
    roleCategory: sr.roleCategory,
    shift: sr.shift.slice(0, 100),
    days: sr.days.slice(0, 200),
    hours: sr.hours.slice(0, 200),
    payRate: sr.payRate,
    note,
    isPriority: account.isPriority,
    status: branch.settings.autoPublishEmailOrders ? 'active' : 'draft',
    pause: null,
    close: null,
    openings: Array.from({ length: headcount }, () => newOpening(nowIso)),
    source: 'email',
    sourceTaskId: taskId,
    sourceMessageId: internetMessageId.slice(0, 512),
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: null,
    updatedBy: null,
  };
}

async function saveMessage(
  deps: IngestDeps,
  mailbox: Mailbox,
  scopeId: string,
  taskId: string,
  m: Normalized,
  body: string,
  direction: EmailMessage['direction'],
  decision: string,
): Promise<void> {
  const message: EmailMessage = {
    id: hashId('msg', mailbox.id, m.graphId),
    scopeId,
    taskId,
    mailboxId: mailbox.id,
    conversationId: m.conversationId,
    internetMessageId: m.internetMessageId,
    direction,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    bodyText: body,
    receivedAt: m.receivedAt,
    webLink: m.webLink,
    decision: decision.slice(0, 500),
  };
  try {
    await deps.store.create('mail', toDoc(DOC_KINDS.message, message, scopeId));
  } catch (err) {
    if (!(err instanceof AlreadyExistsError)) throw err;
  }
}

async function saveFiltered(
  deps: IngestDeps,
  mailbox: Mailbox,
  scopeId: string,
  m: Normalized,
  body: string,
  reason: string,
  stage: FilteredMail['stage'],
): Promise<void> {
  const filtered: FilteredMail = {
    id: hashId('flt', mailbox.id, m.graphId),
    scopeId,
    mailboxId: mailbox.id,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    subject: m.subject,
    excerpt: excerpt(body, 500),
    receivedAt: m.receivedAt,
    reason: reason.slice(0, 300),
    stage,
    promotedTaskId: null,
  };
  try {
    await deps.store.create('mail', toDoc(DOC_KINDS.filtered, filtered, scopeId));
  } catch (err) {
    if (!(err instanceof AlreadyExistsError)) throw err;
  }
}

function notify(deps: IngestDeps, scopeId: string, entities: RealtimeMessage['entities'], wall: boolean): void {
  const targets = [groups.scope(scopeId)];
  if (wall && !scopeId.startsWith(PERSONAL_PREFIX)) targets.push(groups.wall(scopeId));
  const message: RealtimeMessage = { type: 'invalidate', scopeId, entities, at: deps.now().toISOString() };
  deps.publisher.publish(targets, message).catch((err: unknown) => deps.log.warn('Realtime publish failed', { error: String(err) }));
}
