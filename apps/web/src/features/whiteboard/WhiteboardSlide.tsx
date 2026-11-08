/**
 * The huddle slide: a WhiteboardView in large-format type for a TV, the in-app presenter and the
 * staff wall preview. Pure presentation; it shows exactly what the view holds.
 *
 * Layout reuses the wall's approach (features/wall/layout.ts): type scales with the frame, blocks are
 * measured at column width in a hidden layer and packed into pages that rotate every `pageSeconds`.
 *
 * Must not import the staff query layer: the lobby display chunk renders this component.
 */
import type { WhiteboardView, WhiteboardViewBlock } from '@branchsuite/shared';
import { Check, HardHat, PartyPopper, StickyNote, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { markerVars } from '../../app/theme.js';
import { cx } from '../../ui/cx.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { WallGlyph, wallCodeLabel } from '../../ui/WallGlyph.js';
import { clockParts, useNow } from '../wall/clock.js';
import { useElementSize, useFontsReady, usePrefersReducedMotion } from '../wall/hooks.js';
import { burnInOffset, clampPage, columnsFor, columnWidth, gapPx, paginate, wallFontPx } from '../wall/layout.js';
import { shiftText } from '../wall/WallTile.js';
import { MediaImage } from './media.js';
import { longDate, noteSegments, windowLabel } from './model.js';
import '../wall/wall.css';
import './whiteboard.css';

export const WHITEBOARD_PAGE_SECONDS = 15;
const DRIFT_MS = 3 * 60_000;

type NoteTone = Extract<WhiteboardViewBlock, { kind: 'note' }>['tone'];

export const NOTE_TONES: Record<NoteTone, { label: string; Icon: LucideIcon; card: string; icon: string }> = {
  neutral: { label: 'Note', Icon: StickyNote, card: 'border-l-accent', icon: 'text-accent' },
  celebrate: { label: 'Shout-out', Icon: PartyPopper, card: 'border-l-success bg-success-soft', icon: 'text-success' },
  safety: { label: 'Safety', Icon: HardHat, card: 'border-l-warning bg-warning-soft', icon: 'text-warning' },
  alert: { label: 'Heads up', Icon: TriangleAlert, card: 'border-l-danger bg-danger-soft', icon: 'text-danger' },
};

export interface WhiteboardSlideProps {
  view: WhiteboardView;
  branchName: string;
  timeZone: string;
  theme?: 'dark' | 'light';
  /** 'fullscreen' fills the viewport (TV, presenter); 'embedded' fills its parent (scaled preview). */
  frame?: 'fullscreen' | 'embedded';
  /** Controlled page index (presenter). Omit to let the slide page itself. */
  page?: number;
  onPageCountChange?: (count: number) => void;
  /** Rotate pages on a timer (default true when uncontrolled). */
  autoPage?: boolean;
  pageSeconds?: number;
  className?: string;
}

function sameNumbers(a: readonly number[] | null, b: readonly number[]): boolean {
  return a !== null && a.length === b.length && a.every((v, i) => v === b[i]);
}

export function WhiteboardSlide({
  view,
  branchName,
  timeZone,
  theme = 'dark',
  frame = 'fullscreen',
  page: controlledPage,
  onPageCountChange,
  autoPage,
  pageSeconds = WHITEBOARD_PAGE_SECONDS,
  className,
}: WhiteboardSlideProps) {
  const blocks = view.blocks;
  const [rootRef, root] = useElementSize<HTMLDivElement>();
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const fontPx = wallFontPx(root.width, root.height);
  const gap = Math.round(gapPx(fontPx) * 1.2);
  const minCol = Math.min(Math.max(380, 0.28 * root.width), Math.max(640, 30 * fontPx));
  const columns = Math.min(Math.max(1, blocks.length), columnsFor(stage.width, minCol, gap));
  const colWidth = columnWidth(stage.width, columns, gap);
  const measurable = stage.width > 0 && stage.height > 0 && blocks.length > 0;
  const imageMax = stage.height > 0 ? Math.round(stage.height * 0.72) : undefined;

  const measureRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<number[] | null>(null);
  const fontsTick = useFontsReady();
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!measurable || !el) {
      setHeights(null);
      return;
    }
    const next = Array.from(el.children, (c) => Math.ceil((c as HTMLElement).offsetHeight));
    setHeights((prev) => (sameNumbers(prev, next) ? prev : next));
  }, [measurable, blocks, colWidth, fontPx, fontsTick, imageMax]);

  const pages = useMemo(() => {
    if (!heights || heights.length !== blocks.length) return [blocks.map((_, i) => i)];
    return paginate(heights, columns, stage.height, gap);
  }, [heights, blocks, columns, stage.height, gap]);
  const pageCount = pages.length;

  const onCountRef = useRef(onPageCountChange);
  onCountRef.current = onPageCountChange;
  useEffect(() => onCountRef.current?.(pageCount), [pageCount]);

  const [ownPage, setOwnPage] = useState(0);
  const [drift, setDrift] = useState(0);
  const controlled = controlledPage !== undefined;
  const page = clampPage(controlled ? controlledPage : ownPage, pageCount);
  const rotating = (autoPage ?? !controlled) && !controlled && pageCount > 1;
  const pageMs = Math.max(5, pageSeconds) * 1000;
  useEffect(() => {
    if (!rotating) return;
    const id = setInterval(() => {
      setOwnPage((i) => {
        const next = (clampPage(i, pageCount) + 1) % pageCount;
        if (next === 0) setDrift((d) => d + 1);
        return next;
      });
    }, pageMs);
    return () => clearInterval(id);
  }, [rotating, pageCount, pageMs]);

  useEffect(() => {
    if (frame !== 'fullscreen') return;
    const id = setInterval(() => setDrift((d) => d + 1), DRIFT_MS);
    return () => clearInterval(id);
  }, [frame]);

  const reducedMotion = usePrefersReducedMotion();
  const offset = frame === 'fullscreen' ? burnInOffset(drift) : { x: 0, y: 0 };
  const visible = pages[page] ?? [];
  const tone = theme === 'light' ? 'light' : 'dark';
  const rootStyle = { ...markerVars(tone), fontSize: `${fontPx}px` } as CSSProperties;

  return (
    <div
      ref={rootRef}
      data-theme={tone === 'dark' ? 'night' : 'daylight'}
      data-whiteboard-root=""
      role="region"
      aria-label={`${branchName} morning whiteboard`}
      className={cx('relative flex flex-col overflow-hidden bg-bg font-sans leading-snug text-fg', frame === 'fullscreen' ? 'h-dvh w-full' : 'h-full w-full', className)}
      style={rootStyle}
    >
      <div className={cx('flex min-h-0 flex-1 flex-col', frame === 'fullscreen' && 'wall-drift')} style={offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}>
        <SlideHeader view={view} branchName={branchName} timeZone={timeZone} />
        <div className="flex min-h-0 flex-1 flex-col px-[1.2em] py-[0.9em]">
          <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden" data-whiteboard-stage="">
            {blocks.length === 0 ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <p className="font-display text-[2.6em] font-bold leading-tight">Good morning, team</p>
                  <p className="mt-[0.3em] text-[1.3em] text-muted">Nothing on the whiteboard yet.</p>
                </div>
              </div>
            ) : (
              <ul
                key={page}
                aria-label={pageCount > 1 ? `Whiteboard, page ${page + 1} of ${pageCount}` : 'Whiteboard'}
                className={cx('grid content-start', !reducedMotion && pageCount > 1 && 'wall-page-enter')}
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap}px` }}
                data-whiteboard-page={page}
              >
                {visible.map((i) => {
                  const b = blocks[i]!;
                  return (
                    <li key={b.id} className="min-w-0">
                      <WhiteboardBlockCard block={b} imageMaxHeight={imageMax} />
                    </li>
                  );
                })}
              </ul>
            )}
            {measurable ? (
              <div ref={measureRef} aria-hidden="true" inert className="pointer-events-none invisible absolute left-0 top-0" style={{ width: `${colWidth}px` }}>
                {blocks.map((b) => (
                  <div key={b.id}>
                    <WhiteboardBlockCard block={b} imageMaxHeight={imageMax} measuring />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {pageCount > 1 ? (
          <footer className="flex items-center justify-end gap-[0.6em] border-t border-line bg-surface-2 px-[1.2em] py-[0.45em] text-[0.95em]" data-whiteboard-pager="">
            <span className="font-semibold tabular-nums">
              Page {page + 1} of {pageCount}
            </span>
            <span aria-hidden="true" className="flex items-center gap-[0.3em]">
              {Array.from({ length: pageCount }, (_, i) => (
                <span key={i} className={cx('size-[0.55em] rounded-full', i === page ? 'bg-fg' : 'border-[0.1em] border-line-strong')} />
              ))}
            </span>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function SlideHeader({ view, branchName, timeZone }: { view: WhiteboardView; branchName: string; timeZone: string }) {
  const now = useNow();
  const clock = clockParts(now, timeZone);
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-[1.6em] gap-y-[0.5em] border-b-[0.12em] border-line px-[1.2em] pb-[0.7em] pt-[0.8em]">
      <div className="min-w-0 flex-1 basis-[16em]">
        <p className="text-[1em] font-semibold uppercase tracking-widest text-muted">{branchName}</p>
        <h1 className="mt-[0.15em] truncate font-display text-[2.4em] font-bold leading-none tracking-wide">{view.title || 'Morning huddle'}</h1>
        <p className="mt-[0.35em] flex flex-wrap items-center gap-x-[0.8em] gap-y-[0.2em] text-[1.2em] font-semibold text-muted">
          <span>{longDate(view.date)}</span>
          <span aria-hidden="true">·</span>
          <span>Huddle {windowLabel(view.window)}</span>
          {view.isLive ? (
            <span className="inline-flex items-center gap-[0.35em] rounded-full bg-success-soft px-[0.6em] py-[0.05em] text-[0.85em] font-bold uppercase tracking-wider text-success">
              <span aria-hidden="true" className="size-[0.5em] rounded-full bg-success" />
              Live
            </span>
          ) : null}
        </p>
      </div>
      <p className="text-right leading-none">
        <span className="font-display text-[3.2em] font-bold tabular-nums tracking-tight">{clock.time}</span>
        <span className="ml-[0.2em] font-display text-[1.4em] font-semibold text-muted">{clock.period}</span>
      </p>
    </header>
  );
}

// =====================================================================================
// blocks
// =====================================================================================

type AssignmentItem = Extract<WhiteboardViewBlock, { kind: 'assignments' }>['items'][number];

export interface WhiteboardBlockCardProps {
  block: WhiteboardViewBlock;
  /** Max image height in px (slide stage); images otherwise follow their aspect ratio. */
  imageMaxHeight?: number;
  /** Hidden measuring copy: do not fetch images. */
  measuring?: boolean;
  /** Member view: emphasise the caller's own assignment items. */
  isOwnItem?: (itemId: string) => boolean;
  /** Member view: a control (done checkbox) rendered in place of the static tick. */
  renderAssignmentControl?: (item: AssignmentItem) => ReactNode;
  className?: string;
}

function defaultTitle(block: WhiteboardViewBlock): string {
  if (block.title) return block.title;
  switch (block.kind) {
    case 'talking_points':
      return 'Talking points';
    case 'assignments':
      return 'Assignments';
    case 'priority_orders':
      return 'Priority orders';
    case 'image':
      return 'Graph';
    case 'note':
      return NOTE_TONES[block.tone].label;
    case 'metrics':
      return "Today's numbers";
  }
}

/** One block as a card. Sizes are in em so the parent's font size sets the scale (TV vs page). */
export function WhiteboardBlockCard({ block, imageMaxHeight, measuring, isOwnItem, renderAssignmentControl, className }: WhiteboardBlockCardProps) {
  const title = defaultTitle(block);
  const tone = block.kind === 'note' ? NOTE_TONES[block.tone] : null;
  return (
    <section
      aria-label={title}
      data-block-kind={block.kind}
      className={cx(
        'flex h-full flex-col gap-[0.55em] overflow-hidden rounded-[0.6em] border border-line bg-surface px-[0.95em] pb-[0.85em] pt-[0.75em] shadow-card',
        tone && cx('border-l-[0.35em]', tone.card),
        className,
      )}
    >
      <h2 className="flex items-center gap-[0.4em] font-display text-[1.55em] font-bold leading-tight tracking-wide">
        {tone ? <tone.Icon aria-hidden="true" className={cx('size-[1em] shrink-0', tone.icon)} /> : null}
        {tone && block.title ? <span className="sr-only">{tone.label}: </span> : null}
        <span className="min-w-0">{title}</span>
      </h2>
      <BlockBody block={block} imageMaxHeight={imageMaxHeight} measuring={measuring} isOwnItem={isOwnItem} renderAssignmentControl={renderAssignmentControl} />
    </section>
  );
}

function BlockBody({ block, imageMaxHeight, measuring, isOwnItem, renderAssignmentControl }: WhiteboardBlockCardProps) {
  switch (block.kind) {
    case 'talking_points':
      return (
        <ol className="flex flex-col gap-[0.45em] text-[1.25em]">
          {block.items.map((item, i) => (
            <li key={item.id} className="flex gap-[0.55em]">
              <span aria-hidden="true" className="mt-[0.05em] grid size-[1.45em] shrink-0 place-items-center rounded-full bg-accent-soft font-display text-[0.85em] font-bold tabular-nums text-accent">
                {i + 1}
              </span>
              <span className="min-w-0 whitespace-pre-line break-words">{item.text}</span>
            </li>
          ))}
        </ol>
      );
    case 'assignments':
      return (
        <ul className="flex flex-col gap-[0.5em] text-[1.2em]">
          {block.items.map((item) => {
            const own = isOwnItem?.(item.id) ?? false;
            return (
              <li key={item.id} data-own={own ? '' : undefined} className={cx('flex items-start gap-[0.6em] rounded-[0.35em]', own && '-mx-[0.35em] bg-accent-soft px-[0.35em] py-[0.2em] ring-1 ring-accent')}>
                {item.person ? (
                  <span className="relative mt-[0.05em] grid size-[1.9em] shrink-0 place-items-center rounded-full border-[0.12em] border-line-strong bg-surface-2 font-display text-[0.8em] font-bold" aria-hidden="true">
                    {item.person.initials}
                    <MarkerDot marker={item.person.marker} label={null} size="sm" className="absolute -bottom-[0.1em] -right-[0.1em] size-[0.75em]" />
                  </span>
                ) : (
                  <span aria-hidden="true" className="mt-[0.05em] grid size-[1.55em] shrink-0 place-items-center rounded-full border-[0.12em] border-dashed border-line-strong text-[0.8em] font-bold text-muted">
                    All
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-tight">
                    {item.person ? item.person.name : 'Team'}
                    {own ? <span className="ml-[0.4em] rounded-[0.25em] bg-accent px-[0.35em] text-[0.7em] font-bold uppercase tracking-wider text-accent-fg">You</span> : null}
                  </span>
                  <span className={cx('block break-words text-[0.92em]', item.done ? 'text-muted line-through' : 'text-fg')}>{item.text}</span>
                </span>
                {renderAssignmentControl ? (
                  renderAssignmentControl(item)
                ) : item.done ? (
                  <span className="inline-flex shrink-0 items-center gap-[0.25em] rounded-full bg-success-soft px-[0.5em] py-[0.1em] text-[0.8em] font-bold text-success">
                    <Check aria-hidden="true" className="size-[1em]" />
                    Done
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      );
    case 'priority_orders':
      return (
        <ul className="flex flex-col gap-[0.5em]">
          {block.items.map((item, i) => (
            <li key={`${item.label}-${i}`} className="flex items-start gap-[0.6em] rounded-[0.45em] border border-line bg-surface-2 px-[0.6em] py-[0.45em]">
              <WallGlyph glyph={item.client.glyph} color={item.client.color} code={item.client.code} size="2.3em" label={wallCodeLabel(item.client.glyph, item.client.color, item.client.code)} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[1.35em] font-bold leading-tight">{item.label}</p>
                <p className="text-[1.05em] font-semibold leading-tight text-muted">{[item.role, shiftText(item.shift)].filter(Boolean).join(' · ')}</p>
                {item.note ? <p className="mt-[0.15em] break-words text-[1em] leading-snug">{item.note}</p> : null}
              </div>
              <p className="shrink-0 text-right leading-none">
                <span className="block font-display text-[2em] font-bold tabular-nums">{item.toFill}</span>
                <span className="block text-[0.8em] font-semibold uppercase tracking-wider text-muted">to fill</span>
                {item.startingSoon > 0 ? (
                  <span className="mt-[0.3em] inline-flex items-center gap-[0.3em] text-[0.85em] font-semibold text-warning">
                    <span aria-hidden="true" className="size-[0.5em] rounded-full bg-warning" />
                    {item.startingSoon} starting soon
                  </span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      );
    case 'image': {
      const ratio = block.width && block.height ? `${block.width} / ${block.height}` : '16 / 9';
      const alt = block.caption || block.title || 'Whiteboard image';
      return (
        <figure className="m-0 flex flex-col gap-[0.4em]">
          <div className="w-full overflow-hidden rounded-[0.35em]" style={{ aspectRatio: ratio, maxHeight: imageMaxHeight ? `${imageMaxHeight}px` : undefined }}>
            <MediaImage url={block.mediaUrl} alt={alt} placeholderOnly={measuring} />
          </div>
          {block.caption ? <figcaption className="text-[1.1em] text-muted">{block.caption}</figcaption> : null}
        </figure>
      );
    }
    case 'note':
      return <NoteText text={block.text} />;
    case 'metrics': {
      const m = block.metrics;
      const cells: Array<{ label: string; value: number; tone?: string }> = [
        { label: 'To fill', value: m.toFill },
        { label: 'Open orders', value: m.orders },
        { label: 'Pending', value: m.tentative },
        { label: 'Starting soon', value: m.startingSoon, tone: 'text-warning' },
        { label: 'Aging orders', value: m.aging, tone: m.aging > 0 ? 'text-danger' : undefined },
      ];
      return (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(5.5em,1fr))] gap-[0.6em]">
          {cells.map((c) => (
            <div key={c.label} className="flex flex-col-reverse rounded-[0.45em] bg-surface-2 px-[0.6em] py-[0.5em]">
              <dt className="text-[0.85em] font-semibold uppercase tracking-wider text-muted">{c.label}</dt>
              <dd className={cx('font-display text-[2.6em] font-bold leading-none tabular-nums', c.tone)}>{c.value}</dd>
            </div>
          ))}
        </dl>
      );
    }
  }
}

export function NoteText({ text, className }: { text: string; className?: string }) {
  const segments = noteSegments(text);
  return (
    <div className={cx('flex flex-col gap-[0.45em] text-[1.25em]', className)}>
      {segments.map((s, i) =>
        s.kind === 'para' ? (
          s.text ? (
            <p key={i} className="whitespace-pre-line break-words">
              {s.text}
            </p>
          ) : null
        ) : (
          <ul key={i} className="flex list-disc flex-col gap-[0.25em] pl-[1.2em]">
            {s.items.map((item, j) => (
              <li key={j} className="break-words">
                {item}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
