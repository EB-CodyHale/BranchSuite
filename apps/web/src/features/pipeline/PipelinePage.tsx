import { type BoardResponse, type Candidate, type PipelineStage } from '@branchsuite/shared';
import { Plus, SearchX, Users } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBranchScope } from '../../app/BranchScope.js';
import { useMeContext } from '../../app/MeContext.js';
import { useDocumentTitle } from '../../app/useDocumentTitle.js';
import { errorMessage } from '../../lib/api.js';
import { useBoard, useCandidates } from '../../lib/queries.js';
import { readStorage, writeStorage } from '../../lib/storage.js';
import { Button } from '../../ui/Button.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Select } from '../../ui/Field.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';
import { AddCandidateDialog } from './AddCandidateDialog.js';
import { CandidateDrawer } from './CandidateDrawer.js';
import { CandidateListView } from './CandidateListView.js';
import { KanbanBoard } from './KanbanBoard.js';
import { OpeningsPanel } from './OpeningsPanel.js';
import { PipelineActionsContext, PipelineEnvContext, type PipelineActions, type PipelineEnv } from './PipelineContext.js';
import {
  accountNeeds,
  customerAccounts,
  DEFAULT_FILTERS,
  filterCandidates,
  recruitersFor,
  type PipelineFilters,
} from './pipelineModel.js';
import { PipelineToolbar, type PipelineView } from './PipelineToolbar.js';
import { useStageMover } from './StageMove.js';

const BRANCH_KEY = 'bs.pipeline.branch';
const VIEW_KEY = 'bs.pipeline.view';
const PANEL_KEY = 'bs.pipeline.panel';
const EMPTY: Candidate[] = [];

/** Candidate pipeline: per-branch kanban of candidates in process, with tentative fills on board lines. */
export function PipelinePage() {
  useDocumentTitle('Candidate pipeline');
  const { branchIds, branchesById } = useBranchScope();
  const [params, setParams] = useSearchParams();
  const deepId = params.get('candidate');
  const board = useBoard(branchIds);
  const [picked, setPicked] = useState<string | null>(() => readStorage(BRANCH_KEY));
  const multi = branchIds.length > 1;

  // A deep link from the board names a candidate holding a line; open the branch that line is in.
  const deepBranch = useMemo(() => {
    if (!deepId || !board.data) return null;
    const order = board.data.orders.find((o) => o.openings.some((l) => l.candidateId === deepId));
    return order && branchIds.includes(order.branchId) ? order.branchId : null;
  }, [deepId, board.data, branchIds]);

  const branchId = deepBranch ?? (picked && branchIds.includes(picked) ? picked : branchIds[0]);

  const choose = useCallback((id: string) => {
    setPicked(id);
    writeStorage(BRANCH_KEY, id);
  }, []);
  useEffect(() => {
    if (deepBranch && deepBranch !== picked) choose(deepBranch);
  }, [deepBranch, picked, choose]);

  const setCandidateParam = useCallback(
    (id: string | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (id) next.set('candidate', id);
          else next.delete('candidate');
          return next;
        },
        { replace: id === null },
      ),
    [setParams],
  );

  const branchPicker = multi ? (
    <Select
      label="Pipeline branch"
      hideLabel
      value={branchId}
      onChange={(e) => choose(e.target.value)}
      options={branchIds.map((id) => ({ value: id, label: branchesById.get(id)?.name ?? id }))}
      className="w-full sm:w-56"
    />
  ) : null;

  const header = (actions?: ReactNode) => (
    <PageHeader branchName={branchId ? (branchesById.get(branchId)?.name ?? '') : ''} picker={branchPicker} actions={actions} />
  );

  if (!branchId) {
    return (
      <section className="mx-auto max-w-[110rem] px-4 py-4 sm:px-5 sm:py-5">
        {header()}
        <EmptyState title="No branches assigned" description="Ask a manager to add you to a branch." />
      </section>
    );
  }

  if (!board.data) {
    return (
      <section className="mx-auto flex max-w-[110rem] flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5" aria-busy={!board.isError || undefined}>
        {header()}
        {board.isError ? (
          <LoadError message={errorMessage(board.error)} retrying={board.isFetching} onRetry={() => void board.refetch()} />
        ) : (
          <PipelineSkeleton />
        )}
      </section>
    );
  }

  return <PipelineWorkspace key={branchId} branchId={branchId} board={board.data} deepId={deepId} setCandidateParam={setCandidateParam} header={header} />;
}

function PageHeader({ branchName, picker, actions }: { branchName: string; picker: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[1.75rem] font-bold leading-none tracking-tight sm:text-3xl">Candidate pipeline</h1>
        <p className="mt-1 truncate text-sm font-semibold tabular-nums text-muted" aria-live="polite">
          {branchName}
        </p>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        {picker}
        {actions}
      </div>
    </div>
  );
}

interface WorkspaceProps {
  branchId: string;
  board: BoardResponse;
  deepId: string | null;
  setCandidateParam: (id: string | null) => void;
  header: (actions?: ReactNode) => ReactNode;
}

function PipelineWorkspace({ branchId, board, deepId, setCandidateParam, header }: WorkspaceProps) {
  const { me } = useMeContext();
  const viewerId = me.user.id;
  const { toast } = useToast();
  const [filters, setFilters] = useState<PipelineFilters>(DEFAULT_FILTERS);
  const search = useDeferredValue(filters.search);
  const [view, setView] = useState<PipelineView>(() => (readStorage(VIEW_KEY) === 'list' ? 'list' : 'board'));
  const [panelOpen, setPanelOpen] = useState(() => readStorage(PANEL_KEY) !== '0');
  const [adding, setAdding] = useState(false);

  const active = useCandidates(branchId, 'active');
  const activeList = active.data ?? EMPTY;
  const deepMissingFromActive = deepId !== null && active.isSuccess && !activeList.some((c) => c.id === deepId);
  const archived = useCandidates(branchId, 'archived', { enabled: filters.showArchived || deepMissingFromActive });
  const archivedList = archived.data ?? EMPTY;
  const mover = useStageMover();

  // ---- environment ----
  const env = useMemo<PipelineEnv>(() => {
    const orders = board.orders.filter((o) => o.branchId === branchId);
    return {
      branchId,
      today: board.today[branchId],
      viewerId,
      accountsById: new Map(board.accounts.map((a) => [a.id, a])),
      peopleById: new Map(board.people.map((p) => [p.id, p])),
      ordersById: new Map(orders.map((o) => [o.id, o])),
      orders,
      recruiters: recruitersFor(board.people, branchId),
      accounts: customerAccounts(board.accounts, branchId),
    };
  }, [board, branchId, viewerId]);

  const actions = useMemo<PipelineActions>(
    () => ({
      openCandidate: (id) => setCandidateParam(id),
      requestMove: mover.requestMove,
      movingIds: new Set(mover.pending.keys()),
    }),
    [setCandidateParam, mover.requestMove, mover.pending],
  );

  // ---- candidates on screen (optimistic stage while a move is in flight) ----
  const withPending = useCallback(
    (list: Candidate[]) => (mover.pending.size === 0 ? list : list.map((c) => {
      const stage: PipelineStage | undefined = mover.pending.get(c.id);
      return stage ? { ...c, stage } : c;
    })),
    [mover.pending],
  );
  const pool = useMemo(() => withPending(filters.showArchived ? [...activeList, ...archivedList] : activeList), [withPending, filters.showArchived, activeList, archivedList]);
  const visible = useMemo(() => filterCandidates(pool, { ...filters, search }, viewerId), [pool, filters, search, viewerId]);
  const needs = useMemo(() => accountNeeds(env.orders, activeList, env.accountsById, branchId), [env, activeList, branchId]);
  const inProcess = activeList.filter((c) => c.stage !== 'dropped' && c.stage !== 'started').length;

  // ---- deep link ----
  const drawerCandidate = deepId ? (activeList.find((c) => c.id === deepId) ?? archivedList.find((c) => c.id === deepId)) : undefined;
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (!deepId || drawerCandidate || !deepMissingFromActive || !archived.isFetched || archived.isFetching) return;
    if (reported.current === deepId) return;
    reported.current = deepId;
    toast({ title: 'Candidate not found', description: 'They may be in another branch or no longer exist.', tone: 'danger' });
    setCandidateParam(null);
  }, [deepId, drawerCandidate, deepMissingFromActive, archived.isFetched, archived.isFetching, toast, setCandidateParam]);

  const update = (patch: Partial<PipelineFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const clear = () => setFilters((f) => ({ ...DEFAULT_FILTERS, showArchived: f.showArchived }));
  const changeView = (v: PipelineView) => {
    setView(v);
    writeStorage(VIEW_KEY, v);
  };
  const togglePanel = () =>
    setPanelOpen((v) => {
      writeStorage(PANEL_KEY, v ? '0' : '1');
      return !v;
    });

  const addButton = (
    <Button variant="primary" size="sm" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setAdding(true)}>
      Add candidate
    </Button>
  );

  let main: ReactNode;
  if (active.isError && !active.data) {
    main = <LoadError message={errorMessage(active.error)} retrying={active.isFetching} onRetry={() => void active.refetch()} />;
  } else if (!active.data) {
    main = <PipelineSkeleton />;
  } else if (activeList.length === 0 && !filters.showArchived) {
    main = (
      <EmptyState
        icon={<Users />}
        title="No candidates yet"
        description="Add the people you are working so the team can see who is in process for which account."
        action={addButton}
      />
    );
  } else {
    main = (
      <>
        {visible.length === 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-line-strong bg-surface px-3 py-2.5 text-sm">
            <SearchX aria-hidden="true" className="size-4 text-subtle" />
            <span className="flex-1 text-muted">
              {filters.recruiter === 'mine' && !filters.search && filters.account === 'all' ? 'You have no candidates in this branch.' : 'No candidates match these filters.'}
            </span>
            {filters.recruiter !== 'all' ? (
              <Button size="sm" onClick={() => update({ recruiter: 'all' })}>
                Show everyone
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear filters
            </Button>
          </div>
        ) : null}
        {view === 'board' ? <KanbanBoard candidates={visible} /> : visible.length > 0 ? <CandidateListView candidates={visible} /> : null}
      </>
    );
  }

  return (
    <PipelineEnvContext.Provider value={env}>
      <PipelineActionsContext.Provider value={actions}>
        <section className="mx-auto flex max-w-[110rem] flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5" aria-busy={active.isPending || undefined}>
          {header(addButton)}
          <p className="-mt-3 text-sm text-muted tabular-nums">
            <span className="font-semibold text-fg">{inProcess}</span> in process · <span className="font-semibold text-fg">{needs.reduce((n, a) => n + a.toFill, 0)}</span> lines to fill
          </p>

          <PipelineToolbar
            filters={filters}
            onChange={update}
            onClear={clear}
            recruiters={env.recruiters}
            accounts={env.accounts}
            viewerId={viewerId}
            view={view}
            onView={changeView}
          />

          <p className="sr-only" role="status" aria-live="polite">
            {active.data ? `${visible.length} ${visible.length === 1 ? 'candidate' : 'candidates'} shown` : ''}
          </p>

          <div className="flex flex-col gap-4 xl:flex-row-reverse xl:items-start">
            <div className="xl:sticky xl:top-4 xl:w-72 xl:shrink-0">
              <OpeningsPanel needs={needs} open={panelOpen} onToggle={togglePanel} activeAccount={filters.account} onPick={(account) => update({ account })} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">{main}</div>
          </div>
        </section>

        {mover.dialogs}
        {drawerCandidate ? <CandidateDrawer key={drawerCandidate.id} candidate={drawerCandidate} onClose={() => setCandidateParam(null)} /> : null}
        {adding ? (
          <AddCandidateDialog
            onClose={() => setAdding(false)}
            defaultAccountId={filters.account !== 'all' && filters.account !== 'none' ? filters.account : undefined}
          />
        ) : null}
      </PipelineActionsContext.Provider>
    </PipelineEnvContext.Provider>
  );
}

function LoadError({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft">
      <EmptyState
        title="The pipeline did not load"
        description={message}
        action={
          <Button variant="primary" onClick={onRetry} loading={retrying}>
            Try again
          </Button>
        }
      />
    </div>
  );
}

function PipelineSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      <span className="sr-only">Loading candidates</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} aria-hidden="true" className="flex w-[min(17.5rem,82vw)] shrink-0 flex-col gap-2 rounded-lg border border-line p-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ))}
    </div>
  );
}
