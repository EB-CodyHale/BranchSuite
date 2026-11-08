import { boardMetrics, sortOrders, DEFAULT_TIME_ZONE, type AccountLite, type Branch, type Order, type PersonLite } from '@branchsuite/shared';
import { ClipboardList, Crosshair, Plus, SearchX } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ALL_BRANCHES, useBranchScope } from '../../app/BranchScope.js';
import { useMeContext } from '../../app/MeContext.js';
import { useDocumentTitle } from '../../app/useDocumentTitle.js';
import { errorMessage } from '../../lib/api.js';
import { useBoard, usePublishOrder, useResumeOrder } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';
import { WallGlyph } from '../../ui/WallGlyph.js';
import { BoardActionsContext, BoardEnvContext, useBoardEnv, type BoardActions, type BoardEnv, type OrderDialogKind } from './BoardContext.js';
import {
  buildLookups,
  DEFAULT_TOOLBAR,
  filterOrders,
  groupByAccount,
  loadToolbar,
  ownersByOrder,
  reviewableDrafts,
  saveToolbar,
  todayFor,
  type QuickFilter,
  type ToolbarState,
} from './boardModel.js';
import { BoardToolbar } from './BoardToolbar.js';
import { DraftsTray } from './DraftsTray.js';
import { HeaderRail } from './HeaderRail.js';
import { AddOpeningsDialog, ClosedOrdersDrawer, CloseOrderDialog, HistoryDrawer, PauseDialog } from './OrderActionDialogs.js';
import { OrderCard } from './OrderCard.js';
import { OrderFormDialog } from './OrderFormDialog.js';
import { OrderListView } from './OrderListView.js';

const EMPTY_ACCOUNTS: AccountLite[] = [];
const EMPTY_PEOPLE: PersonLite[] = [];
const EMPTY_ORDERS: Order[] = [];
const EMPTY_TODAY: Record<string, string> = {};

type DialogState = { kind: 'create'; branchId?: string } | { kind: OrderDialogKind; order: Order };

/** The job order board: the branch's whiteboard of open orders and their lines. */
export function BoardPage() {
  useDocumentTitle('Job order board');
  const { me, canManage } = useMeContext();
  const { scope, branchIds, branchesById } = useBranchScope();
  const userId = me.user.id;
  const board = useBoard(branchIds);
  const { toast } = useToast();

  // ---- toolbar state (persisted per user) ----
  const [toolbar, setToolbar] = useState<ToolbarState>(() => loadToolbar(userId));
  const updateToolbar = useCallback(
    (patch: Partial<ToolbarState>) =>
      setToolbar((s) => {
        const next = { ...s, ...patch };
        saveToolbar(userId, next);
        return next;
      }),
    [userId],
  );
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [quick, setQuick] = useState<QuickFilter | null>(null);

  // ---- deep-link focus: /?order=<id> (inbox "Draft order created") and /?account=<id> (pipeline) ----
  const [params, setParams] = useSearchParams();
  const focusOrderId = params.get('order');
  const focusAccountId = focusOrderId ? null : params.get('account');
  const clearFocus = useCallback(
    () =>
      setParams(
        (p) => {
          p.delete('order');
          p.delete('account');
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );

  // ---- dialogs ----
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [closedOpen, setClosedOpen] = useState(false);
  const publish = usePublishOrder();
  const resume = useResumeOrder();
  // mutateAsync keeps each call's outcome even when several run at once (per-call callbacks
  // only fire for the latest call of an observer).
  const mutateRef = useRef({ publish: publish.mutateAsync, resume: resume.mutateAsync, toast });
  mutateRef.current = { publish: publish.mutateAsync, resume: resume.mutateAsync, toast };

  const actions = useMemo<BoardActions>(
    () => ({
      open: (kind, order) => setDialog({ kind, order }),
      create: (branchId) => setDialog({ kind: 'create', branchId }),
      publish: (order) => {
        const { publish: run, toast: say } = mutateRef.current;
        run({ branchId: order.branchId, orderId: order.id }).then(
          () => say({ title: 'Order published', description: 'It is now on the board and the wall.', tone: 'success' }),
          (e: unknown) => say({ title: 'Order not published', description: errorMessage(e), tone: 'danger' }),
        );
      },
      resume: (order) => {
        const { resume: run, toast: say } = mutateRef.current;
        run({ branchId: order.branchId, orderId: order.id }).then(
          () => say({ title: 'Order resumed', tone: 'success' }),
          (e: unknown) => say({ title: 'Order not resumed', description: errorMessage(e), tone: 'danger' }),
        );
      },
    }),
    [],
  );

  // ---- derived data (memoized so a single line write re-renders one card) ----
  const data = board.data;
  const accounts = data?.accounts ?? EMPTY_ACCOUNTS;
  const people = data?.people ?? EMPTY_PEOPLE;
  const today = data?.today ?? EMPTY_TODAY;
  const allOrders = data?.orders ?? EMPTY_ORDERS;
  const lookups = useMemo(() => buildLookups(accounts, people), [accounts, people]);
  const orders = useMemo(() => allOrders.filter((o) => branchIds.includes(o.branchId)), [allOrders, branchIds]);
  const owners = useMemo(() => ownersByOrder(orders, lookups), [orders, lookups]);
  const timeZones = useMemo(() => {
    const zones: Record<string, string> = {};
    for (const [id, b] of branchesById) zones[id] = b.timeZone;
    return zones;
  }, [branchesById]);
  const metrics = useMemo(() => (data ? boardMetrics(orders, today, timeZones) : null), [data, orders, today, timeZones]);
  const allDrafts = useMemo(() => reviewableDrafts(orders, canManage), [orders, canManage]);
  const drafts = useMemo(() => (focusOrderId ? allDrafts.filter((d) => d.id === focusOrderId) : allDrafts), [allDrafts, focusOrderId]);
  const multiBranch = branchIds.length > 1;
  const scopeBranches = useMemo(() => branchIds.map((id) => branchesById.get(id)).filter((b): b is Branch => b !== undefined), [branchIds, branchesById]);
  const ownerChoices = useMemo(
    () => people.filter((p) => p.active && p.branchIds.some((b) => branchIds.includes(b))).sort((a, b) => a.name.localeCompare(b.name)),
    [people, branchIds],
  );

  const focused = focusOrderId !== null || focusAccountId !== null;
  const visible = useMemo(() => {
    // A deep link shows exactly what it points at, regardless of the saved toolbar filters.
    const onBoard = (o: Order) => o.status === 'active' || o.status === 'paused';
    const filtered = focusOrderId
      ? orders.filter((o) => o.id === focusOrderId && onBoard(o))
      : focusAccountId
        ? orders.filter((o) => o.accountId === focusAccountId && onBoard(o))
        : filterOrders(orders, { toolbar, search: deferredSearch, quick, today, lookups, owners, scopeBranchIds: branchIds, timeZones });
    return sortOrders(filtered, toolbar.sort, { today, accountsById: lookups.accountsById });
  }, [orders, toolbar, deferredSearch, quick, today, lookups, owners, branchIds, timeZones, focusOrderId, focusAccountId]);

  const boardOrderCount = useMemo(() => orders.filter((o) => o.status === 'active' || o.status === 'paused').length, [orders]);
  const pausedHidden = useMemo(() => !toolbar.showPaused && orders.some((o) => o.status === 'paused'), [orders, toolbar.showPaused]);

  const env = useMemo<BoardEnv>(
    () => ({
      accountsById: lookups.accountsById,
      peopleById: lookups.peopleById,
      branchesById,
      multiBranch,
      canManage,
      pipelineEnabled: me.features.pipeline,
      viewerId: userId,
      today,
    }),
    [lookups, branchesById, multiBranch, canManage, me.features.pipeline, userId, today],
  );

  const canCreate = branchIds.some(canManage);
  const scopeName =
    scope === ALL_BRANCHES && multiBranch ? 'All branches' : (branchesById.get(branchIds[0] ?? '')?.name ?? 'No branch');

  const clearFilters = () => {
    setSearch('');
    setQuick(null);
    updateToolbar({ owner: DEFAULT_TOOLBAR.owner, roleCategory: DEFAULT_TOOLBAR.roleCategory, hasOpenings: false, branchIds: [] });
  };

  const current = dialog && dialog.kind !== 'create' ? (allOrders.find((o) => o.id === dialog.order.id) ?? dialog.order) : null;
  const closeDialog = () => setDialog(null);

  return (
    <BoardEnvContext.Provider value={env}>
      <BoardActionsContext.Provider value={actions}>
        <section className="mx-auto flex max-w-[110rem] flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5" aria-busy={board.isPending || undefined}>
          <HeaderRail
            scopeName={scopeName}
            metrics={metrics}
            quick={quick}
            onQuick={setQuick}
            canCreate={canCreate}
            onCreate={() => actions.create()}
            onShowClosed={() => setClosedOpen(true)}
          />

          {board.isError && !data ? (
            <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft">
              <EmptyState
                title="The board did not load"
                description={errorMessage(board.error)}
                action={
                  <Button variant="primary" onClick={() => void board.refetch()} loading={board.isFetching}>
                    Try again
                  </Button>
                }
              />
            </div>
          ) : branchIds.length === 0 ? (
            <EmptyState title="No branches assigned" description="Ask a manager to add you to a branch." />
          ) : !data ? (
            <BoardSkeleton />
          ) : (
            <>
              <BoardToolbar state={toolbar} onChange={updateToolbar} search={search} onSearch={setSearch} people={ownerChoices} branches={scopeBranches} />

              {focused ? (
                <FocusBanner
                  orderId={focusOrderId}
                  accountId={focusAccountId}
                  orders={orders}
                  shown={visible.length}
                  isDraft={drafts.length > 0}
                  onClear={clearFocus}
                />
              ) : null}

              <DraftsTray drafts={drafts} publishingId={publish.isPending ? (publish.variables?.orderId ?? null) : null} />

              <p className="sr-only" role="status" aria-live="polite">
                {visible.length} {visible.length === 1 ? 'order' : 'orders'} shown
              </p>

              {boardOrderCount === 0 ? (
                <EmptyState
                  icon={<ClipboardList />}
                  title="No open orders"
                  description={canCreate ? 'Add the first order and its openings to start the board.' : 'Orders your managers add will appear here.'}
                  action={
                    canCreate ? (
                      <Button variant="primary" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => actions.create()}>
                        New order
                      </Button>
                    ) : undefined
                  }
                />
              ) : visible.length === 0 && focused ? null : visible.length === 0 ? (
                <EmptyState
                  icon={<SearchX />}
                  title="Nothing matches these filters"
                  description={pausedHidden ? 'Paused orders are hidden. Turn on “Show paused” to include them.' : 'Try a different search or clear the filters.'}
                  action={<Button onClick={clearFilters}>Clear filters</Button>}
                />
              ) : toolbar.view === 'list' ? (
                <OrderListView orders={visible} owners={owners} />
              ) : (
                <BoardGrid orders={visible} owners={owners} grouped={toolbar.groupByAccount || toolbar.sort === 'account'} consecutive={toolbar.sort === 'account'} />
              )}
            </>
          )}
        </section>

        {dialog?.kind === 'create' ? <OrderFormDialog mode={{ kind: 'create', branchId: dialog.branchId }} onClose={closeDialog} /> : null}
        {current && dialog?.kind === 'edit' ? <OrderFormDialog mode={{ kind: 'edit', order: current }} onClose={closeDialog} /> : null}
        {current && dialog?.kind === 'addOpenings' ? <AddOpeningsDialog order={current} onClose={closeDialog} /> : null}
        {current && dialog?.kind === 'pause' ? <PauseDialog order={current} onClose={closeDialog} /> : null}
        {current && dialog?.kind === 'close' ? <CloseOrderDialog order={current} onClose={closeDialog} /> : null}
        {current && dialog?.kind === 'history' ? <HistoryDrawer order={current} onClose={closeDialog} /> : null}
        {closedOpen ? <ClosedOrdersDrawer onClose={() => setClosedOpen(false)} /> : null}
      </BoardActionsContext.Provider>
    </BoardEnvContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------

/** Explains a deep-linked view and offers the way back to the whole board. */
function FocusBanner({
  orderId,
  accountId,
  orders,
  shown,
  isDraft,
  onClear,
}: {
  orderId: string | null;
  accountId: string | null;
  orders: readonly Order[];
  shown: number;
  isDraft: boolean;
  onClear: () => void;
}) {
  const env = useBoardEnv();
  let text: string;
  if (orderId) {
    const order = orders.find((o) => o.id === orderId);
    const name = order ? (env.accountsById.get(order.accountId)?.name ?? 'Unknown account') : null;
    if (order && shown > 0) text = `Showing one order: ${name} · ${order.role}.`;
    else if (order && isDraft) text = `${name} · ${order.role} is a draft from email. Review it under Needs review, then publish it to the board.`;
    else text = 'That order is not on the board in this branch scope. It may be closed, still a draft for a manager to review, or in another branch.';
  } else {
    const account = accountId ? env.accountsById.get(accountId) : undefined;
    if (!account) text = 'That account is not in the current branch scope. Switch the branch scope to see its orders.';
    else if (shown === 0) text = `${account.name} has no open orders on the board right now.`;
    else text = `Showing ${account.name} only: ${shown} ${shown === 1 ? 'order' : 'orders'}.`;
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
      <Crosshair aria-hidden="true" className="size-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1">{text}</p>
      <Button size="sm" onClick={onClear}>
        Show the whole board
      </Button>
    </div>
  );
}

function BoardGrid({ orders, owners, grouped, consecutive }: { orders: Order[]; owners: Map<string, string | null>; grouped: boolean; consecutive: boolean }) {
  const env = useBoardEnv();
  const groups = useMemo(() => (grouped ? groupByAccount(orders, consecutive) : [{ accountId: '', orders }]), [orders, grouped, consecutive]);

  const card = (order: Order) => {
    const branch = env.branchesById.get(order.branchId);
    const ownerId = owners.get(order.id) ?? null;
    return (
      <OrderCard
        key={order.id}
        order={order}
        account={env.accountsById.get(order.accountId)}
        owner={ownerId ? (env.peopleById.get(ownerId) ?? null) : null}
        today={todayFor(env.today, order.branchId, branch?.timeZone)}
        timeZone={branch?.timeZone ?? DEFAULT_TIME_ZONE}
        branchName={env.multiBranch ? (branch?.name ?? null) : null}
        canManage={env.canManage(order.branchId)}
      />
    );
  };

  const gridClass = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] items-start gap-3';

  if (!grouped) {
    return (
      <div aria-label="Orders" role="region" className={gridClass}>
        {orders.map(card)}
      </div>
    );
  }

  return (
    <div aria-label="Orders by account" role="region" className="flex flex-col gap-5">
      {groups.map((g, i) => {
        const account = env.accountsById.get(g.accountId);
        const toFill = g.orders.reduce((n, o) => n + o.openings.filter((l) => l.state === 'open' || l.state === 'tentative').length, 0);
        return (
          <section key={`${g.accountId}-${i}`} aria-label={account?.name ?? 'Unknown account'}>
            <h2 className="mb-2 flex items-center gap-2 border-b border-line pb-1 font-display text-xl font-bold">
              {account ? <WallGlyph glyph={account.wall.glyph} color={account.wall.color} code={account.wall.code} size={22} label={null} /> : null}
              <span className="min-w-0 truncate">{account?.name ?? 'Unknown account'}</span>
              <span className="ml-auto shrink-0 text-sm font-semibold text-muted tabular-nums">
                {g.orders.length} {g.orders.length === 1 ? 'order' : 'orders'} · {toFill} to fill
              </span>
            </h2>
            <div className={gridClass}>{g.orders.map(card)}</div>
          </section>
        );
      })}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <span className="sr-only" role="status">
        Loading the board
      </span>
      <Skeleton className="h-[5.5rem] rounded-lg" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-3">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-md border border-rule border-l-[5px] bg-paper p-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
            <div className="mt-2 grid grid-cols-3 gap-3">
              <Skeleton className="h-7" />
              <Skeleton className="h-7" />
              <Skeleton className="h-7" />
            </div>
            <Skeleton className="mt-1 h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

