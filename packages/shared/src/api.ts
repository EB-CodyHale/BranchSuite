/**
 * HTTP API contract. All routes are under /api. JSON in, JSON out.
 *
 * Auth
 * - Staff routes: Azure Static Web Apps (Entra ID, single tenant) forwards `x-ms-client-principal`.
 *   The API maps the principal to an active roster user; unknown or inactive users get 403 `not_provisioned`.
 * - Wall routes (/api/wall/*): anonymous at the SWA layer; authenticated by `x-display-token`.
 *   Wall responses contain ONLY coded data produced by `toWallFeed` — never names, rates or contacts
 *   unless the branch wall settings explicitly allow it.
 *
 * Errors: non-2xx responses return ApiError. Optimistic concurrency conflicts return 409 `conflict`.
 *
 * Route table (method path -> request body -> response):
 *   GET    /health                                              -> { ok: true, version }
 *   GET    /me                                                  -> MeResponse
 *   PATCH  /me/preferences          Partial<UserPreferences>    -> User
 *   GET    /me/mail                                             -> PersonalMailStatus
 *   POST   /me/mail/connect                                     -> PersonalMailStatus
 *   POST   /me/mail/disconnect                                  -> PersonalMailStatus
 *
 *   GET    /branches                                            -> Branch[]           (visible to caller; admin: all)
 *   POST   /branches                BranchCreateInput           -> Branch             (admin)
 *   PATCH  /branches/:b             BranchUpdateInput           -> Branch             (admin; manager of :b may change wall + settings only)
 *
 *   GET    /users?branchId=                                     -> PersonLite[] | User[] (members: lite of shared branches; managers/admin: full)
 *   POST   /users                   UserCreateInput             -> User               (admin; manager for own branches, role member|manager)
 *   PATCH  /users/:id               UserUpdateInput             -> User               (admin; manager for users in own branches, cannot grant admin)
 *
 *   GET    /board?branches=a,b                                  -> BoardResponse      (orders not closed + accounts + people)
 *   GET    /branches/:b/orders?status=closed&since=             -> Order[]            (history)
 *   POST   /branches/:b/orders      OrderCreateInput            -> Order              (manager)
 *   PATCH  /branches/:b/orders/:id  OrderUpdateInput            -> Order              (manager)
 *   POST   /branches/:b/orders/:id/openings        AddOpeningsInput  -> Order        (manager)
 *   DELETE /branches/:b/orders/:id/openings/:oid                     -> Order        (manager; only open/tentative-without-candidate lines)
 *   PUT    /branches/:b/orders/:id/openings/:oid   OpeningUpdateInput -> Order       (member)
 *   POST   /branches/:b/orders/:id/pause           OrderPauseInput   -> Order        (manager)
 *   POST   /branches/:b/orders/:id/resume                            -> Order        (manager)
 *   POST   /branches/:b/orders/:id/close           OrderCloseInput   -> Order        (manager)
 *   POST   /branches/:b/orders/:id/reopen                            -> Order        (manager)
 *   POST   /branches/:b/orders/:id/publish                           -> Order        (manager; draft -> active)
 *   GET    /branches/:b/orders/:id/history                           -> AuditEvent[]
 *
 *   GET    /branches/:b/accounts                                -> Account[]          (contacts only for managers)
 *   POST   /branches/:b/accounts    AccountCreateInput          -> Account            (manager)
 *   PATCH  /branches/:b/accounts/:id AccountUpdateInput         -> Account            (manager)
 *   POST   /branches/:b/accounts/rotate-wall-codes              -> Account[]          (manager)
 *   POST   /branches/:b/accounts/import AccountImportInput      -> AccountImportPlan  (admin)
 *   POST   /branches/:b/routing/test RoutingTestInput           -> RoutingTestResult  (manager)
 *   GET    /branches/:b/wall/legend                             -> WallLegend         (staff only)
 *   GET    /branches/:b/wall/preview                            -> WallFeed           (staff; exactly what the TV sees)
 *
 *   GET    /branches/:b/candidates?status=active                -> Candidate[]
 *   POST   /branches/:b/candidates  CandidateCreateInput        -> Candidate
 *   PATCH  /branches/:b/candidates/:id CandidateUpdateInput     -> Candidate
 *   POST   /branches/:b/candidates/:id/stage CandidateStageInput -> CandidateMutationResult
 *   POST   /branches/:b/candidates/:id/link  CandidateLinkInput  -> CandidateMutationResult
 *   DELETE /branches/:b/candidates/:id/link                      -> CandidateMutationResult
 *   POST   /branches/:b/candidates/:id/archive                   -> Candidate
 *
 *   GET    /tasks?view=branch|personal|combined&branches=a,b&date=YYYY-MM-DD -> TasksResponse
 *   POST   /branches/:b/tasks       TaskCreateInput             -> Task
 *   PATCH  /tasks/:scopeId/:id      TaskUpdateInput             -> Task
 *   POST   /tasks/:scopeId/:id/claim                            -> Task
 *   POST   /tasks/:scopeId/:id/complete                         -> Task
 *   POST   /tasks/:scopeId/:id/reopen                           -> Task
 *   GET    /tasks/:scopeId/:id/messages                         -> EmailMessage[]     (on demand; owner-only for personal)
 *   POST   /tasks/:scopeId/:id/create-order TaskOrderInput      -> { task: Task, order: Order } (manager; branch tasks only)
 *   POST   /branches/:b/tasks/reassign  { fromUserId, toUserId|null } -> { moved: number } (manager)
 *
 *   GET    /mailboxes                                           -> Mailbox[]          (admin; managers see own branches)
 *   POST   /mailboxes               MailboxCreateInput          -> Mailbox            (admin)
 *   PATCH  /mailboxes/:id           MailboxUpdateInput          -> Mailbox            (admin)
 *   POST   /mailboxes/:id/sync                                  -> { queued: true }   (admin)
 *   GET    /branches/:b/mail/filtered                           -> FilteredMail[]     (manager)
 *   POST   /mail/filtered/:scopeId/:id/promote                  -> Task               (manager; owner for personal)
 *
 *   GET    /branches/:b/displays                                -> Display[]          (manager)
 *   POST   /branches/:b/displays/claim DisplayClaimInput        -> Display            (manager)
 *   POST   /branches/:b/displays/:id/revoke                     -> Display            (manager)
 *
 *   POST   /realtime/negotiate                                  -> RealtimeNegotiateResponse (staff; groups = caller's branches + own user)
 *
 *   -- anonymous at SWA; display-token or pairing-secret authenticated --
 *   POST   /wall/pair/start                                     -> WallPairStartResponse
 *   GET    /wall/pair/:pairingId   header x-pairing-secret      -> WallPairPollResponse
 *   GET    /wall/feed              header x-display-token       -> WallFeed
 *   POST   /wall/negotiate         header x-display-token       -> RealtimeNegotiateResponse (group = wall:<branchId> only)
 */
import type { MarkerId, OpeningState, RoleCategory, WallColorId, WallGlyph } from './constants.js';
import type {
  Account,
  Branch,
  Candidate,
  Order,
  PersonLite,
  Routing,
  StaffingRequest,
  Task,
  User,
  WallSettings,
} from './schemas.js';

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'not_provisioned'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'upstream_error'
  | 'internal';

export interface ApiError {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

export interface Permissions {
  /** Branch ids the caller can read operational data for. Admins: every active branch. */
  branchIds: string[];
  /** Branch ids where the caller has manager powers (admin: all). */
  manageBranchIds: string[];
  isAdmin: boolean;
}

export interface MeResponse {
  user: User;
  branches: Branch[];
  permissions: Permissions;
  features: { pipeline: boolean; personalMail: boolean; realtime: boolean };
}

/** Account as seen on the board (no contacts). */
export type AccountLite = Omit<Account, 'contacts'>;

export interface BoardResponse {
  generatedAt: string;
  orders: Order[];
  accounts: AccountLite[];
  people: PersonLite[];
  /** Today's day key per branch (branch time zone). */
  today: Record<string, string>;
}

export interface TasksResponse {
  generatedAt: string;
  /** Open tasks (all dates, carried) + tasks completed on `date`, for the requested view. */
  tasks: Task[];
  date: string;
  isToday: boolean;
}

export interface TaskOrderInput {
  /** Overrides for fields extracted from the email; the manager confirms before creating. */
  accountId: string;
  unitId?: string | null;
  role: string;
  roleCategory?: RoleCategory;
  shift?: string;
  days?: string;
  hours?: string;
  payRate?: number | null;
  openingCount: number;
  note?: string;
}

export interface CandidateMutationResult {
  candidate: Candidate;
  /** The order whose opening changed, if any (both the old and new order when relinking). */
  orders: Order[];
}

export interface RoutingTestInput {
  fromAddress: string;
  subject?: string;
  body?: string;
}
export interface RoutingTestResult {
  routing: Routing;
  explanation: string[];
}

export interface AccountImportPlanRow {
  name: string;
  action: 'create' | 'update' | 'unchanged' | 'error';
  accountId: string | null;
  message: string;
}
export interface AccountImportPlan {
  applied: boolean;
  rows: AccountImportPlanRow[];
  counts: { create: number; update: number; unchanged: number; error: number };
}

export interface PersonalMailStatus {
  connected: boolean;
  address: string | null;
  status: 'not_connected' | 'pending' | 'ok' | 'no_access' | 'error' | 'disabled';
  lastSyncAt: string | null;
  lastError: string | null;
  /** Shown when status is 'no_access': what an admin must do (add to the mail scope group). */
  help: string | null;
}

export interface RealtimeNegotiateResponse {
  /** Azure Web PubSub client URL including access token; null when realtime is disabled. */
  url: string | null;
  /** Suggested fallback polling interval in seconds. */
  pollSeconds: number;
}

/** Message pushed to clients. Contains no business data — clients refetch. */
export interface RealtimeMessage {
  type: 'invalidate';
  scopeId: string;
  entities: Array<'orders' | 'accounts' | 'candidates' | 'tasks' | 'people' | 'branch' | 'wall'>;
  at: string;
}

// ---------- wall ----------
export interface WallClientCode {
  code: string;
  color: WallColorId;
  glyph: WallGlyph;
}

export interface WallOpening {
  state: OpeningState;
  /** Initials only when candidateDisplay = 'initials'; otherwise null. */
  mark: string | null;
  /** Committed with a start date within LIMITS.startingSoonDays. */
  startsSoon: boolean;
}

export interface WallOrder {
  /** Opaque key, stable for the order but not the database id. */
  key: string;
  client: WallClientCode | null;
  /** Present only when clientDisplay = 'name'. */
  clientName: string | null;
  /** role text (roleDisplay 'full') or category label (roleDisplay 'category'). */
  role: string;
  roleCategory: RoleCategory;
  shift: string;
  /** "M-F · 6:00a-2:30p" when showSchedule; else null. */
  schedule: string | null;
  /** "$19.50/hr", band label like "$$", or null. */
  pay: string | null;
  location: string | null;
  isPriority: boolean;
  paused: boolean;
  owner: { marker: MarkerId; initials: string | null } | null;
  openings: WallOpening[];
  toFill: number;
}

export interface WallFeed {
  branch: { name: string; timeZone: string };
  generatedAt: string;
  today: string;
  settings: Pick<WallSettings, 'theme' | 'pageSeconds' | 'headline' | 'candidateDisplay' | 'payDisplay' | 'clientDisplay'>;
  totals: { orders: number; openings: number; toFill: number; startingSoon: number };
  orders: WallOrder[];
}

export interface WallLegendEntry extends WallClientCode {
  accountId: string;
  name: string;
}
export interface WallLegend {
  branchId: string;
  entries: WallLegendEntry[];
}

export interface WallPairStartResponse {
  pairingId: string;
  /** Shown on the TV for a manager to type in, "K7Q-29M". */
  code: string;
  /** Returned only to the device; required to poll. */
  secret: string;
  expiresAt: string;
}
export type WallPairPollResponse =
  | { status: 'waiting'; expiresAt: string }
  | { status: 'paired'; displayToken: string; displayId: string; branchName: string }
  | { status: 'expired' };

// ---------- path builders (web client) ----------
const enc = encodeURIComponent;
export const paths = {
  me: () => '/api/me',
  mePreferences: () => '/api/me/preferences',
  meMail: (action?: 'connect' | 'disconnect') => (action ? `/api/me/mail/${action}` : '/api/me/mail'),
  branches: () => '/api/branches',
  branch: (b: string) => `/api/branches/${enc(b)}`,
  users: (branchId?: string) => (branchId ? `/api/users?branchId=${enc(branchId)}` : '/api/users'),
  user: (id: string) => `/api/users/${enc(id)}`,
  board: (branchIds: string[]) => `/api/board?branches=${branchIds.map(enc).join(',')}`,
  orders: (b: string, q?: { status?: string; since?: string }) =>
    `/api/branches/${enc(b)}/orders` + (q ? `?${new URLSearchParams(q as Record<string, string>).toString()}` : ''),
  order: (b: string, id: string) => `/api/branches/${enc(b)}/orders/${enc(id)}`,
  orderAction: (b: string, id: string, action: 'pause' | 'resume' | 'close' | 'reopen' | 'publish' | 'openings' | 'history') =>
    `/api/branches/${enc(b)}/orders/${enc(id)}/${action}`,
  opening: (b: string, id: string, oid: string) => `/api/branches/${enc(b)}/orders/${enc(id)}/openings/${enc(oid)}`,
  accounts: (b: string) => `/api/branches/${enc(b)}/accounts`,
  account: (b: string, id: string) => `/api/branches/${enc(b)}/accounts/${enc(id)}`,
  rotateWallCodes: (b: string) => `/api/branches/${enc(b)}/accounts/rotate-wall-codes`,
  importAccounts: (b: string) => `/api/branches/${enc(b)}/accounts/import`,
  routingTest: (b: string) => `/api/branches/${enc(b)}/routing/test`,
  wallLegend: (b: string) => `/api/branches/${enc(b)}/wall/legend`,
  wallPreview: (b: string) => `/api/branches/${enc(b)}/wall/preview`,
  candidates: (b: string, status?: 'active' | 'archived') =>
    `/api/branches/${enc(b)}/candidates` + (status ? `?status=${status}` : ''),
  candidate: (b: string, id: string) => `/api/branches/${enc(b)}/candidates/${enc(id)}`,
  candidateAction: (b: string, id: string, action: 'stage' | 'link' | 'archive') =>
    `/api/branches/${enc(b)}/candidates/${enc(id)}/${action}`,
  tasks: (q: { view: 'branch' | 'personal' | 'combined'; branches: string[]; date?: string }) =>
    `/api/tasks?view=${q.view}&branches=${q.branches.map(enc).join(',')}` + (q.date ? `&date=${q.date}` : ''),
  branchTasks: (b: string) => `/api/branches/${enc(b)}/tasks`,
  reassignTasks: (b: string) => `/api/branches/${enc(b)}/tasks/reassign`,
  task: (scopeId: string, id: string) => `/api/tasks/${enc(scopeId)}/${enc(id)}`,
  taskAction: (scopeId: string, id: string, action: 'claim' | 'complete' | 'reopen' | 'messages' | 'create-order') =>
    `/api/tasks/${enc(scopeId)}/${enc(id)}/${action}`,
  mailboxes: () => '/api/mailboxes',
  mailbox: (id: string) => `/api/mailboxes/${enc(id)}`,
  mailboxSync: (id: string) => `/api/mailboxes/${enc(id)}/sync`,
  filteredMail: (b: string) => `/api/branches/${enc(b)}/mail/filtered`,
  promoteFiltered: (scopeId: string, id: string) => `/api/mail/filtered/${enc(scopeId)}/${enc(id)}/promote`,
  displays: (b: string) => `/api/branches/${enc(b)}/displays`,
  claimDisplay: (b: string) => `/api/branches/${enc(b)}/displays/claim`,
  revokeDisplay: (b: string, id: string) => `/api/branches/${enc(b)}/displays/${enc(id)}/revoke`,
  realtimeNegotiate: () => '/api/realtime/negotiate',
  wallPairStart: () => '/api/wall/pair/start',
  wallPairPoll: (pairingId: string) => `/api/wall/pair/${enc(pairingId)}`,
  wallFeed: () => '/api/wall/feed',
  wallNegotiate: () => '/api/wall/negotiate',
} as const;

export type { StaffingRequest };
