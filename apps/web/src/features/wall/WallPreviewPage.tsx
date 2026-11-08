import type { WallFeed, WallLegend } from '@branchsuite/shared';
import { ClipboardList, Eye, EyeOff, LayoutGrid, Maximize, MonitorSmartphone, Presentation, Settings2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ALL_BRANCHES, useBranchScope } from '../../app/BranchScope.js';
import { useMeContext } from '../../app/MeContext.js';
import { useDocumentTitle } from '../../app/useDocumentTitle.js';
import { fetchStaffMedia, useWallLegend, useWallPreview } from '../../lib/queries.js';
import { Button, buttonClasses } from '../../ui/Button.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Select } from '../../ui/Field.js';
import { IconButton } from '../../ui/IconButton.js';
import { Segmented } from '../../ui/Segmented.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { WallGlyph, wallCodeLabel } from '../../ui/WallGlyph.js';
import { ScaledFrame } from './ScaledFrame.js';
import { screenModeOf, WallScreen } from './WallScreen.js';

type PreviewMode = 'board' | 'whiteboard';

export function legendMap(legend: WallLegend | undefined): Map<string, string> | undefined {
  return legend ? new Map(legend.entries.map((e) => [e.code, e.name])) : undefined;
}

/**
 * /board/wall-preview — staff see exactly the feed the lobby TV gets, with an optional STAFF ONLY legend.
 * `?mode=whiteboard` previews the huddle takeover (today's whiteboard as the TV shows it while live).
 */
export function WallPreviewPage() {
  useDocumentTitle('Wall preview');
  const { scope, allBranchIds, branchesById } = useBranchScope();
  const { canManage } = useMeContext();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('branch');
  const [picked, setPicked] = useState<string | null>(fromUrl);
  const branchId = picked && allBranchIds.includes(picked) ? picked : scope !== ALL_BRANCHES ? scope : (allBranchIds[0] ?? '');
  const mode: PreviewMode = params.get('mode') === 'whiteboard' ? 'whiteboard' : 'board';
  const setMode = (next: PreviewMode) =>
    setParams(
      (p) => {
        const out = new URLSearchParams(p);
        if (next === 'whiteboard') out.set('mode', 'whiteboard');
        else out.delete('mode');
        return out;
      },
      { replace: true },
    );
  const [showLegend, setShowLegend] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const preview = useWallPreview(branchId, { enabled: branchId !== '', mode });
  const legendQuery = useWallLegend(branchId, { enabled: branchId !== '' && showLegend && mode === 'board' });
  const legend = showLegend && mode === 'board' ? legendMap(legendQuery.data) : undefined;
  const branchName = branchesById.get(branchId)?.name ?? '';

  if (allBranchIds.length === 0) {
    return (
      <section className="mx-auto max-w-7xl px-3 py-6 sm:px-5">
        <h1 className="font-display text-3xl font-bold">Wall preview</h1>
        <EmptyState title="No branches" description="You are not assigned to a branch yet, so there is no wall to preview." />
      </section>
    );
  }

  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-6 sm:px-5" aria-labelledby="wall-preview-title">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 id="wall-preview-title" className="font-display text-3xl font-bold">
            Wall preview
          </h1>
          <p className="mt-1 max-w-2xl text-muted">
            The lobby display shows exactly this. Codes, symbols and hidden fields are applied on the server, so nothing here reaches the TV that you cannot see.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {allBranchIds.length > 1 ? (
            <Select
              label="Branch"
              className="min-w-44"
              value={branchId}
              onChange={(e) => setPicked(e.target.value)}
              options={allBranchIds.map((id) => ({ value: id, label: branchesById.get(id)?.name ?? id }))}
            />
          ) : null}
          <Segmented<PreviewMode>
            label="Preview"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'board', label: 'Board', icon: <LayoutGrid aria-hidden="true" className="size-4" /> },
              { value: 'whiteboard', label: 'Whiteboard', icon: <Presentation aria-hidden="true" className="size-4" /> },
            ]}
          />
          {mode === 'board' ? (
            <Button aria-pressed={showLegend} icon={showLegend ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />} onClick={() => setShowLegend((v) => !v)}>
              {showLegend ? 'Hide legend' : 'Show legend'}
            </Button>
          ) : null}
          <Button icon={<Maximize aria-hidden="true" className="size-4" />} onClick={() => setFullscreen(true)} disabled={!preview.data}>
            Full-screen preview
          </Button>
        </div>
      </header>

      {mode === 'whiteboard' ? (
        <p role="note" className="max-w-3xl rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
          During the huddle window every paired display in the branch shows today's whiteboard instead of the board, including names. Outside the window displays never
          receive whiteboard content.
        </p>
      ) : null}

      {canManage(branchId) ? (
        <nav aria-label="Wall setup" className="flex flex-wrap gap-2">
          <Link to="/whiteboard" className={buttonClasses('ghost', 'sm')}>
            <ClipboardList aria-hidden="true" className="size-4" />
            Morning whiteboard
          </Link>
          <Link to="/setup/wall" className={buttonClasses('ghost', 'sm')}>
            <Settings2 aria-hidden="true" className="size-4" />
            Wall settings
          </Link>
          <Link to="/setup/displays" className={buttonClasses('ghost', 'sm')}>
            <MonitorSmartphone aria-hidden="true" className="size-4" />
            Displays and pairing
          </Link>
        </nav>
      ) : null}

      {showLegend && mode === 'board' ? (
        <p role="note" className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-warning bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">
          <span className="rounded-sm border border-warning px-1.5 text-xs font-bold uppercase tracking-widest">Staff only</span>
          The legend adds client names for you. It is never sent to the lobby display.
          {legendQuery.isError ? <span className="text-danger">Could not load the legend: {legendQuery.error.message}</span> : null}
        </p>
      ) : null}

      <PreviewBody mode={mode} branchName={branchName} feed={preview.data} isError={preview.isError} errorMessage={preview.error?.message} legend={legend} onRetry={() => void preview.refetch()} />

      {showLegend && mode === 'board' && legendQuery.data ? <LegendTable legend={legendQuery.data} /> : null}

      {fullscreen && preview.data ? <FullscreenPreview feed={preview.data} legend={legend} onClose={() => setFullscreen(false)} /> : null}
    </section>
  );
}

function PreviewBody(props: { mode: PreviewMode; branchName: string; feed: WallFeed | undefined; isError: boolean; errorMessage?: string; legend?: Map<string, string>; onRetry: () => void }) {
  const label = `Lobby display preview for ${props.branchName || 'this branch'}`;
  if (props.isError) {
    return (
      <ScaledFrame label={label}>
        <div data-theme="night" className="grid h-full place-items-center bg-bg text-fg">
          <EmptyState title="Could not load the wall preview" description={props.errorMessage} action={<Button onClick={props.onRetry}>Try again</Button>} className="text-[1.6rem]" />
        </div>
      </ScaledFrame>
    );
  }
  if (!props.feed) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line" role="status" aria-label="Loading wall preview">
        <Skeleton className="absolute inset-0 rounded-none" />
      </div>
    );
  }
  if (props.mode === 'whiteboard' && screenModeOf(props.feed) !== 'whiteboard') {
    return (
      <ScaledFrame label={label}>
        <div data-theme="night" className="grid h-full place-items-center bg-bg text-fg">
          <EmptyState
            title="No whiteboard for today yet"
            description="Prepare one in Board → Whiteboard. Displays keep showing the board until a whiteboard is live."
            action={
              <Link to="/whiteboard" className={buttonClasses('primary', 'lg')}>
                Open the whiteboard
              </Link>
            }
            className="text-[1.6rem]"
          />
        </div>
      </ScaledFrame>
    );
  }
  return (
    <ScaledFrame label={label}>
      <WallScreen feed={props.feed} legend={props.legend} frame="embedded" loadMedia={fetchStaffMedia} />
    </ScaledFrame>
  );
}

function LegendTable({ legend }: { legend: WallLegend }) {
  const entries = useMemo(() => [...legend.entries].sort((a, b) => a.code.localeCompare(b.code)), [legend]);
  return (
    <section aria-labelledby="wall-legend-title" className="rounded-lg border border-dashed border-warning bg-surface p-4">
      <h2 id="wall-legend-title" className="flex items-center gap-2 font-display text-xl font-semibold">
        Wall code legend
        <span className="rounded-sm bg-warning-soft px-1.5 py-0.5 text-xs font-bold uppercase tracking-widest text-warning">Staff only</span>
      </h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No accounts have wall codes yet.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-4 gap-y-2">
          {entries.map((e) => (
            <li key={e.accountId} className="flex min-w-0 items-center gap-2">
              <WallGlyph glyph={e.glyph} color={e.color} size="1.75rem" label={wallCodeLabel(e.glyph, e.color)} />
              <span className="w-10 shrink-0 font-display text-lg font-bold tabular-nums">{e.code}</span>
              <span className="truncate text-sm">{e.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Covers the window with the board at real size, and asks the browser for fullscreen when it can. */
function FullscreenPreview({ feed, legend, onClose }: { feed: WallFeed; legend?: Map<string, string>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    let entered = false;
    if (el?.requestFullscreen) {
      el.requestFullscreen().then(
        () => {
          entered = true;
        },
        () => undefined,
      );
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    const onChange = () => {
      if (entered && !document.fullscreenElement) onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
      opener?.focus?.();
    };
  }, []);

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Full-screen wall preview" className="fixed inset-0 z-50 bg-bg">
      <WallScreen feed={feed} legend={legend} frame="fullscreen" loadMedia={fetchStaffMedia} />
      <IconButton ref={closeRef} label="Close full-screen preview" variant="secondary" size="lg" onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full shadow-pop">
        <X />
      </IconButton>
    </div>
  );
}
