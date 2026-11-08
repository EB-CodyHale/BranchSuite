import { OPENING_STATES, type WallFeed } from '@branchsuite/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { markerVars } from '../../app/theme.js';
import { cx } from '../../ui/cx.js';
import { clockParts, useNow } from './clock.js';
import { useElementSize, useFontsReady, usePrefersReducedMotion } from './hooks.js';
import { burnInOffset, clampPage, columnsFor, columnWidth, gapPx, paginate, tileMinWidthPx, wallFontPx } from './layout.js';
import { OPENING_WORDS, OpeningSymbol } from './OpeningSymbol.js';
import { WallTile } from './WallTile.js';
import './wall.css';

export interface WallBoardProps {
  feed: WallFeed;
  /** Wall code -> account name. Staff preview only; never passed on the lobby display. */
  legend?: Map<string, string>;
  /** 'fullscreen' fills the viewport (lobby TV); 'embedded' fills its parent (staff preview frame). */
  frame?: 'fullscreen' | 'embedded';
  className?: string;
}

/** Burn-in drift step on a single page (no rotation to piggyback on). */
const DRIFT_MS = 3 * 60_000;

function sameNumbers(a: readonly number[] | null, b: readonly number[]): boolean {
  return a !== null && a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The lobby-TV board. Pure presentation of a server-coded WallFeed: it adds nothing the feed does not
 * hold (the staff legend, when given, is clearly marked STAFF ONLY). Large-format type scales with the
 * board size; tiles are measured and split into pages that rotate every `pageSeconds`.
 */
export function WallBoard({ feed, legend, frame = 'fullscreen', className }: WallBoardProps) {
  const tone = feed.settings.theme === 'light' ? 'light' : 'dark';
  const orders = feed.orders;

  const [rootRef, root] = useElementSize<HTMLDivElement>();
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const fontPx = wallFontPx(root.width, root.height);
  const gap = gapPx(fontPx);
  const columns = columnsFor(stage.width, tileMinWidthPx(root.width, fontPx), gap);
  const colWidth = columnWidth(stage.width, columns, gap);
  const measurable = stage.width > 0 && stage.height > 0 && orders.length > 0;

  // Measure every tile at column width in a hidden layer, then pack rows into pages.
  const measureRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<number[] | null>(null);
  const fontsTick = useFontsReady();
  const legendKey = legend ? [...legend].map(([k, v]) => `${k}=${v}`).join('|') : '';
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!measurable || !el) {
      setHeights(null);
      return;
    }
    const next = Array.from(el.children, (c) => Math.ceil((c as HTMLElement).offsetHeight));
    setHeights((prev) => (sameNumbers(prev, next) ? prev : next));
  }, [measurable, orders, colWidth, fontPx, legendKey, fontsTick]);

  const pages = useMemo(() => {
    if (!heights || heights.length !== orders.length) return [orders.map((_, i) => i)];
    return paginate(heights, columns, stage.height, gap);
  }, [heights, orders, columns, stage.height, gap]);

  const [pageIndex, setPageIndex] = useState(0);
  const [drift, setDrift] = useState(0);
  const page = clampPage(pageIndex, pages.length);
  const pageCount = pages.length;
  const pageMs = Math.max(5, feed.settings.pageSeconds) * 1000;

  useEffect(() => {
    if (pageCount <= 1) return;
    const id = setInterval(() => {
      setPageIndex((i) => {
        const next = (clampPage(i, pageCount) + 1) % pageCount;
        if (next === 0) setDrift((d) => d + 1);
        return next;
      });
    }, pageMs);
    return () => clearInterval(id);
  }, [pageCount, pageMs]);

  useEffect(() => {
    if (frame !== 'fullscreen') return;
    const id = setInterval(() => setDrift((d) => d + 1), DRIFT_MS);
    return () => clearInterval(id);
  }, [frame]);

  const reducedMotion = usePrefersReducedMotion();
  const offset = frame === 'fullscreen' ? burnInOffset(drift) : { x: 0, y: 0 };
  const visible = pages[page] ?? [];

  const rootStyle = { ...markerVars(tone), fontSize: `${fontPx}px` } as CSSProperties;

  return (
    <div
      ref={rootRef}
      data-theme={tone === 'dark' ? 'night' : 'daylight'}
      data-wall-root=""
      role="region"
      aria-label={`${feed.branch.name} job board`}
      className={cx('relative flex flex-col overflow-hidden bg-bg font-sans leading-snug text-fg', frame === 'fullscreen' ? 'h-dvh w-full' : 'h-full w-full', className)}
      style={rootStyle}
    >
      <div className={cx('flex min-h-0 flex-1 flex-col', frame === 'fullscreen' && 'wall-drift')} style={offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}>
        {legend ? (
          <p className="flex flex-wrap items-center gap-x-[0.6em] bg-warning-soft px-[1.2em] py-[0.35em] text-[0.95em] font-semibold text-warning">
            <span className="rounded-[0.2em] border border-warning px-[0.4em] font-bold uppercase tracking-widest">Staff only</span>
            Client names are shown for staff. The lobby display never shows them.
          </p>
        ) : null}

        <WallHeader feed={feed} />

        <div className="flex min-h-0 flex-1 flex-col px-[1.2em] py-[0.9em]">
          <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden" data-wall-stage="">
            {orders.length === 0 ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <p className="font-display text-[2.6em] font-bold leading-tight">No open positions right now</p>
                  <p className="mt-[0.3em] text-[1.3em] text-muted">New jobs appear here as soon as they are posted.</p>
                </div>
              </div>
            ) : (
              <ul
                key={page}
                aria-label={pageCount > 1 ? `Jobs, page ${page + 1} of ${pageCount}` : 'Jobs'}
                className={cx('grid content-start', !reducedMotion && pageCount > 1 && 'wall-page-enter')}
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}
                data-wall-page={page}
              >
                {visible.map((i) => {
                  const o = orders[i]!;
                  return (
                    <li key={o.key} className="min-w-0">
                      <WallTile order={o} legendName={o.client ? legend?.get(o.client.code) : undefined} />
                    </li>
                  );
                })}
              </ul>
            )}
            {measurable ? (
              <div ref={measureRef} aria-hidden="true" inert className="pointer-events-none invisible absolute left-0 top-0" style={{ width: `${colWidth}px` }}>
                {orders.map((o) => (
                  <div key={o.key} data-wall-measure="">
                    <WallTile order={o} legendName={o.client ? legend?.get(o.client.code) : undefined} />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <WallFooter page={page} pageCount={pageCount} />
      </div>
    </div>
  );
}

function WallHeader({ feed }: { feed: WallFeed }) {
  const now = useNow();
  const clock = clockParts(now, feed.branch.timeZone);
  const { totals } = feed;
  const headline = feed.settings.headline.trim();
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-[1.6em] gap-y-[0.5em] border-b-[0.12em] border-line px-[1.2em] pb-[0.7em] pt-[0.8em]">
      <div className="min-w-0 flex-1 basis-[14em]">
        <h1 className="truncate font-display text-[2.3em] font-bold uppercase leading-none tracking-wide">{feed.branch.name}</h1>
        {headline ? <p className="mt-[0.3em] text-[1.35em] font-semibold leading-tight text-accent">{headline}</p> : null}
      </div>
      <p className="flex items-end gap-[1.4em] leading-none" data-wall-totals="">
        <span className="flex flex-col">
          <span className="font-display text-[2.8em] font-bold tabular-nums">{totals.toFill}</span>
          <span className="mt-[0.2em] text-[0.85em] font-semibold uppercase tracking-wider text-muted">{totals.toFill === 1 ? 'opening' : 'openings'}</span>
        </span>
        <span aria-hidden="true" className="pb-[0.9em] text-[1.6em] text-subtle">
          ·
        </span>
        <span className="flex flex-col">
          <span className="font-display text-[2.8em] font-bold tabular-nums">{totals.startingSoon}</span>
          <span className="mt-[0.2em] text-[0.85em] font-semibold uppercase tracking-wider text-muted">starting soon</span>
        </span>
      </p>
      <p className="text-right leading-none">
        <span className="font-display text-[3.4em] font-bold tabular-nums tracking-tight">{clock.time}</span>
        <span className="ml-[0.2em] font-display text-[1.4em] font-semibold text-muted">{clock.period}</span>
        <span className="mt-[0.3em] block text-[1.05em] font-medium text-muted">{clock.date}</span>
      </p>
    </header>
  );
}

function WallFooter({ page, pageCount }: { page: number; pageCount: number }) {
  return (
    <footer className="flex flex-wrap items-center gap-x-[1.4em] gap-y-[0.3em] border-t border-line bg-surface-2 px-[1.2em] py-[0.5em] text-[0.95em]">
      <ul aria-label="Symbol key" className="flex flex-wrap items-center gap-x-[1.3em] gap-y-[0.2em]">
        {OPENING_STATES.map((s) => (
          <li key={s} className="inline-flex items-center gap-[0.4em] font-semibold">
            <OpeningSymbol state={s} spoken={false} size="1.15em" />
            {OPENING_WORDS[s]}
          </li>
        ))}
        <li className="inline-flex items-center gap-[0.35em] font-semibold">
          <span aria-hidden="true" className="text-danger">
            ★
          </span>
          Hot job
        </li>
        <li className="inline-flex items-center gap-[0.4em] font-semibold">
          <span aria-hidden="true" className="size-[0.55em] rounded-full bg-warning" />
          Starts soon
        </li>
      </ul>
      {pageCount > 1 ? (
        <div className="ml-auto flex items-center gap-[0.6em]" data-wall-pager="">
          <span className="font-semibold tabular-nums">
            Page {page + 1} of {pageCount}
          </span>
          <span aria-hidden="true" className="flex items-center gap-[0.3em]">
            {Array.from({ length: pageCount }, (_, i) => (
              <span key={i} className={cx('size-[0.55em] rounded-full', i === page ? 'bg-fg' : 'border-[0.1em] border-line-strong')} />
            ))}
          </span>
        </div>
      ) : null}
    </footer>
  );
}
