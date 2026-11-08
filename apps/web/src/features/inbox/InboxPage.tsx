import type { AccountLite, Branch, Order, PersonLite, Task, TaskCategory, TasksResponse } from '@branchsuite/shared';
import { Inbox, SearchX } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ALL_BRANCHES, useBranchScope } from '../../app/BranchScope.js';
import { useMeContext } from '../../app/MeContext.js';
import { useDocumentTitle } from '../../app/useDocumentTitle.js';
import { errorMessage } from '../../lib/api.js';
import { dayLabel } from '../../lib/format.js';
import { useBoard, useClaimTask, useCompleteTask, useMyMail, useReopenTask, useTasks, useUpdatePreferences, useUpdateTask } from '../../lib/queries.js';
import { keys } from '../../lib/queryKeys.js';
import { Button } from '../../ui/Button.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';
import { AddTaskDialog } from './AddTaskDialog.js';
import { ClearedTray } from './ClearedTray.js';
import { InboxActionsContext, InboxEnvContext, type InboxActions, type InboxEnv } from './InboxContext.js';
import { InboxHeader } from './InboxHeader.js';
import {
  buildLookups,
  categoryLabel,
  clientToday,
  DEFAULT_FILTERS,
  filterTasks,
  groupByCategory,
  inboxCounts,
  loadLayout,
  primaryTimeZone,
  resolveView,
  saveLayout,
  type InboxFilters,
  type InboxLayout,
  type InboxView,
} from './inboxModel.js';
import { InboxToolbar } from './InboxToolbar.js';
import { isMailConnected, PersonalMailCard } from './PersonalMailCard.js';
import { ReassignDialog } from './ReassignDialog.js';
import { TaskDrawer } from './TaskDrawer.js';
import { TaskListView } from './TaskListView.js';
import { TaskQueue } from './TaskQueue.js';

const EMPTY_TASKS: Task[] = [];
const EMPTY_ACCOUNTS: AccountLite[] = [];
const EMPTY_PEOPLE: PersonLite[] = [];
const EMPTY_ORDERS: Order[] = [];

/** Write a server task into every cached task list so the change shows before the refetch lands. */
function upsertTaskInCaches(qc: QueryClient, task: Task): void {
  for (const [key, data] of qc.getQueriesData<TasksResponse>({ queryKey: keys.tasksRoot() })) {
    if (!data || !data.tasks.some((t) => t.id === task.id)) continue;
    qc.setQueryData<TasksResponse>(key, { ...data, tasks: data.tasks.map((t) => (t.id === task.id ? task : t)) });
  }
}

/** Mail-driven work queue: branch, personal or combined tasks for a board day. */
export function InboxPage() {
  useDocumentTitle('Inbox');
  const { me, canManage } = useMeContext();
  const { scope, branchIds, branchesById } = useBranchScope();
  const viewerId = me.user.id;
  const personalMail = me.features.personalMail;
  // Local choice first so the switch is instant; the preference is saved for next time.
  const [viewChoice, setViewChoice] = useState<InboxView>(me.user.preferences.inboxView);
  const view = resolveView(viewChoice, personalMail);
  const { mutate: savePreferences } = useUpdatePreferences();
  const qc = useQueryClient();
  const { toast } = useToast();

  // ---- date ----
  const [date, setDate] = useState<string | null>(null);
  const zone = primaryTimeZone(branchIds, branchesById);
  const clientTodayKey = clientToday(zone);

  // ---- data ----
  const tasksQuery = useTasks(view, branchIds, date ?? undefined, { placeholderData: keepPreviousData });
  const board = useBoard(branchIds);
  const mail = useMyMail({ enabled: personalMail && view !== 'branch' });

  const response = tasksQuery.isPlaceholderData ? undefined : tasksQuery.data;
  const isToday = response ? response.isToday : date === null;
  // The server decides what "today" is; remember its answer while viewing past days.
  const serverToday = useRef<string | null>(null);
  if (response?.isToday) serverToday.current = response.date;
  const today = serverToday.current ?? clientTodayKey;
  const viewedDate = response?.date ?? date ?? today;
  const readOnly = !isToday;

  const allTasks = tasksQuery.data?.tasks ?? EMPTY_TASKS;
  const accounts = board.data?.accounts ?? EMPTY_ACCOUNTS;
  const people = board.data?.people ?? EMPTY_PEOPLE;
  const orders = board.data?.orders ?? EMPTY_ORDERS;
  const boardToday = board.data?.today;
  const lookups = useMemo(() => buildLookups(accounts, people, orders), [accounts, people, orders]);

  // ---- toolbar ----
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);
  const [layout, setLayout] = useState<InboxLayout>(() => loadLayout(viewerId));
  const changeLayout = (l: InboxLayout) => {
    setLayout(l);
    saveLayout(viewerId, l);
  };

  // ---- in-flight state ----
  const [overrides, setOverrides] = useState<Map<string, TaskCategory>>(() => new Map());
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const openSnapshot = useRef<Task | null>(null);
  const [dialog, setDialog] = useState<'add' | 'reassign' | null>(null);

  const claim = useClaimTask();
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const update = useUpdateTask();
  const runners = useRef({ claim: claim.mutateAsync, complete: complete.mutateAsync, reopen: reopen.mutateAsync, update: update.mutateAsync, toast });
  runners.current = { claim: claim.mutateAsync, complete: complete.mutateAsync, reopen: reopen.mutateAsync, update: update.mutateAsync, toast };

  const actions = useMemo<InboxActions>(() => {
    const markBusy = (id: string, on: boolean) =>
      setBusyIds((s) => {
        const next = new Set(s);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    const run = async (task: Task, kind: 'claim' | 'complete' | 'reopen') => {
      const r = runners.current;
      markBusy(task.id, true);
      try {
        const saved = await r[kind]({ scopeId: task.scopeId, taskId: task.id });
        upsertTaskInCaches(qc, saved);
        if (kind === 'claim') r.toast({ title: 'Task assigned to you', description: task.title, tone: 'success' });
        if (kind === 'complete') {
          r.toast({
            title: 'Task completed',
            description: task.title,
            tone: 'success',
            action: { label: 'Undo', onClick: () => void run(saved, 'reopen') },
          });
        }
        if (kind === 'reopen') r.toast({ title: 'Task reopened', description: task.title, tone: 'success' });
      } catch (e) {
        const title = kind === 'claim' ? 'This task could not be claimed' : kind === 'complete' ? 'Task not completed' : 'Task not reopened';
        r.toast({ title, description: errorMessage(e), tone: 'danger' });
      } finally {
        markBusy(task.id, false);
      }
    };
    return {
      busyIds: new Set<string>(),
      open: (task) => {
        openSnapshot.current = task;
        setOpenId(task.id);
      },
      claim: (task) => void run(task, 'claim'),
      complete: (task) => void run(task, 'complete'),
      reopen: (task) => void run(task, 'reopen'),
      recategorize: (task, category) => {
        const r = runners.current;
        const label = category ? categoryLabel(category) : 'automatic category';
        if (category) setOverrides((m) => new Map(m).set(task.id, category));
        setAnnouncement(`Moving “${task.title}” to ${label}…`);
        r.update({ scopeId: task.scopeId, taskId: task.id, input: { category } }).then(
          (saved) => {
            upsertTaskInCaches(qc, saved);
            setAnnouncement(`Moved “${task.title}” to ${categoryLabel(saved.category)}.`);
          },
          (e: unknown) => {
            setAnnouncement(`“${task.title}” was not moved.`);
            r.toast({ title: 'Task not moved', description: errorMessage(e), tone: 'danger' });
          },
        ).finally(() =>
          setOverrides((m) => {
            const next = new Map(m);
            next.delete(task.id);
            return next;
          }),
        );
      },
    };
  }, [qc]);
  const actionsValue = useMemo<InboxActions>(() => ({ ...actions, busyIds }), [actions, busyIds]);

  // ---- derived ----
  const multiBranch = branchIds.length > 1 || view === 'combined';
  const todayFor = useCallback((task: Pick<Task, 'branchId'>) => (task.branchId ? (boardToday?.[task.branchId] ?? today) : today), [boardToday, today]);
  const env = useMemo<InboxEnv>(
    () => ({ ...lookups, branchesById, multiBranch, readOnly, viewerId, todayFor, canManage }),
    [lookups, branchesById, multiBranch, readOnly, viewerId, todayFor, canManage],
  );

  const effectiveFilters = useMemo(() => ({ ...filters, search: deferredSearch }), [filters, deferredSearch]);
  const visible = useMemo(() => filterTasks(allTasks, effectiveFilters, viewerId, lookups), [allTasks, effectiveFilters, viewerId, lookups]);
  const groups = useMemo(() => groupByCategory(visible, overrides), [visible, overrides]);
  const cleared = useMemo(() => visible.filter((t) => t.status !== 'open'), [visible]);
  const counts = useMemo(() => (tasksQuery.data ? inboxCounts(allTasks, lookups.accountsById) : null), [tasksQuery.data, allTasks, lookups]);
  const tasksById = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks]);

  const scopeBranches = useMemo(() => branchIds.map((id) => branchesById.get(id)).filter((b): b is Branch => b !== undefined), [branchIds, branchesById]);
  const managedBranches = scopeBranches.filter((b) => canManage(b.id));
  const scopeName = scope === ALL_BRANCHES && branchIds.length > 1 ? 'All branches' : (scopeBranches[0]?.name ?? 'No branch');
  const toolbarPeople = useMemo(
    () => people.filter((p) => p.active && p.branchIds.some((b) => branchIds.includes(b))).sort((a, b) => a.name.localeCompare(b.name)),
    [people, branchIds],
  );

  const current = openId ? (tasksById.get(openId) ?? (openSnapshot.current?.id === openId ? openSnapshot.current : null)) : null;

  const changeView = (v: InboxView) => {
    setViewChoice(v);
    setOpenId(null);
    savePreferences({ inboxView: v });
    setFilters((f) => (v === 'personal' ? { ...f, assignee: 'all' } : f));
  };
  const changeDate = (d: string | null) => {
    setDate(d !== null && d >= today ? null : d);
    setOpenId(null);
  };

  const personalNotConnected = view !== 'branch' && mail.isSuccess && !isMailConnected(mail.data);
  const showFullConnect = view === 'personal' && personalNotConnected;
  const noBranches = branchIds.length === 0 && view !== 'personal';
  const canAdd = !readOnly && view !== 'personal' && scopeBranches.length > 0;
  const canReassign = !readOnly && view !== 'personal' && managedBranches.length > 0;
  const hasAnyTasks = allTasks.length > 0;

  let body: ReactNode;
  if (noBranches) {
    body = <EmptyState title="No branches assigned" description="Ask a manager to add you to a branch." />;
  } else if (tasksQuery.isError && !tasksQuery.data) {
    body = (
      <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft">
        <EmptyState
          title="The inbox did not load"
          description={errorMessage(tasksQuery.error)}
          action={
            <Button variant="primary" onClick={() => void tasksQuery.refetch()} loading={tasksQuery.isFetching}>
              Try again
            </Button>
          }
        />
      </div>
    );
  } else if (!tasksQuery.data) {
    body = <InboxSkeleton />;
  } else if (!hasAnyTasks) {
    body = showFullConnect ? null : (
      <EmptyState
        icon={<Inbox />}
        title={`No tasks for ${isToday ? 'today' : dayLabel(viewedDate, today)}`}
        description="Incoming email and manual tasks for this date will appear here."
      />
    );
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        icon={<SearchX />}
        title="Nothing matches these filters"
        description="Try a different search or clear the filters."
        action={<Button onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</Button>}
      />
    );
  } else {
    body = (
      <>
        {layout === 'list' ? <TaskListView tasks={visible} /> : <TaskQueue groups={groups} tasksById={tasksById} />}
        <ClearedTray tasks={cleared} isToday={isToday} />
      </>
    );
  }

  return (
    <InboxEnvContext.Provider value={env}>
      <InboxActionsContext.Provider value={actionsValue}>
        <section className="mx-auto flex max-w-[110rem] flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5" aria-busy={tasksQuery.isFetching || undefined}>
          <InboxHeader
            scopeName={scopeName}
            view={view}
            onView={changeView}
            showViews={personalMail}
            date={viewedDate}
            today={today}
            onDate={changeDate}
            counts={counts}
          />

          {readOnly ? (
            <p role="status" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-fg">
              <span className="font-semibold">Saved day · {dayLabel(viewedDate, today)}.</span> A read-only record of that day’s board: no claiming, moving or completing.
            </p>
          ) : null}

          {view !== 'branch' && personalMail ? (showFullConnect ? <PersonalMailCard variant="full" /> : <PersonalMailCard variant="strip" />) : null}

          {!noBranches && (hasAnyTasks || !showFullConnect) ? (
            <InboxToolbar
              filters={filters}
              onFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))}
              layout={layout}
              onLayout={changeLayout}
              people={toolbarPeople}
              viewerId={viewerId}
              showAssignee={view !== 'personal'}
              canAdd={canAdd}
              onAdd={() => setDialog('add')}
              canReassign={canReassign}
              onReassign={() => setDialog('reassign')}
            />
          ) : null}

          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>

          {body}
        </section>

        {current ? <TaskDrawer task={current} accounts={accounts} onClose={() => setOpenId(null)} /> : null}
        {dialog === 'add' ? (
          <AddTaskDialog branches={scopeBranches} accounts={accounts} people={people} viewerId={viewerId} onClose={() => setDialog(null)} />
        ) : null}
        {dialog === 'reassign' ? (
          <ReassignDialog
            branches={managedBranches}
            people={people}
            tasks={allTasks}
            todayFor={(branchId) => boardToday?.[branchId] ?? today}
            onClose={() => setDialog(null)}
          />
        ) : null}
      </InboxActionsContext.Provider>
    </InboxEnvContext.Provider>
  );
}

function InboxSkeleton() {
  return (
    <div aria-busy="true" className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <span className="sr-only">Loading tasks…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border border-line p-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ))}
    </div>
  );
}
