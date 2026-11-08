/**
 * The one Repo implementation, written against DocStore. Owns the document layout of
 * ARCHITECTURE §3: container, partition value, `type` discriminator and TTL per entity, and strips
 * storage-only fields (Cosmos system properties, `type`, `pk`, `ttl`, secrets) from what it returns.
 */
import {
  LIMITS,
  type Account,
  type AuditEvent,
  type Branch,
  type Candidate,
  type Display,
  type EmailMessage,
  type FilteredMail,
  type Mailbox,
  type Media,
  type Order,
  type Task,
  type User,
  type Whiteboard,
  WHITEBOARD_LIMITS,
} from '@branchsuite/shared';
import { HttpError } from '../http/errors.js';
import type { Mutator, OrderQuery, Pairing, PipelineChange, Repo, TaskDayQuery } from './repo.js';
import { AlreadyExistsError, PARTITION_FIELD, type ContainerName, type Doc, type DocStore, type Filter } from './store.js';
import { conflictError, mutate, transact } from './transaction.js';

/** Cosmos system properties plus our storage-only fields. Never returned by the API. */
const STORAGE_FIELDS = ['_rid', '_self', '_ts', '_attachments', '_etag', 'type', 'pk', 'ttl'] as const;

interface Kind {
  container: ContainerName;
  type: string;
  /** Entity has its own `scopeId` field (kept on read); otherwise the partition field is storage-only. */
  scopeIsEntityField?: boolean;
  /** Additional storage-only fields (e.g. secrets) stripped on read. */
  hidden?: readonly string[];
  ttlSeconds?: number;
}

const K = {
  branch: { container: 'directory', type: 'branch' },
  user: { container: 'directory', type: 'user' },
  display: { container: 'directory', type: 'display', hidden: ['tokenHash'] },
  mailbox: { container: 'directory', type: 'mailbox' },
  pairing: { container: 'directory', type: 'pairing' },
  order: { container: 'board', type: 'order' },
  account: { container: 'board', type: 'account' },
  candidate: { container: 'board', type: 'candidate' },
  task: { container: 'board', type: 'task', scopeIsEntityField: true },
  event: { container: 'board', type: 'event', ttlSeconds: LIMITS.auditTtlSeconds },
  whiteboard: { container: 'board', type: 'whiteboard' },
  media: { container: 'board', type: 'media', ttlSeconds: WHITEBOARD_LIMITS.mediaRetentionDays * 86_400 },
  message: { container: 'mail', type: 'message', scopeIsEntityField: true },
  filtered: { container: 'mail', type: 'filtered', scopeIsEntityField: true, ttlSeconds: LIMITS.filteredMailTtlSeconds },
} as const satisfies Record<string, Kind>;

/** Directory documents partition by their type name (`pk = 'user'`, ...). */
function partitionFor(kind: Kind, scope: string | undefined): string {
  if (kind.container === 'directory') return kind.type;
  if (!scope) throw new Error(`${kind.type} requires a scope`);
  return scope;
}

export function toDoc<T extends { id: string }>(kind: Kind, entity: T, scope?: string, extra: Record<string, unknown> = {}, ttlSeconds?: number): Doc {
  const field = PARTITION_FIELD[kind.container];
  const ttl = ttlSeconds ?? kind.ttlSeconds;
  return { ...entity, ...extra, type: kind.type, [field]: partitionFor(kind, scope), ...(ttl ? { ttl } : {}) };
}

export function fromDoc<T>(kind: Kind, doc: Doc): T {
  const out: Record<string, unknown> = { ...doc };
  for (const f of STORAGE_FIELDS) delete out[f];
  for (const f of kind.hidden ?? []) delete out[f];
  if (kind.container !== 'directory' && !kind.scopeIsEntityField) delete out.scopeId;
  return out as T;
}

export class DocumentRepo implements Repo {
  /** Exposed for modules that own additional document types (mail ingest). */
  constructor(readonly store: DocStore) {}

  // ---------- generic helpers ----------
  private async getOne<T>(kind: Kind, scope: string | undefined, id: string): Promise<T | null> {
    const found = await this.store.read(kind.container, partitionFor(kind, scope), id);
    return found && found.doc.type === kind.type ? fromDoc<T>(kind, found.doc) : null;
  }

  private async list<T>(kind: Kind, scope: string | undefined, filters: Filter[] = [], extra: { orderBy?: { field: string; desc?: boolean }; limit?: number } = {}): Promise<T[]> {
    const docs = await this.store.query(kind.container, {
      type: kind.type,
      ...(scope !== undefined || kind.container === 'directory' ? { partition: partitionFor(kind, scope) } : {}),
      filters,
      ...extra,
    });
    return docs.map((d) => fromDoc<T>(kind, d));
  }

  private async first<T>(kind: Kind, scope: string | undefined, filters: Filter[]): Promise<T | null> {
    return (await this.list<T>(kind, scope, filters, { limit: 1 }))[0] ?? null;
  }

  private async insert<T extends { id: string }>(kind: Kind, entity: T, scope?: string, extra?: Record<string, unknown>, ttl?: number): Promise<T> {
    try {
      await this.store.create(kind.container, toDoc(kind, entity, scope, extra, ttl));
    } catch (err) {
      if (err instanceof AlreadyExistsError) throw new HttpError(409, 'conflict', `That ${kind.type} already exists.`);
      throw err;
    }
    return entity;
  }

  private async change<T extends { id: string }>(kind: Kind, scope: string | undefined, id: string, fn: Mutator<T>): Promise<T> {
    const doc = await mutate(
      this.store,
      kind.container,
      partitionFor(kind, scope),
      id,
      async (current) => {
        if (current.type !== kind.type) throw new HttpError(404, 'not_found', `No such ${kind.type}.`);
        const next = await fn(fromDoc<T>(kind, current));
        if (next.id !== id) throw new Error('A mutator must not change the id');
        // Keep hidden storage fields (e.g. tokenHash) and TTL from the current document.
        const kept: Record<string, unknown> = {};
        for (const f of kind.hidden ?? []) kept[f] = current[f];
        return toDoc(kind, next, scope, kept, typeof current.ttl === 'number' ? current.ttl : undefined);
      },
      `No such ${kind.type}.`,
    );
    return fromDoc<T>(kind, doc);
  }

  // ---------- branches ----------
  listBranches() { return this.list<Branch>(K.branch, undefined); }
  getBranch(id: string) { return this.getOne<Branch>(K.branch, undefined, id); }
  createBranch(branch: Branch) { return this.insert(K.branch, branch); }
  updateBranch(id: string, fn: Mutator<Branch>) { return this.change(K.branch, undefined, id, fn); }

  // ---------- users ----------
  listUsers() { return this.list<User>(K.user, undefined); }
  getUser(id: string) { return this.getOne<User>(K.user, undefined, id); }
  findUserByEntraOid(oid: string) { return this.first<User>(K.user, undefined, [{ field: 'entraOid', op: '=', value: oid }]); }
  findUserByEmail(email: string) {
    return this.first<User>(K.user, undefined, [{ field: 'email', op: '=', value: email.trim().toLowerCase() }]);
  }
  createUser(user: User) { return this.insert(K.user, user); }
  updateUser(id: string, fn: Mutator<User>) { return this.change(K.user, undefined, id, fn); }

  // ---------- displays ----------
  listDisplays(branchId: string) { return this.list<Display>(K.display, undefined, [{ field: 'branchId', op: '=', value: branchId }]); }
  getDisplay(id: string) { return this.getOne<Display>(K.display, undefined, id); }
  findDisplayByTokenHash(tokenHash: string) {
    return this.first<Display>(K.display, undefined, [{ field: 'tokenHash', op: '=', value: tokenHash }]);
  }
  createDisplay(display: Display, tokenHash: string) { return this.insert(K.display, display, undefined, { tokenHash }); }
  updateDisplay(id: string, fn: Mutator<Display>) { return this.change(K.display, undefined, id, fn); }

  // ---------- mailboxes ----------
  listMailboxes() { return this.list<Mailbox>(K.mailbox, undefined); }
  getMailbox(id: string) { return this.getOne<Mailbox>(K.mailbox, undefined, id); }
  findMailboxByAddress(address: string) {
    return this.first<Mailbox>(K.mailbox, undefined, [{ field: 'address', op: '=', value: address.trim().toLowerCase() }]);
  }
  findPersonalMailbox(userId: string) {
    return this.first<Mailbox>(K.mailbox, undefined, [
      { field: 'kind', op: '=', value: 'personal' },
      { field: 'userId', op: '=', value: userId },
    ]);
  }
  createMailbox(mailbox: Mailbox) { return this.insert(K.mailbox, mailbox); }
  updateMailbox(id: string, fn: Mutator<Mailbox>) { return this.change(K.mailbox, undefined, id, fn); }

  // ---------- pairing ----------
  createPairing(pairing: Pairing, ttlSeconds: number) { return this.insert(K.pairing, pairing, undefined, {}, ttlSeconds); }
  getPairing(id: string) { return this.getOne<Pairing>(K.pairing, undefined, id); }
  findWaitingPairingByCode(code: string, nowIso: string) {
    return this.first<Pairing>(K.pairing, undefined, [
      { field: 'code', op: '=', value: code },
      { field: 'status', op: '=', value: 'waiting' },
      { field: 'expiresAt', op: '>', value: nowIso },
    ]);
  }
  countActivePairings(nowIso: string) {
    return this.store.count(K.pairing.container, {
      type: K.pairing.type,
      partition: K.pairing.type,
      filters: [{ field: 'expiresAt', op: '>', value: nowIso }],
    });
  }
  updatePairing(id: string, fn: Mutator<Pairing>) { return this.change(K.pairing, undefined, id, fn); }
  async takePairing(id: string, accept: (pairing: Pairing) => boolean): Promise<Pairing | null> {
    try {
      return await transact(this.store, K.pairing.container, K.pairing.type, async (tx) => {
        const doc = await tx.get(id);
        if (!doc || doc.type !== K.pairing.type) return { writes: [], result: null };
        const pairing = fromDoc<Pairing>(K.pairing, doc);
        if (!accept(pairing)) return { writes: [], result: null };
        return { writes: [], deletes: [id], result: pairing };
      });
    } catch (err) {
      // Lost every race for this pairing: another poll consumed it.
      if (err instanceof HttpError && err.code === 'conflict') return null;
      throw err;
    }
  }

  // ---------- orders ----------
  listOrders(branchId: string, query: OrderQuery) {
    if ('open' in query) return this.list<Order>(K.order, branchId, [{ field: 'status', op: '!=', value: 'closed' }]);
    const filters: Filter[] = [{ field: 'status', op: '=', value: query.status }];
    if (query.updatedSince) filters.push({ field: 'updatedAt', op: '>=', value: query.updatedSince });
    return this.list<Order>(K.order, branchId, filters, { orderBy: { field: 'updatedAt', desc: true }, ...(query.limit ? { limit: query.limit } : {}) });
  }
  getOrder(branchId: string, id: string) { return this.getOne<Order>(K.order, branchId, id); }
  createOrder(order: Order) { return this.insert(K.order, order, order.branchId); }
  updateOrder(branchId: string, id: string, fn: Mutator<Order>) { return this.change(K.order, branchId, id, fn); }

  // ---------- accounts ----------
  listAccounts(branchId: string) { return this.list<Account>(K.account, branchId); }
  getAccount(branchId: string, id: string) { return this.getOne<Account>(K.account, branchId, id); }
  createAccount(account: Account) { return this.insert(K.account, account, account.branchId); }
  updateAccount(branchId: string, id: string, fn: Mutator<Account>) { return this.change(K.account, branchId, id, fn); }

  // ---------- candidates ----------
  listCandidates(branchId: string, status: Candidate['status']) {
    return this.list<Candidate>(K.candidate, branchId, [{ field: 'status', op: '=', value: status }]);
  }
  getCandidate(branchId: string, id: string) { return this.getOne<Candidate>(K.candidate, branchId, id); }
  createCandidate(candidate: Candidate) { return this.insert(K.candidate, candidate, candidate.branchId); }
  updateCandidate(branchId: string, id: string, fn: Mutator<Candidate>) { return this.change(K.candidate, branchId, id, fn); }

  mutatePipeline<R>(
    branchId: string,
    candidateId: string,
    fn: (candidate: Candidate, loadOrder: (orderId: string) => Promise<Order | null>) => Promise<PipelineChange<R>>,
  ): Promise<R> {
    return transact(this.store, 'board', branchId, async (tx) => {
      const doc = await tx.get(candidateId);
      if (!doc || doc.type !== K.candidate.type) throw new HttpError(404, 'not_found', 'No such candidate.');
      const loaded = new Map<string, Order | null>();
      const loadOrder = async (orderId: string) => {
        if (!loaded.has(orderId)) {
          const d = await tx.get(orderId);
          loaded.set(orderId, d && d.type === K.order.type ? fromDoc<Order>(K.order, d) : null);
        }
        return structuredClone(loaded.get(orderId) ?? null);
      };
      const change = await fn(fromDoc<Candidate>(K.candidate, doc), loadOrder);
      for (const order of change.orders) {
        if (!loaded.get(order.id)) throw new Error('mutatePipeline may only write orders it loaded');
      }
      return {
        writes: [toDoc(K.candidate, change.candidate, branchId), ...change.orders.map((o) => toDoc(K.order, o, branchId))],
        result: change.result,
      };
    });
  }

  // ---------- tasks ----------
  async listTasksForDay(scopeId: string, query: TaskDayQuery): Promise<Task[]> {
    const [open, sameDay, completed] = await Promise.all([
      this.list<Task>(K.task, scopeId, [{ field: 'status', op: '=', value: 'open' }]),
      this.list<Task>(K.task, scopeId, [{ field: 'boardDate', op: '=', value: query.date }]),
      this.list<Task>(K.task, scopeId, [
        { field: 'completedAt', op: '>=', value: query.completedFrom },
        { field: 'completedAt', op: '<', value: query.completedTo },
      ]),
    ]);
    const byId = new Map<string, Task>();
    for (const t of [...open, ...sameDay, ...completed]) byId.set(t.id, t);
    return [...byId.values()];
  }
  listOpenTasks(scopeId: string) { return this.list<Task>(K.task, scopeId, [{ field: 'status', op: '=', value: 'open' }]); }
  getTask(scopeId: string, id: string) { return this.getOne<Task>(K.task, scopeId, id); }
  createTask(task: Task) { return this.insert(K.task, task, task.scopeId); }
  updateTask(scopeId: string, id: string, fn: Mutator<Task>) { return this.change(K.task, scopeId, id, fn); }

  createOrderForTask(branchId: string, taskId: string, build: (task: Task) => { task: Task; order: Order }) {
    return transact(this.store, 'board', branchId, async (tx) => {
      const doc = await tx.get(taskId);
      if (!doc || doc.type !== K.task.type) throw new HttpError(404, 'not_found', 'No such task.');
      const { task, order } = build(fromDoc<Task>(K.task, doc));
      if (task.id !== taskId || order.branchId !== branchId) throw new Error('createOrderForTask built an inconsistent pair');
      if (await tx.get(order.id)) throw conflictError();
      return { writes: [toDoc(K.task, task, branchId), toDoc(K.order, order, branchId)], result: { task, order } };
    });
  }

  // ---------- whiteboards ----------
  listWhiteboards(branchId: string, from: string, to: string) {
    return this.list<Whiteboard>(
      K.whiteboard,
      branchId,
      [
        { field: 'date', op: '>=', value: from },
        { field: 'date', op: '<=', value: to },
      ],
      { orderBy: { field: 'date' } },
    );
  }
  getWhiteboard(branchId: string, date: string) { return this.getOne<Whiteboard>(K.whiteboard, branchId, whiteboardId(branchId, date)); }

  upsertWhiteboard(branchId: string, date: string, fn: (current: Whiteboard | null) => Whiteboard | Promise<Whiteboard>): Promise<Whiteboard> {
    const id = whiteboardId(branchId, date);
    return transact(this.store, 'board', branchId, async (tx) => {
      const doc = await tx.get(id);
      if (doc && doc.type !== K.whiteboard.type) throw new Error(`Document ${id} is not a whiteboard`);
      const next = await fn(doc ? fromDoc<Whiteboard>(K.whiteboard, doc) : null);
      assertBoardIdentity(next, branchId, date);
      return { writes: [toDoc(K.whiteboard, next, branchId)], result: next };
    });
  }

  updateWhiteboard(branchId: string, date: string, fn: Mutator<Whiteboard>) {
    return this.change<Whiteboard>(K.whiteboard, branchId, whiteboardId(branchId, date), async (current) => {
      const next = await fn(current);
      assertBoardIdentity(next, branchId, date);
      return next;
    });
  }

  createTaskForWhiteboard(branchId: string, date: string, build: (current: Whiteboard) => { whiteboard: Whiteboard; task: Task }) {
    const id = whiteboardId(branchId, date);
    return transact(this.store, 'board', branchId, async (tx) => {
      const doc = await tx.get(id);
      if (!doc || doc.type !== K.whiteboard.type) throw new HttpError(404, 'not_found', 'No whiteboard for that date.');
      const { whiteboard, task } = build(fromDoc<Whiteboard>(K.whiteboard, doc));
      assertBoardIdentity(whiteboard, branchId, date);
      if (task.scopeId !== branchId || task.branchId !== branchId) throw new Error('createTaskForWhiteboard built a task for another scope');
      if (await tx.get(task.id)) throw conflictError();
      return { writes: [toDoc(K.whiteboard, whiteboard, branchId), toDoc(K.task, task, branchId)], result: { whiteboard, task } };
    });
  }

  // ---------- media ----------
  getMedia(branchId: string, id: string) { return this.getOne<Media>(K.media, branchId, id); }
  findMediaBySha256(branchId: string, sha256: string) {
    return this.first<Media>(K.media, branchId, [{ field: 'sha256', op: '=', value: sha256 }]);
  }
  createMedia(media: Media) { return this.insert(K.media, media, media.branchId); }

  // ---------- audit ----------
  async addEvent(event: AuditEvent): Promise<void> {
    await this.insert(K.event, event, event.branchId);
  }
  listEvents(scopeId: string, entity: AuditEvent['entity'], entityId: string) {
    return this.list<AuditEvent>(
      K.event,
      scopeId,
      [
        { field: 'entity', op: '=', value: entity },
        { field: 'entityId', op: '=', value: entityId },
      ],
      { orderBy: { field: 'at', desc: true }, limit: 200 },
    );
  }

  // ---------- mail ----------
  listMessages(scopeId: string, taskId: string) {
    return this.list<EmailMessage>(K.message, scopeId, [{ field: 'taskId', op: '=', value: taskId }], { orderBy: { field: 'receivedAt' } });
  }
  listFiltered(scopeId: string) {
    return this.list<FilteredMail>(K.filtered, scopeId, [], { orderBy: { field: 'receivedAt', desc: true }, limit: 500 });
  }
  updateFiltered(scopeId: string, id: string, fn: Mutator<FilteredMail>) { return this.change(K.filtered, scopeId, id, fn); }
}

export { K as DOC_KINDS };

/** Deterministic: one board per branch per day. */
export function whiteboardId(branchId: string, date: string): string {
  return `wb_${branchId}_${date}`;
}

function assertBoardIdentity(wb: Whiteboard, branchId: string, date: string): void {
  if (wb.id !== whiteboardId(branchId, date) || wb.branchId !== branchId || wb.date !== date) {
    throw new Error('A whiteboard mutator must not change its id, branch or date');
  }
}
