import { toWallFeed, type Branch, type BoardResponse, type OpeningState, type WallFeed, type WallSettings } from '@branchsuite/shared';
import { CirclePause, Star } from 'lucide-react';
import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { themeScope } from '../../app/theme.js';
import { useBoard } from '../../lib/queries.js';
import { buttonClasses } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { Segmented } from '../../ui/Segmented.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { WallGlyph } from '../../ui/WallGlyph.js';
import { ErrorNote } from './setupUi.js';

// The wall feature owns the TV renderer; load it on demand so setup does not pull wall CSS up front.
const WallBoard = lazy(() => import('../wall/WallBoard.js').then((m) => ({ default: m.WallBoard })));
const ScaledFrame = lazy(() => import('../wall/ScaledFrame.js').then((m) => ({ default: m.ScaledFrame })));

/** Order keys in the preview: never shown, but toWallFeed requires a key function. */
const previewKey = (id: string) => id.slice(-6);

/** The exact feed the TV would get with these (unsaved) settings, computed with the shared privacy boundary. */
export function previewFeed(branch: Branch, settings: WallSettings, board: Pick<BoardResponse, 'orders' | 'accounts' | 'people'>, now: Date): WallFeed {
  return toWallFeed({ branch: { ...branch, wall: settings }, orders: board.orders, accounts: board.accounts, people: board.people, now, keyFor: previewKey });
}

export function WallPreviewPanel({ branch, settings }: { branch: Branch; settings: WallSettings }) {
  const board = useBoard([branch.id]);
  const [view, setView] = useState<'tv' | 'list'>('tv');
  const feed = useMemo(() => (board.data ? previewFeed(branch, settings, board.data, new Date()) : null), [board.data, branch, settings]);

  return (
    <section aria-labelledby="wall-preview-h" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 id="wall-preview-h" className="font-display text-lg font-semibold leading-tight">
            Live preview
          </h3>
          <p className="text-xs text-muted">What the lobby TV would show with the settings on this page, before you save.</p>
        </div>
        <Segmented
          label="Preview style"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'tv', label: 'TV' },
            { value: 'list', label: 'List' },
          ]}
        />
      </div>
      <ErrorNote error={board.error} />
      {!feed ? (
        <Skeleton className="aspect-video w-full" />
      ) : view === 'tv' ? (
        <TvFallbackBoundary fallback={<CompactWallPreview feed={feed} />}>
          <Suspense fallback={<Skeleton className="aspect-video w-full" />}>
            <ScaledFrame label={`Lobby display preview for ${branch.name}`}>
              <WallBoard feed={feed} frame="embedded" />
            </ScaledFrame>
          </Suspense>
        </TvFallbackBoundary>
      ) : (
        <CompactWallPreview feed={feed} />
      )}
      <div className="flex flex-wrap gap-2">
        <Link to="/board/wall-preview" className={buttonClasses('secondary', 'sm')}>
          Saved wall preview
        </Link>
        <Link to="/setup/displays" className={buttonClasses('ghost', 'sm')}>
          Displays
        </Link>
      </div>
    </section>
  );
}

/** If the TV renderer fails to load (or throws), fall back to the compact list rather than a blank panel. */
class TvFallbackBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const SYMBOL: Record<OpeningState, { glyph: string; word: string }> = {
  open: { glyph: '○', word: 'Open' },
  tentative: { glyph: '◌', word: 'Pending' },
  committed: { glyph: '●', word: 'Filled' },
  started: { glyph: '✓', word: 'Started' },
};

/** Text-first rendering of the coded feed: readable at phone width, and the fallback for the TV view. */
export function CompactWallPreview({ feed }: { feed: WallFeed }) {
  const dark = feed.settings.theme === 'dark';
  return (
    <div {...themeScope(dark ? 'night' : 'daylight')} className="overflow-hidden rounded-md border border-line bg-bg text-fg">
      <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line bg-surface px-3 py-2">
        <p className="font-display text-lg font-bold">{feed.branch.name}</p>
        <p className="text-sm font-semibold tabular-nums text-muted">
          {feed.totals.toFill} to fill · {feed.totals.orders} orders
        </p>
        {feed.settings.headline ? <p className="w-full text-sm font-semibold text-accent">{feed.settings.headline}</p> : null}
      </div>
      {feed.orders.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted">No orders would show right now.</p>
      ) : (
        <ul aria-label="Orders the public would see" className="max-h-[26rem] divide-y divide-line overflow-y-auto">
          {feed.orders.map((o) => (
            <li key={o.key} className="flex items-start gap-2.5 px-3 py-2">
              {o.client ? <WallGlyph glyph={o.client.glyph} color={o.client.color} code={o.client.code} size={30} /> : <span aria-hidden="true" className="inline-block size-[30px] rounded-full border border-dashed border-line-strong" />}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-1.5 font-semibold leading-tight">
                  {o.isPriority ? <Star aria-label="Priority" className="size-3.5 text-warning" fill="currentColor" /> : null}
                  {o.clientName ? <span className="text-danger">{o.clientName} ·</span> : null}
                  <span>{o.role}</span>
                  {o.shift ? <span className="text-muted">· {o.shift}</span> : null}
                  {o.paused ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-warning">
                      <CirclePause aria-hidden="true" className="size-3.5" />
                      Paused
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted">{[o.schedule, o.pay, o.location].filter(Boolean).join(' · ') || ' '}</p>
                <p className="mt-0.5 flex flex-wrap gap-1 text-base leading-none">
                  <span className="sr-only">Lines: {o.openings.map((l) => SYMBOL[l.state].word + (l.mark ? ` ${l.mark}` : '')).join(', ') || 'none shown'}</span>
                  {o.openings.map((l, i) => (
                    <span key={i} aria-hidden="true" className={cx('inline-flex items-center gap-0.5', l.state === 'started' ? 'text-success' : l.state === 'committed' ? 'text-accent' : l.state === 'tentative' ? 'text-muted' : 'text-fg')}>
                      {SYMBOL[l.state].glyph}
                      {l.mark ? <span className="text-[0.6875rem] font-bold">{l.mark}</span> : null}
                    </span>
                  ))}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-display text-xl font-bold leading-none tabular-nums">{o.toFill}</span>
                {o.owner ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold">
                    <MarkerDot marker={o.owner.marker} />
                    {o.owner.initials}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
