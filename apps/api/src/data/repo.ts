/**
 * Repository interface: intent-level operations, not generic CRUD. Route handlers depend only on
 * this interface. DocumentRepo implements it once over a DocStore; MemoryRepo and CosmosRepo
 * differ only in the store they pass in.
 *
 * Every `update*` takes a mutator that receives the current version and returns the next one.
 * The mutator may run more than once (optimistic-concurrency retries) and must be pure.
 */
import type {
  Account,
  AuditEvent,
  Branch,
  Candidate,
  Display,
  EmailMessage,
  FilteredMail,
  Mailbox,
  Media,
  Order,
  OrderStatus,
  Task,
  User,
  Whiteboard,
} from '@branchsuite/shared';

export type Mutator<T> = (current: T) => T | Promise<T>;

/** Wall pairing handshake (directory container, TTL LIMITS.wallPairingTtlSeconds). */
export interface Pairing {
  id: string;
  /** Normalized code without dash, e.g. "K7Q29M". */
  code: string;
  /** sha256 hex of the device's polling secret. */
  secretHash: string;
  status: 'waiting' | 'claimed';
  createdAt: string;
  expiresAt: string;
  claim: {
    displayId: string;
    branchId: string;
    branchName: string;
    /** Display token encrypted with AES-256-GCM (key derived from the wall secret). */
    tokenCiphertext: string;
  } | null;
}

export type OrderQuery =
  /** Every order that is not closed (draft, active, paused). */
  | { open: true }
  /** Orders in one status, optionally updated on/after an ISO timestamp. Newest first. */
  | { status: OrderStatus; updatedSince?: string; limit?: number };

export interface TaskDayQuery {
  /** Board day key being viewed. */
  date: string;
  /** Completed-at window (ISO, inclusive start / exclusive end) that safely covers `date` in any time zone. */
  completedFrom: string;
  completedTo: string;
}

export interface PipelineChange<R> {
  candidate: Candidate;
  /** Orders changed by this operation (same branch partition). */
  orders: Order[];
  result: R;
}

export interface Repo {
  // ----- branches -----
  listBranches(): Promise<Branch[]>;
  getBranch(id: string): Promise<Branch | null>;
  createBranch(branch: Branch): Promise<Branch>;
  updateBranch(id: string, fn: Mutator<Branch>): Promise<Branch>;

  // ----- roster -----
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  findUserByEntraOid(oid: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  /** 409 conflict when the id already exists. */
  createUser(user: User): Promise<User>;
  updateUser(id: string, fn: Mutator<User>): Promise<User>;

  // ----- wall displays -----
  listDisplays(branchId: string): Promise<Display[]>;
  getDisplay(id: string): Promise<Display | null>;
  findDisplayByTokenHash(tokenHash: string): Promise<Display | null>;
  createDisplay(display: Display, tokenHash: string): Promise<Display>;
  updateDisplay(id: string, fn: Mutator<Display>): Promise<Display>;

  // ----- mailboxes -----
  listMailboxes(): Promise<Mailbox[]>;
  getMailbox(id: string): Promise<Mailbox | null>;
  findMailboxByAddress(address: string): Promise<Mailbox | null>;
  findPersonalMailbox(userId: string): Promise<Mailbox | null>;
  createMailbox(mailbox: Mailbox): Promise<Mailbox>;
  updateMailbox(id: string, fn: Mutator<Mailbox>): Promise<Mailbox>;

  // ----- wall pairing -----
  createPairing(pairing: Pairing, ttlSeconds: number): Promise<Pairing>;
  getPairing(id: string): Promise<Pairing | null>;
  findWaitingPairingByCode(code: string, nowIso: string): Promise<Pairing | null>;
  countActivePairings(nowIso: string): Promise<number>;
  updatePairing(id: string, fn: Mutator<Pairing>): Promise<Pairing>;
  /**
   * Delete the pairing when `accept` approves its current version and return that version.
   * The delete carries an ETag precondition, so exactly one concurrent caller receives it.
   */
  takePairing(id: string, accept: (pairing: Pairing) => boolean): Promise<Pairing | null>;

  // ----- orders -----
  listOrders(branchId: string, query: OrderQuery): Promise<Order[]>;
  getOrder(branchId: string, id: string): Promise<Order | null>;
  createOrder(order: Order): Promise<Order>;
  updateOrder(branchId: string, id: string, fn: Mutator<Order>): Promise<Order>;

  // ----- accounts -----
  listAccounts(branchId: string): Promise<Account[]>;
  getAccount(branchId: string, id: string): Promise<Account | null>;
  createAccount(account: Account): Promise<Account>;
  updateAccount(branchId: string, id: string, fn: Mutator<Account>): Promise<Account>;

  // ----- candidates -----
  listCandidates(branchId: string, status: Candidate['status']): Promise<Candidate[]>;
  getCandidate(branchId: string, id: string): Promise<Candidate | null>;
  createCandidate(candidate: Candidate): Promise<Candidate>;
  updateCandidate(branchId: string, id: string, fn: Mutator<Candidate>): Promise<Candidate>;
  /**
   * Change a candidate and the order(s) whose lines it occupies in ONE transactional batch with
   * ETag preconditions on every document. `loadOrder` reads an order inside the transaction.
   */
  mutatePipeline<R>(
    branchId: string,
    candidateId: string,
    fn: (candidate: Candidate, loadOrder: (orderId: string) => Promise<Order | null>) => Promise<PipelineChange<R>>,
  ): Promise<R>;

  // ----- tasks -----
  /** Open tasks (any date) plus tasks with boardDate = date or completed inside the window. */
  listTasksForDay(scopeId: string, query: TaskDayQuery): Promise<Task[]>;
  listOpenTasks(scopeId: string): Promise<Task[]>;
  getTask(scopeId: string, id: string): Promise<Task | null>;
  createTask(task: Task): Promise<Task>;
  updateTask(scopeId: string, id: string, fn: Mutator<Task>): Promise<Task>;
  /** Create an order from a branch task and link the task to it, atomically. */
  createOrderForTask(branchId: string, taskId: string, build: (task: Task) => { task: Task; order: Order }): Promise<{ task: Task; order: Order }>;

  // ----- whiteboards (board container, id wb_<branchId>_<date>) -----
  /** Boards with from <= date <= to, ascending by date. */
  listWhiteboards(branchId: string, from: string, to: string): Promise<Whiteboard[]>;
  getWhiteboard(branchId: string, date: string): Promise<Whiteboard | null>;
  /** Create or replace atomically; `fn` receives the current board (null when none) and may run more than once. */
  upsertWhiteboard(branchId: string, date: string, fn: (current: Whiteboard | null) => Whiteboard | Promise<Whiteboard>): Promise<Whiteboard>;
  /** 404 when the board does not exist. */
  updateWhiteboard(branchId: string, date: string, fn: Mutator<Whiteboard>): Promise<Whiteboard>;
  /** Create a branch task and write the board that links it, in ONE transactional batch. */
  createTaskForWhiteboard(branchId: string, date: string, build: (current: Whiteboard) => { whiteboard: Whiteboard; task: Task }): Promise<{ whiteboard: Whiteboard; task: Task }>;

  // ----- whiteboard media metadata (bytes live in the MediaStore) -----
  getMedia(branchId: string, id: string): Promise<Media | null>;
  findMediaBySha256(branchId: string, sha256: string): Promise<Media | null>;
  createMedia(media: Media): Promise<Media>;

  // ----- audit -----
  addEvent(event: AuditEvent): Promise<void>;
  listEvents(scopeId: string, entity: AuditEvent['entity'], entityId: string): Promise<AuditEvent[]>;

  // ----- mail (read side used by routes; ingest lives in src/mail) -----
  listMessages(scopeId: string, taskId: string): Promise<EmailMessage[]>;
  listFiltered(scopeId: string): Promise<FilteredMail[]>;
  updateFiltered(scopeId: string, id: string, fn: Mutator<FilteredMail>): Promise<FilteredMail>;
}
