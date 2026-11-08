/**
 * TanStack Query hooks for every endpoint in @branchsuite/shared `api.ts`.
 *
 * - Reads go through `keys` (queryKeys.ts) so invalidation and reads agree.
 * - Mutations write server results straight into the caches they affect and invalidate the
 *   derived views (wall preview, history) instead of refetching the whole board.
 * - The line write (PUT opening) is optimistic: the board cache is updated with the same pure
 *   rule the API runs (`applyOpeningUpdate`) and rolled back if the server refuses.
 */
import {
  applyOpeningUpdate,
  paths,
  type Account,
  type AccountCreateInput,
  type AccountImportInput,
  type AccountImportPlan,
  type AccountUpdateInput,
  type AuditEvent,
  type BoardResponse,
  type Branch,
  type BranchCreateInput,
  type BranchUpdateInput,
  type Candidate,
  type CandidateCreateInput,
  type CandidateLinkInput,
  type CandidateMutationResult,
  type CandidateStageInput,
  type CandidateUpdateInput,
  type Display,
  type DisplayClaimInput,
  type EmailMessage,
  type FilteredMail,
  type Mailbox,
  type MailboxCreateInput,
  type MailboxUpdateInput,
  type MeResponse,
  type OpeningUpdateInput,
  type Order,
  type OrderCloseInput,
  type OrderCreateInput,
  type OrderPauseInput,
  type OrderUpdateInput,
  type PersonalMailStatus,
  type PersonLite,
  type RoutingTestInput,
  type RoutingTestResult,
  type Task,
  type TaskCreateInput,
  type TaskOrderInput,
  type TasksResponse,
  type TaskUpdateInput,
  type User,
  type UserCreateInput,
  type UserPreferences,
  type UserUpdateInput,
  type WallFeed,
  type WallLegend,
  type WallPairPollResponse,
  type WallPairStartResponse,
} from '@branchsuite/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { api, type ApiError } from './api.js';
import { boardKeyIncludes, keys, type CandidateStatus, type TaskView } from './queryKeys.js';

export { keys } from './queryKeys.js';

type QueryOpts<T> = Omit<UseQueryOptions<T, ApiError, T, QueryKey>, 'queryKey' | 'queryFn'>;

/** Managers and admins receive full User records from GET /users; members receive PersonLite. */
export type RosterEntry = PersonLite | User;
export const isFullUser = (p: RosterEntry): p is User => 'email' in p;

export const DISPLAY_TOKEN_HEADER = 'x-display-token';
export const PAIRING_SECRET_HEADER = 'x-pairing-secret';

// =====================================================================================
// cache helpers
// =====================================================================================

function replaceById<T extends { id: string }>(list: T[], item: T): T[] {
  return list.map((x) => (x.id === item.id ? item : x));
}

/** Write a server order into every board cache that shows its branch. Closed orders leave the board. */
export function upsertOrderInBoards(qc: QueryClient, order: Order): void {
  for (const [key, board] of qc.getQueriesData<BoardResponse>({ queryKey: keys.boardRoot() })) {
    if (!board || !boardKeyIncludes(key, order.branchId)) continue;
    const exists = board.orders.some((o) => o.id === order.id);
    let orders: Order[];
    if (order.status === 'closed') orders = board.orders.filter((o) => o.id !== order.id);
    else if (exists) orders = replaceById(board.orders, order);
    else orders = [...board.orders, order];
    qc.setQueryData<BoardResponse>(key, { ...board, orders });
  }
}

function upsertCandidate(qc: QueryClient, candidate: Candidate): void {
  for (const status of ['active', 'archived'] as const) {
    qc.setQueryData<Candidate[]>(keys.candidates(candidate.branchId, status), (list) => {
      if (!list) return list;
      const without = list.filter((c) => c.id !== candidate.id);
      if (candidate.status !== status) return without;
      return list.some((c) => c.id === candidate.id) ? replaceById(list, candidate) : [...without, candidate];
    });
  }
}

function applyCandidateResult(qc: QueryClient, result: CandidateMutationResult): void {
  upsertCandidate(qc, result.candidate);
  for (const order of result.orders) upsertOrderInBoards(qc, order);
  if (result.orders.length > 0) void qc.invalidateQueries({ queryKey: keys.wallPreview(result.candidate.branchId) });
}

function upsertAccount(qc: QueryClient, account: Account): void {
  qc.setQueryData<Account[]>(keys.accounts(account.branchId), (list) =>
    list ? (list.some((a) => a.id === account.id) ? replaceById(list, account) : [...list, account]) : list,
  );
}

/** Order changed: refresh board copy and the views derived from it. */
function afterOrderWrite(qc: QueryClient, order: Order): void {
  upsertOrderInBoards(qc, order);
  void qc.invalidateQueries({ queryKey: keys.ordersRoot(order.branchId) });
  void qc.invalidateQueries({ queryKey: keys.wallPreview(order.branchId) });
}

function afterTaskWrite(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: keys.tasksRoot() });
}

function useApiMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>, onSuccess?: (qc: QueryClient, data: TData, vars: TVars) => void) {
  const qc = useQueryClient();
  return useMutation<TData, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: onSuccess ? (data, vars) => onSuccess(qc, data, vars) : undefined,
  });
}

// =====================================================================================
// me
// =====================================================================================

export function useMe(options?: QueryOpts<MeResponse>) {
  return useQuery({ queryKey: keys.me(), queryFn: ({ signal }) => api.get<MeResponse>(paths.me(), { signal }), staleTime: 60_000, ...options });
}

/** PATCH /me/preferences, applied to the cached `me` immediately. */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation<User, ApiError, Partial<UserPreferences>, { previous: MeResponse | undefined }>({
    mutationFn: (prefs) => api.patch<User>(paths.mePreferences(), prefs),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: keys.me(), exact: true });
      const previous = qc.getQueryData<MeResponse>(keys.me());
      if (previous) {
        qc.setQueryData<MeResponse>(keys.me(), {
          ...previous,
          user: { ...previous.user, preferences: { ...previous.user.preferences, ...prefs } },
        });
      }
      return { previous };
    },
    onError: (_e, _prefs, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.me(), ctx.previous);
    },
    onSuccess: (user) => {
      qc.setQueryData<MeResponse>(keys.me(), (me) => (me ? { ...me, user } : me));
    },
  });
}

export function useMyMail(options?: QueryOpts<PersonalMailStatus>) {
  return useQuery({ queryKey: keys.meMail(), queryFn: ({ signal }) => api.get<PersonalMailStatus>(paths.meMail(), { signal }), ...options });
}

export function useConnectMyMail() {
  return useApiMutation<void, PersonalMailStatus>(
    () => api.post(paths.meMail('connect')),
    (qc, status) => qc.setQueryData(keys.meMail(), status),
  );
}

export function useDisconnectMyMail() {
  return useApiMutation<void, PersonalMailStatus>(
    () => api.post(paths.meMail('disconnect')),
    (qc, status) => {
      qc.setQueryData(keys.meMail(), status);
      afterTaskWrite(qc);
    },
  );
}

// =====================================================================================
// branches + users
// =====================================================================================

export function useBranches(options?: QueryOpts<Branch[]>) {
  return useQuery({ queryKey: keys.branches(), queryFn: ({ signal }) => api.get<Branch[]>(paths.branches(), { signal }), ...options });
}

export function useCreateBranch() {
  return useApiMutation<BranchCreateInput, Branch>(
    (input) => api.post(paths.branches(), input),
    (qc) => {
      void qc.invalidateQueries({ queryKey: keys.branches() });
      void qc.invalidateQueries({ queryKey: keys.me() });
    },
  );
}

export function useUpdateBranch() {
  return useApiMutation<{ branchId: string; input: BranchUpdateInput }, Branch>(
    ({ branchId, input }) => api.patch(paths.branch(branchId), input),
    (qc, branch) => {
      qc.setQueryData<Branch[]>(keys.branches(), (list) => (list ? replaceById(list, branch) : list));
      qc.setQueryData<MeResponse>(keys.me(), (me) => (me ? { ...me, branches: replaceById(me.branches, branch) } : me));
      void qc.invalidateQueries({ queryKey: keys.me() });
      void qc.invalidateQueries({ queryKey: keys.wallPreview(branch.id) });
    },
  );
}

export function useUsers(branchId?: string, options?: QueryOpts<RosterEntry[]>) {
  return useQuery({
    queryKey: keys.users(branchId),
    queryFn: ({ signal }) => api.get<RosterEntry[]>(paths.users(branchId), { signal }),
    ...options,
  });
}

function afterUserWrite(qc: QueryClient, user: User): void {
  void qc.invalidateQueries({ queryKey: keys.usersRoot() });
  void qc.invalidateQueries({ queryKey: keys.boardRoot() });
  if (qc.getQueryData<MeResponse>(keys.me())?.user.id === user.id) void qc.invalidateQueries({ queryKey: keys.me() });
}

export function useCreateUser() {
  return useApiMutation<UserCreateInput, User>((input) => api.post(paths.users(), input), afterUserWrite);
}

export function useUpdateUser() {
  return useApiMutation<{ userId: string; input: UserUpdateInput }, User>(
    ({ userId, input }) => api.patch(paths.user(userId), input),
    afterUserWrite,
  );
}

// =====================================================================================
// board + orders
// =====================================================================================

export function useBoard(branchIds: readonly string[], options?: QueryOpts<BoardResponse>) {
  return useQuery({
    queryKey: keys.board(branchIds),
    queryFn: ({ signal }) => api.get<BoardResponse>(paths.board([...branchIds].sort()), { signal }),
    enabled: branchIds.length > 0,
    ...options,
  });
}

export function useClosedOrders(branchId: string, since?: string, options?: QueryOpts<Order[]>) {
  return useQuery({
    queryKey: keys.closedOrders(branchId, since),
    queryFn: ({ signal }) => api.get<Order[]>(paths.orders(branchId, since ? { status: 'closed', since } : { status: 'closed' }), { signal }),
    ...options,
  });
}

export function useOrderHistory(branchId: string, orderId: string, options?: QueryOpts<AuditEvent[]>) {
  return useQuery({
    queryKey: keys.orderHistory(branchId, orderId),
    queryFn: ({ signal }) => api.get<AuditEvent[]>(paths.orderAction(branchId, orderId, 'history'), { signal }),
    ...options,
  });
}

interface OrderRef {
  branchId: string;
  orderId: string;
}

export function useCreateOrder() {
  return useApiMutation<{ branchId: string; input: OrderCreateInput }, Order>(
    ({ branchId, input }) => api.post(paths.orders(branchId), input),
    afterOrderWrite,
  );
}

export function useUpdateOrder() {
  return useApiMutation<OrderRef & { input: OrderUpdateInput }, Order>(
    ({ branchId, orderId, input }) => api.patch(paths.order(branchId, orderId), input),
    afterOrderWrite,
  );
}

export function useAddOpenings() {
  return useApiMutation<OrderRef & { count: number }, Order>(
    ({ branchId, orderId, count }) => api.post(paths.orderAction(branchId, orderId, 'openings'), { count }),
    afterOrderWrite,
  );
}

export function useRemoveOpening() {
  return useApiMutation<OrderRef & { openingId: string }, Order>(
    ({ branchId, orderId, openingId }) => api.delete(paths.opening(branchId, orderId, openingId)),
    afterOrderWrite,
  );
}

export function usePauseOrder() {
  return useApiMutation<OrderRef & { input: OrderPauseInput }, Order>(
    ({ branchId, orderId, input }) => api.post(paths.orderAction(branchId, orderId, 'pause'), input),
    afterOrderWrite,
  );
}

export function useCloseOrder() {
  return useApiMutation<OrderRef & { input: OrderCloseInput }, Order>(
    ({ branchId, orderId, input }) => api.post(paths.orderAction(branchId, orderId, 'close'), input),
    afterOrderWrite,
  );
}

function useOrderAction(action: 'resume' | 'reopen' | 'publish') {
  return useApiMutation<OrderRef, Order>(({ branchId, orderId }) => api.post(paths.orderAction(branchId, orderId, action)), afterOrderWrite);
}
export const useResumeOrder = () => useOrderAction('resume');
export const useReopenOrder = () => useOrderAction('reopen');
export const usePublishOrder = () => useOrderAction('publish');

export interface OpeningWrite extends OrderRef {
  openingId: string;
  input: OpeningUpdateInput;
}

type BoardSnapshot = Array<[QueryKey, BoardResponse | undefined]>;

/**
 * PUT a line. The board updates instantly using the shared rule; a refusal (rule error, 409, 403)
 * restores the previous cache and refetches so the screen matches the server.
 */
export function useUpdateOpening() {
  const qc = useQueryClient();
  return useMutation<Order, ApiError, OpeningWrite, { snapshot: BoardSnapshot }>({
    mutationFn: ({ branchId, orderId, openingId, input }) => api.put<Order>(paths.opening(branchId, orderId, openingId), input),
    onMutate: async ({ orderId, openingId, input }) => {
      await qc.cancelQueries({ queryKey: keys.boardRoot() });
      const snapshot = qc.getQueriesData<BoardResponse>({ queryKey: keys.boardRoot() });
      const actorId = qc.getQueryData<MeResponse>(keys.me())?.user.id;
      if (actorId) {
        const nowIso = new Date().toISOString();
        qc.setQueriesData<BoardResponse>({ queryKey: keys.boardRoot() }, (board) => {
          if (!board) return board;
          const target = board.orders.find((o) => o.id === orderId);
          if (!target) return board;
          let next: Order;
          try {
            next = applyOpeningUpdate(target, openingId, input, actorId, nowIso);
          } catch {
            // The rule refuses this write; leave the cache alone and let the server explain.
            return board;
          }
          return { ...board, orders: replaceById(board.orders, next) };
        });
      }
      return { snapshot };
    },
    onError: (_error, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: keys.boardRoot() });
    },
    onSuccess: (order) => afterOrderWrite(qc, order),
  });
}

// =====================================================================================
// accounts + wall coding
// =====================================================================================

export function useAccounts(branchId: string, options?: QueryOpts<Account[]>) {
  return useQuery({ queryKey: keys.accounts(branchId), queryFn: ({ signal }) => api.get<Account[]>(paths.accounts(branchId), { signal }), ...options });
}

function afterAccountWrite(qc: QueryClient, account: Account): void {
  upsertAccount(qc, account);
  void qc.invalidateQueries({ queryKey: keys.boardRoot() });
  void qc.invalidateQueries({ queryKey: keys.wallLegend(account.branchId) });
  void qc.invalidateQueries({ queryKey: keys.wallPreview(account.branchId) });
}

export function useCreateAccount() {
  return useApiMutation<{ branchId: string; input: AccountCreateInput }, Account>(
    ({ branchId, input }) => api.post(paths.accounts(branchId), input),
    afterAccountWrite,
  );
}

export function useUpdateAccount() {
  return useApiMutation<{ branchId: string; accountId: string; input: AccountUpdateInput }, Account>(
    ({ branchId, accountId, input }) => api.patch(paths.account(branchId, accountId), input),
    afterAccountWrite,
  );
}

export function useRotateWallCodes() {
  return useApiMutation<{ branchId: string }, Account[]>(
    ({ branchId }) => api.post(paths.rotateWallCodes(branchId)),
    (qc, accounts, { branchId }) => {
      qc.setQueryData(keys.accounts(branchId), accounts);
      void qc.invalidateQueries({ queryKey: keys.boardRoot() });
      void qc.invalidateQueries({ queryKey: keys.wallLegend(branchId) });
      void qc.invalidateQueries({ queryKey: keys.wallPreview(branchId) });
    },
  );
}

/** Dry run when `input.apply` is false; the plan is returned either way. */
export function useImportAccounts() {
  return useApiMutation<{ branchId: string; input: AccountImportInput }, AccountImportPlan>(
    ({ branchId, input }) => api.post(paths.importAccounts(branchId), input),
    (qc, plan, { branchId }) => {
      if (plan.applied) {
        void qc.invalidateQueries({ queryKey: keys.accounts(branchId) });
        void qc.invalidateQueries({ queryKey: keys.boardRoot() });
        void qc.invalidateQueries({ queryKey: keys.wallLegend(branchId) });
      }
    },
  );
}

/** Read-only probe: how would an email from this sender route? */
export function useRoutingTest() {
  return useApiMutation<{ branchId: string; input: RoutingTestInput }, RoutingTestResult>(({ branchId, input }) =>
    api.post(paths.routingTest(branchId), input),
  );
}

export function useWallLegend(branchId: string, options?: QueryOpts<WallLegend>) {
  return useQuery({ queryKey: keys.wallLegend(branchId), queryFn: ({ signal }) => api.get<WallLegend>(paths.wallLegend(branchId), { signal }), ...options });
}

export function useWallPreview(branchId: string, options?: QueryOpts<WallFeed>) {
  return useQuery({ queryKey: keys.wallPreview(branchId), queryFn: ({ signal }) => api.get<WallFeed>(paths.wallPreview(branchId), { signal }), ...options });
}

// =====================================================================================
// candidates (pipeline)
// =====================================================================================

export function useCandidates(branchId: string, status: CandidateStatus = 'active', options?: QueryOpts<Candidate[]>) {
  return useQuery({
    queryKey: keys.candidates(branchId, status),
    queryFn: ({ signal }) => api.get<Candidate[]>(paths.candidates(branchId, status), { signal }),
    ...options,
  });
}

export function useCreateCandidate() {
  return useApiMutation<{ branchId: string; input: CandidateCreateInput }, Candidate>(
    ({ branchId, input }) => api.post(paths.candidates(branchId), input),
    upsertCandidate,
  );
}

export function useUpdateCandidate() {
  return useApiMutation<{ branchId: string; candidateId: string; input: CandidateUpdateInput }, Candidate>(
    ({ branchId, candidateId, input }) => api.patch(paths.candidate(branchId, candidateId), input),
    upsertCandidate,
  );
}

export function useArchiveCandidate() {
  return useApiMutation<{ branchId: string; candidateId: string }, Candidate>(
    ({ branchId, candidateId }) => api.post(paths.candidateAction(branchId, candidateId, 'archive')),
    upsertCandidate,
  );
}

export function useCandidateStage() {
  return useApiMutation<{ branchId: string; candidateId: string; input: CandidateStageInput }, CandidateMutationResult>(
    ({ branchId, candidateId, input }) => api.post(paths.candidateAction(branchId, candidateId, 'stage'), input),
    applyCandidateResult,
  );
}

export function useLinkCandidate() {
  return useApiMutation<{ branchId: string; candidateId: string; input: CandidateLinkInput }, CandidateMutationResult>(
    ({ branchId, candidateId, input }) => api.post(paths.candidateAction(branchId, candidateId, 'link'), input),
    applyCandidateResult,
  );
}

export function useUnlinkCandidate() {
  return useApiMutation<{ branchId: string; candidateId: string }, CandidateMutationResult>(
    ({ branchId, candidateId }) => api.delete(paths.candidateAction(branchId, candidateId, 'link')),
    applyCandidateResult,
  );
}

// =====================================================================================
// tasks (mail intake)
// =====================================================================================

export function useTasks(view: TaskView, branchIds: readonly string[], date?: string, options?: QueryOpts<TasksResponse>) {
  return useQuery({
    queryKey: keys.tasks(view, branchIds, date),
    queryFn: ({ signal }) => api.get<TasksResponse>(paths.tasks({ view, branches: [...branchIds].sort(), date }), { signal }),
    enabled: view === 'personal' || branchIds.length > 0,
    ...options,
  });
}

export function useTaskMessages(scopeId: string, taskId: string, options?: QueryOpts<EmailMessage[]>) {
  return useQuery({
    queryKey: keys.taskMessages(scopeId, taskId),
    queryFn: ({ signal }) => api.get<EmailMessage[]>(paths.taskAction(scopeId, taskId, 'messages'), { signal }),
    ...options,
  });
}

export function useCreateTask() {
  return useApiMutation<{ branchId: string; input: TaskCreateInput }, Task>(
    ({ branchId, input }) => api.post(paths.branchTasks(branchId), input),
    afterTaskWrite,
  );
}

export function useUpdateTask() {
  return useApiMutation<{ scopeId: string; taskId: string; input: TaskUpdateInput }, Task>(
    ({ scopeId, taskId, input }) => api.patch(paths.task(scopeId, taskId), input),
    afterTaskWrite,
  );
}

function useTaskAction(action: 'claim' | 'complete' | 'reopen') {
  return useApiMutation<{ scopeId: string; taskId: string }, Task>(
    ({ scopeId, taskId }) => api.post(paths.taskAction(scopeId, taskId, action)),
    afterTaskWrite,
  );
}
export const useClaimTask = () => useTaskAction('claim');
export const useCompleteTask = () => useTaskAction('complete');
export const useReopenTask = () => useTaskAction('reopen');

export function useCreateOrderFromTask() {
  return useApiMutation<{ scopeId: string; taskId: string; input: TaskOrderInput }, { task: Task; order: Order }>(
    ({ scopeId, taskId, input }) => api.post(paths.taskAction(scopeId, taskId, 'create-order'), input),
    (qc, { order }) => {
      afterTaskWrite(qc);
      afterOrderWrite(qc, order);
    },
  );
}

export function useReassignTasks() {
  return useApiMutation<{ branchId: string; fromUserId: string; toUserId: string | null }, { moved: number }>(
    ({ branchId, fromUserId, toUserId }) => api.post(paths.reassignTasks(branchId), { fromUserId, toUserId }),
    afterTaskWrite,
  );
}

// =====================================================================================
// mailboxes + filtered mail
// =====================================================================================

export function useMailboxes(options?: QueryOpts<Mailbox[]>) {
  return useQuery({ queryKey: keys.mailboxes(), queryFn: ({ signal }) => api.get<Mailbox[]>(paths.mailboxes(), { signal }), ...options });
}

function afterMailboxWrite(qc: QueryClient, mailbox: Mailbox): void {
  qc.setQueryData<Mailbox[]>(keys.mailboxes(), (list) =>
    list ? (list.some((m) => m.id === mailbox.id) ? replaceById(list, mailbox) : [...list, mailbox]) : list,
  );
}

export function useCreateMailbox() {
  return useApiMutation<MailboxCreateInput, Mailbox>((input) => api.post(paths.mailboxes(), input), afterMailboxWrite);
}

export function useUpdateMailbox() {
  return useApiMutation<{ mailboxId: string; input: MailboxUpdateInput }, Mailbox>(
    ({ mailboxId, input }) => api.patch(paths.mailbox(mailboxId), input),
    afterMailboxWrite,
  );
}

export function useSyncMailbox() {
  return useApiMutation<{ mailboxId: string }, { queued: true }>(
    ({ mailboxId }) => api.post(paths.mailboxSync(mailboxId)),
    (qc) => void qc.invalidateQueries({ queryKey: keys.mailboxes() }),
  );
}

export function useFilteredMail(branchId: string, options?: QueryOpts<FilteredMail[]>) {
  return useQuery({ queryKey: keys.filtered(branchId), queryFn: ({ signal }) => api.get<FilteredMail[]>(paths.filteredMail(branchId), { signal }), ...options });
}

export function usePromoteFiltered() {
  return useApiMutation<{ scopeId: string; filteredId: string }, Task>(
    ({ scopeId, filteredId }) => api.post(paths.promoteFiltered(scopeId, filteredId)),
    (qc, _task, { scopeId }) => {
      void qc.invalidateQueries({ queryKey: keys.filtered(scopeId) });
      afterTaskWrite(qc);
    },
  );
}

// =====================================================================================
// wall displays (staff side)
// =====================================================================================

export function useDisplays(branchId: string, options?: QueryOpts<Display[]>) {
  return useQuery({ queryKey: keys.displays(branchId), queryFn: ({ signal }) => api.get<Display[]>(paths.displays(branchId), { signal }), ...options });
}

function afterDisplayWrite(qc: QueryClient, display: Display): void {
  qc.setQueryData<Display[]>(keys.displays(display.branchId), (list) =>
    list ? (list.some((d) => d.id === display.id) ? replaceById(list, display) : [...list, display]) : list,
  );
}

export function useClaimDisplay() {
  return useApiMutation<{ branchId: string; input: DisplayClaimInput }, Display>(
    ({ branchId, input }) => api.post(paths.claimDisplay(branchId), input),
    afterDisplayWrite,
  );
}

export function useRevokeDisplay() {
  return useApiMutation<{ branchId: string; displayId: string }, Display>(
    ({ branchId, displayId }) => api.post(paths.revokeDisplay(branchId, displayId)),
    afterDisplayWrite,
  );
}

// =====================================================================================
// wall device (anonymous at SWA; display-token / pairing-secret authenticated)
// =====================================================================================

export function useWallPairStart() {
  return useApiMutation<void, WallPairStartResponse>(() => api.post(paths.wallPairStart()));
}

export function useWallPairPoll(pairingId: string | null, secret: string | null, options?: QueryOpts<WallPairPollResponse>) {
  return useQuery({
    queryKey: keys.wallPairPoll(pairingId ?? ''),
    queryFn: ({ signal }) =>
      api.get<WallPairPollResponse>(paths.wallPairPoll(pairingId!), { signal, headers: { [PAIRING_SECRET_HEADER]: secret! } }),
    enabled: pairingId !== null && secret !== null,
    ...options,
  });
}

export function useWallFeed(displayToken: string | null, options?: QueryOpts<WallFeed>) {
  return useQuery({
    queryKey: keys.wallFeed(),
    queryFn: ({ signal }) => api.get<WallFeed>(paths.wallFeed(), { signal, headers: { [DISPLAY_TOKEN_HEADER]: displayToken! } }),
    enabled: displayToken !== null,
    ...options,
  });
}
