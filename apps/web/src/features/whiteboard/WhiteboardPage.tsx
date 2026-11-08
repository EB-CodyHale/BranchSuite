import { addDays, DEFAULT_HUDDLE_WINDOW, isDayKey, todayKey, whiteboardPaths, type Branch, type WhiteboardResponse, type WhiteboardSummary } from '@branchsuite/shared';
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, CloudCheck, Copy, MonitorPlay, Play, Presentation, RotateCcw, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ALL_BRANCHES, useBranchScope } from '../../app/BranchScope.js';
import { useMeContext } from '../../app/MeContext.js';
import { useDocumentTitle } from '../../app/useDocumentTitle.js';
import { errorMessage } from '../../lib/api.js';
import {
  fetchStaffMedia,
  useAssignmentDone,
  useAssignmentTask,
  useBoard,
  useCopyWhiteboard,
  useSetWhiteboardLive,
  useUploadMedia,
  useWhiteboard,
  useWhiteboards,
} from '../../lib/queries.js';
import { Button, buttonClasses } from '../../ui/Button.js';
import { ConfirmDialog } from '../../ui/ConfirmDialog.js';
import { cx } from '../../ui/cx.js';
import { Dialog } from '../../ui/Dialog.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Select } from '../../ui/Field.js';
import { IconButton } from '../../ui/IconButton.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { Spinner } from '../../ui/Spinner.js';
import { useToast } from '../../ui/Toast.js';
import { useNow } from '../wall/clock.js';
import { EditorEnvContext, type WhiteboardEditorEnv } from './EditorContext.js';
import { MediaLoaderContext } from './media.js';
import { MemberView } from './MemberView.js';
import { HUDDLE_STATE_LABEL, huddleState, longDate, shortDateParts, windowError, windowLabel, type HuddleState, type WhiteboardDraft } from './model.js';
import { Presenter } from './Presenter.js';
import { useWhiteboardDraft, type SaveStatus } from './useWhiteboardDraft.js';
import { WhiteboardEditor } from './WhiteboardEditor.js';

const DEFAULT_TZ = 'America/Chicago';

function safeToday(timeZone: string): string {
  try {
    return todayKey(timeZone);
  } catch {
    return todayKey(DEFAULT_TZ);
  }
}

/**
 * /whiteboard — the morning huddle whiteboard. Managers prepare one per branch per day (ahead of
 * time, or copied from a previous day) and it takes over every paired lobby display during the huddle
 * window. Members read it and tick off their own assignments.
 */
export function WhiteboardPage() {
  useDocumentTitle('Whiteboard');
  const { scope, allBranchIds, branchesById } = useBranchScope();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('branch');
  const branchId = fromUrl && allBranchIds.includes(fromUrl) ? fromUrl : scope !== ALL_BRANCHES ? scope : (allBranchIds[0] ?? '');
  const branch = branchesById.get(branchId);
  const timeZone = branch?.timeZone ?? DEFAULT_TZ;
  const today = safeToday(timeZone);
  const dateParam = params.get('date');
  const date = dateParam && isDayKey(dateParam) ? dateParam : today;

  const setParam = (name: string, value: string | null) =>
    setParams(
      (p) => {
        const out = new URLSearchParams(p);
        if (value === null) out.delete(name);
        else out.set(name, value);
        return out;
      },
      { replace: true },
    );
  const setDate = (d: string) => setParam('date', d === today ? null : d);

  if (!branch) {
    return (
      <section className="mx-auto max-w-7xl px-3 py-6 sm:px-5">
        <h1 className="font-display text-3xl font-bold">Morning whiteboard</h1>
        <EmptyState title="No branches" description="You are not assigned to a branch yet, so there is no whiteboard to show." />
      </section>
    );
  }

  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-6 sm:px-5" aria-labelledby="wb-title">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 id="wb-title" className="font-display text-3xl font-bold">
            Morning whiteboard
          </h1>
          <p className="mt-1 max-w-2xl text-muted">
            Talking points, assignments and priority orders for the huddle. While the huddle is live, every lobby display in {branch.name} shows this whiteboard instead
            of the board.
          </p>
        </div>
        {scope === ALL_BRANCHES && allBranchIds.length > 1 ? (
          <Select
            label="Branch"
            className="min-w-44"
            value={branchId}
            onChange={(e) => setParam('branch', e.target.value)}
            options={allBranchIds.map((id) => ({ value: id, label: branchesById.get(id)?.name ?? id }))}
          />
        ) : null}
      </header>

      <DateBar branchId={branchId} date={date} today={today} onChange={setDate} />

      <WhiteboardDay key={`${branchId}:${date}`} branch={branch} date={date} today={today} />
    </section>
  );
}

// =====================================================================================
// date bar
// =====================================================================================

function DateBar({ branchId, date, today, onChange }: { branchId: string; date: string; today: string; onChange: (d: string) => void }) {
  const from = addDays(date, -3);
  const to = addDays(date, 3);
  const list = useWhiteboards(branchId, addDays(date, -30), addDays(date, 30));
  const withBoards = useMemo(() => new Set((list.data ?? []).filter((s) => s.blockCount > 0).map((s) => s.date)), [list.data]);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const tomorrow = addDays(today, 1);

  return (
    <nav aria-label="Whiteboard date" className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2">
      <Button size="sm" variant={date === today ? 'primary' : 'secondary'} aria-pressed={date === today} onClick={() => onChange(today)}>
        Today
      </Button>
      <Button size="sm" variant={date === tomorrow ? 'primary' : 'secondary'} aria-pressed={date === tomorrow} onClick={() => onChange(tomorrow)}>
        Tomorrow
      </Button>
      <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
      <IconButton label="Previous day" size="sm" onClick={() => onChange(addDays(date, -1))}>
        <ChevronLeft />
      </IconButton>
      <ol className="flex items-center gap-1 overflow-x-auto" aria-label="Nearby days">
        {days.map((d) => {
          const p = shortDateParts(d);
          const has = withBoards.has(d);
          const selected = d === date;
          return (
            <li key={d}>
              <button
                type="button"
                aria-current={selected ? 'date' : undefined}
                aria-label={`${longDate(d)}${d === today ? ' (today)' : ''}${has ? ', has a whiteboard' : ''}`}
                onClick={() => onChange(d)}
                className={cx(
                  'flex w-11 flex-col items-center rounded-md py-1 text-xs leading-tight transition-colors',
                  selected ? 'bg-accent text-accent-fg' : 'hover:bg-surface-2',
                  d === today && !selected && 'ring-1 ring-accent',
                )}
              >
                <span className={selected ? '' : 'text-muted'}>{p.weekday}</span>
                <span className="font-display text-base font-bold tabular-nums">{p.day}</span>
                <span aria-hidden="true" className={cx('mt-0.5 size-1.5 rounded-full', has ? (selected ? 'bg-accent-fg' : 'bg-accent') : 'bg-transparent')} />
              </button>
            </li>
          );
        })}
      </ol>
      <IconButton label="Next day" size="sm" onClick={() => onChange(addDays(date, 1))}>
        <ChevronRight />
      </IconButton>
      <label className="ml-auto inline-flex items-center gap-2 text-sm font-semibold">
        <CalendarDays aria-hidden="true" className="size-4 text-muted" />
        <span className="sr-only">Pick a date</span>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            if (isDayKey(e.target.value)) onChange(e.target.value);
          }}
          className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm"
        />
      </label>
    </nav>
  );
}

// =====================================================================================
// one branch + day
// =====================================================================================

function WhiteboardDay({ branch, date, today }: { branch: Branch; date: string; today: string }) {
  const branchId = branch.id;
  const { me, canManage } = useMeContext();
  const manager = canManage(branchId);
  const { toast } = useToast();
  const query = useWhiteboard(branchId, date);
  const server = query.data;

  const onConflict = useCallback(
    () => toast({ title: 'Someone else changed this whiteboard', description: 'The latest version is loaded. Check your last change and make it again if needed.', tone: 'danger' }),
    [toast],
  );
  const editor = useWhiteboardDraft({ branchId, date, server, onConflict, enabled: manager });

  const [presenting, setPresenting] = useState(false);

  if (query.isError && !server) {
    return <EmptyState title="Could not load the whiteboard" description={query.error.message} action={<Button onClick={() => void query.refetch()}>Try again</Button>} />;
  }
  if (!server || (manager && !editor.draft)) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Loading the whiteboard">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <MediaLoaderContext.Provider value={fetchStaffMedia}>
      <StatusStrip
        branch={branch}
        date={date}
        today={today}
        server={server}
        draft={editor.draft}
        manager={manager}
        saveStatus={editor.status}
        saveError={editor.error}
        onRetrySave={() => void editor.flush()}
        onWindowChange={(window) => editor.update((d) => ({ ...d, window }))}
        flush={editor.flush}
        adopt={editor.adopt}
        onPresent={() => setPresenting(true)}
      />

      {manager && editor.draft ? (
        <ManagerEditor branch={branch} date={date} draft={editor.draft} update={editor.update} flush={editor.flush} />
      ) : server.view ? (
        <MemberSection branchId={branchId} date={date} server={server} meId={me.user.id} />
      ) : (
        <EmptyState title="No whiteboard for this day" description="Your manager has not prepared a whiteboard for this day yet." />
      )}

      {presenting && server.view ? (
        <Presenter view={server.view} branchName={branch.name} timeZone={branch.timeZone} loadMedia={fetchStaffMedia} onClose={() => setPresenting(false)} />
      ) : null}
    </MediaLoaderContext.Provider>
  );
}

// =====================================================================================
// status strip: window, live state, live controls, copy, present, preview
// =====================================================================================

const PILL: Record<HuddleState, string> = {
  live: 'bg-success-soft text-success',
  scheduled: 'bg-accent-soft text-accent',
  off: 'bg-surface-2 text-muted',
};

interface StatusStripProps {
  branch: Branch;
  date: string;
  today: string;
  server: WhiteboardResponse;
  draft: WhiteboardDraft | null;
  manager: boolean;
  saveStatus: SaveStatus;
  saveError: string | null;
  onRetrySave: () => void;
  onWindowChange: (w: { start: string; end: string }) => void;
  flush: () => Promise<WhiteboardResponse | null>;
  adopt: (res: WhiteboardResponse) => void;
  onPresent: () => void;
}

function StatusStrip(props: StatusStripProps) {
  const { branch, date, today, server, draft, manager } = props;
  const { toast } = useToast();
  const now = useNow(15_000);
  const wb = server.whiteboard;
  const huddleWindow = draft?.window ?? wb?.window ?? DEFAULT_HUDDLE_WINDOW;
  const state = wb ? huddleState({ date: wb.date, live: wb.live, window: huddleWindow }, branch.timeZone, now) : 'scheduled';
  const live = useSetWhiteboardLive();
  const copy = useCopyWhiteboard();
  const [copyOpen, setCopyOpen] = useState(false);
  const isToday = date === today;

  const setLive = async (value: 'on' | 'off' | 'auto') => {
    try {
      // The board must exist (and hold the latest edits) before it can go live.
      const saved = await props.flush();
      if (!saved?.whiteboard) throw new Error('Save the whiteboard first.');
      await live.mutateAsync({ branchId: branch.id, date, live: value });
      toast({
        title: value === 'on' ? 'The whiteboard is live on displays' : value === 'off' ? 'Displays are back on the board' : 'Following the huddle schedule',
        tone: 'success',
      });
    } catch (e) {
      toast({ title: 'Could not change the huddle', description: errorMessage(e), tone: 'danger' });
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="font-display text-xl font-semibold">{longDate(date)}</h2>
        {wb ? (
          <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-bold', PILL[state])} data-huddle-state={state}>
            <span aria-hidden="true" className={cx('size-2 rounded-full', state === 'live' ? 'animate-pulse-soft bg-success' : state === 'scheduled' ? 'bg-accent' : 'border border-line-strong')} />
            {HUDDLE_STATE_LABEL[state]}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-sm font-semibold text-muted">Not prepared yet</span>
        )}
        {manager && draft ? (
          <WindowEditor value={draft.window} onChange={props.onWindowChange} />
        ) : (
          <span className="text-sm font-semibold text-muted">Huddle {windowLabel(huddleWindow)}</span>
        )}
        {manager ? <SaveIndicator status={props.saveStatus} error={props.saveError} onRetry={props.onRetrySave} /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {manager ? (
          <>
            {state !== 'live' ? (
              <Button
                size="sm"
                variant="primary"
                icon={<Play aria-hidden="true" className="size-4" />}
                disabled={!isToday}
                title={isToday ? 'Show this whiteboard on every display now' : "Only today's whiteboard can go live"}
                loading={live.isPending && live.variables?.live === 'on'}
                onClick={() => void setLive('on')}
              >
                Start now
              </Button>
            ) : (
              <Button size="sm" variant="danger" icon={<Square aria-hidden="true" className="size-4" />} loading={live.isPending && live.variables?.live === 'off'} onClick={() => void setLive('off')}>
                End
              </Button>
            )}
            {wb && wb.live !== 'auto' ? (
              <Button size="sm" icon={<RotateCcw aria-hidden="true" className="size-4" />} loading={live.isPending && live.variables?.live === 'auto'} onClick={() => void setLive('auto')}>
                Back to schedule
              </Button>
            ) : null}
            <Button size="sm" icon={<Copy aria-hidden="true" className="size-4" />} onClick={() => setCopyOpen(true)}>
              Copy from…
            </Button>
          </>
        ) : null}
        <Button size="sm" icon={<Presentation aria-hidden="true" className="size-4" />} disabled={!server.view} onClick={props.onPresent}>
          Present
        </Button>
        <Link to={`/board/wall-preview?mode=whiteboard&branch=${encodeURIComponent(branch.id)}`} className={buttonClasses('ghost', 'sm')}>
          <MonitorPlay aria-hidden="true" className="size-4" />
          Preview on wall
        </Link>
        {!isToday && manager ? <span className="text-xs text-muted">Only today's whiteboard can go live. This one goes live on its own day during the huddle window.</span> : null}
      </div>

      {copyOpen ? (
        <CopyFromDialog
          branchId={branch.id}
          date={date}
          hasContent={(draft?.blocks.length ?? 0) > 0}
          busy={copy.isPending}
          onClose={() => setCopyOpen(false)}
          onCopy={async (fromDate) => {
            try {
              await props.flush();
              const res = await copy.mutateAsync({ branchId: branch.id, date, fromDate });
              props.adopt(res);
              setCopyOpen(false);
              toast({ title: `Copied from ${longDate(fromDate)}`, description: 'Assignments start un-ticked and without linked tasks.', tone: 'success' });
            } catch (e) {
              toast({ title: 'Could not copy the whiteboard', description: errorMessage(e), tone: 'danger' });
            }
          }}
        />
      ) : null}
    </div>
  );
}

function SaveIndicator({ status, error, onRetry }: { status: SaveStatus; error: string | null; onRetry: () => void }) {
  return (
    <span className="ml-auto inline-flex items-center gap-1.5 text-sm" role="status" aria-live="polite" data-save-status={status}>
      {status === 'saving' ? (
        <>
          <Spinner size="sm" label={null} />
          <span className="text-muted">Saving…</span>
        </>
      ) : status === 'dirty' ? (
        <span className="text-muted">Unsaved changes</span>
      ) : status === 'error' ? (
        <>
          <CircleAlert aria-hidden="true" className="size-4 text-danger" />
          <span className="font-semibold text-danger">Not saved{error ? `: ${error}` : ''}</span>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </>
      ) : (
        <>
          <CloudCheck aria-hidden="true" className="size-4 text-success" />
          <span className="text-muted">All changes saved</span>
        </>
      )}
    </span>
  );
}

function WindowEditor({ value, onChange }: { value: { start: string; end: string }; onChange: (w: { start: string; end: string }) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const problem = windowError(local);
  const set = (part: 'start' | 'end', v: string) => {
    const next = { ...local, [part]: v };
    setLocal(next);
    if (!windowError(next)) onChange(next);
  };
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">Huddle window</legend>
      <span className="text-sm font-semibold">Huddle</span>
      <label className="sr-only" htmlFor="wb-window-start">
        Huddle starts
      </label>
      <input
        id="wb-window-start"
        type="time"
        value={local.start}
        onChange={(e) => set('start', e.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? 'wb-window-error' : undefined}
        className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm tabular-nums"
      />
      <span aria-hidden="true">–</span>
      <label className="sr-only" htmlFor="wb-window-end">
        Huddle ends
      </label>
      <input
        id="wb-window-end"
        type="time"
        value={local.end}
        onChange={(e) => set('end', e.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? 'wb-window-error' : undefined}
        className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm tabular-nums"
      />
      {problem ? (
        <span id="wb-window-error" role="alert" className="text-sm font-medium text-danger">
          {problem}
        </span>
      ) : null}
    </fieldset>
  );
}

function CopyFromDialog(props: { branchId: string; date: string; hasContent: boolean; busy: boolean; onClose: () => void; onCopy: (fromDate: string) => void }) {
  const list = useWhiteboards(props.branchId, addDays(props.date, -60), addDays(props.date, -1));
  const [picked, setPicked] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const options: WhiteboardSummary[] = useMemo(
    () => [...(list.data ?? [])].filter((s) => s.date < props.date && s.blockCount > 0).sort((a, b) => b.date.localeCompare(a.date)),
    [list.data, props.date],
  );
  const go = () => {
    if (!picked) return;
    if (props.hasContent) setConfirming(true);
    else props.onCopy(picked);
  };
  return (
    <>
      <Dialog
        open={!confirming}
        onClose={props.onClose}
        title="Copy from another day"
        description={`Start ${longDate(props.date)} from a previous whiteboard.`}
        footer={
          <>
            <Button onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" disabled={!picked} loading={props.busy} onClick={go}>
              Copy
            </Button>
          </>
        }
      >
        {list.isPending ? (
          <Spinner label="Loading previous whiteboards…" />
        ) : list.isError ? (
          <p className="text-sm text-danger">{list.error.message}</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-muted">No whiteboards in the last 60 days to copy from.</p>
        ) : (
          <fieldset>
            <legend className="sr-only">Previous whiteboards</legend>
            <ul className="flex flex-col gap-1">
              {options.map((s) => (
                <li key={s.date}>
                  <label className={cx('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2', picked === s.date ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}>
                    <input type="radio" name="wb-copy-from" value={s.date} checked={picked === s.date} onChange={() => setPicked(s.date)} className="accent-accent" />
                    <span className="flex-1">
                      <span className="block font-semibold">{longDate(s.date)}</span>
                      <span className="block text-sm text-muted">
                        {s.title} · {s.blockCount} {s.blockCount === 1 ? 'block' : 'blocks'}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
      </Dialog>
      <ConfirmDialog
        open={confirming}
        title="Replace this whiteboard?"
        description={`The blocks on ${longDate(props.date)} are replaced with the ones from ${picked ? longDate(picked) : 'that day'}. This cannot be undone.`}
        confirmLabel="Replace"
        tone="danger"
        loading={props.busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => picked && props.onCopy(picked)}
      />
    </>
  );
}

// =====================================================================================
// manager editor + member view wiring
// =====================================================================================

function ManagerEditor({
  branch,
  date,
  draft,
  update,
  flush,
}: {
  branch: Branch;
  date: string;
  draft: WhiteboardDraft;
  update: (fn: (d: WhiteboardDraft) => WhiteboardDraft) => void;
  flush: () => Promise<WhiteboardResponse | null>;
}) {
  const branchId = branch.id;
  const { toast } = useToast();
  const board = useBoard([branchId]);
  const task = useAssignmentTask();
  const uploadMedia = useUploadMedia();
  const [creatingTaskFor, setCreatingTaskFor] = useState<string | null>(null);

  const data = board.data;
  const env = useMemo<WhiteboardEditorEnv>(() => {
    const orders = (data?.orders ?? []).filter((o) => o.branchId === branchId && o.status === 'active');
    return {
      branchId,
      date,
      people: (data?.people ?? []).filter((p) => p.active && p.branchIds.includes(branchId)).sort((a, b) => a.name.localeCompare(b.name)),
      orders,
      ordersById: new Map(orders.map((o) => [o.id, o])),
      accountsById: new Map((data?.accounts ?? []).map((a) => [a.id, a])),
      orderLabels: draft.orderLabels,
      setOrderLabels: (orderLabels) => update((d) => ({ ...d, orderLabels })),
      creatingTaskFor,
      createTask: async (itemId) => {
        setCreatingTaskFor(itemId);
        try {
          const saved = await flush();
          if (!saved?.whiteboard) throw new Error('Save the whiteboard first.');
          const res = await task.mutateAsync({ branchId, date, itemId });
          const taskId = res.task.id;
          update((d) => ({
            ...d,
            blocks: d.blocks.map((b) => (b.kind === 'assignments' ? { ...b, items: b.items.map((i) => (i.id === itemId ? { ...i, taskId } : i)) } : b)),
          }));
          toast({ title: 'Inbox task created', description: 'It is assigned to the same person and linked to this assignment.', tone: 'success' });
        } catch (e) {
          toast({ title: 'Could not create the task', description: errorMessage(e), tone: 'danger' });
        } finally {
          setCreatingTaskFor(null);
        }
      },
      upload: (file, signal) => uploadMedia.mutateAsync({ branchId, file, signal }),
      mediaUrl: (id) => whiteboardPaths.media(branchId, id),
    };
    // mutateAsync identities are stable; the env must change when roster, orders or labels change.
  }, [data, branchId, date, draft.orderLabels, creatingTaskFor, update, flush, toast]);

  return (
    <EditorEnvContext.Provider value={env}>
      <WhiteboardEditor draft={draft} update={update} />
    </EditorEnvContext.Provider>
  );
}

function MemberSection({ branchId, date, server, meId }: { branchId: string; date: string; server: WhiteboardResponse; meId: string }) {
  const done = useAssignmentDone();
  const { toast } = useToast();
  return (
    <MemberView
      view={server.view!}
      whiteboard={server.whiteboard}
      meId={meId}
      pendingItemId={done.isPending ? (done.variables?.itemId ?? null) : null}
      onToggleDone={(itemId, value) =>
        void done.mutateAsync({ branchId, date, itemId, done: value }).catch((e: unknown) => toast({ title: 'Could not update the assignment', description: errorMessage(e), tone: 'danger' }))
      }
    />
  );
}
