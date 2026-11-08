import type { OpeningState, WallOpening } from '@branchsuite/shared';
import { cx } from '../../ui/cx.js';

/**
 * Public-friendly words for opening states. The wall never says "tentative" or "committed":
 * a walk-in reads Open / Pending / Filled / Started.
 */
export const OPENING_WORDS: Record<OpeningState, string> = {
  open: 'Open',
  tentative: 'Pending',
  committed: 'Filled',
  started: 'Started',
};

/** Ink per state; shape (ring, dashed ring, disc, disc + check) carries the meaning without color. */
const TONE: Record<OpeningState, string> = {
  open: 'text-fg',
  tentative: 'text-muted',
  committed: 'text-accent',
  started: 'text-success',
};

export function openingSpoken(opening: Pick<WallOpening, 'state' | 'mark' | 'startsSoon'>): string {
  let text = OPENING_WORDS[opening.state];
  if (opening.mark) text += ` (${opening.mark})`;
  if (opening.startsSoon) text += ', starts soon';
  return text;
}

export interface OpeningSymbolProps {
  state: OpeningState;
  /** Initials drawn inside the symbol when the branch shows initials. */
  mark?: string | null;
  startsSoon?: boolean;
  /** CSS length; the board passes em so symbols scale with the type. */
  size?: string;
  /** When false the symbol is decorative (the caller supplies the words). */
  spoken?: boolean;
  className?: string;
}

/**
 * One opening as a symbol: ○ open, ◌ pending (dashed), ● filled, ✓ started (check in a filled disc).
 * Each carries screen-reader text; with initials the letters sit inside the shape.
 */
export function OpeningSymbol({ state, mark = null, startsSoon = false, size = '1.5em', spoken = true, className }: OpeningSymbolProps) {
  const filled = state === 'committed' || state === 'started';
  const text = mark ? mark.slice(0, 3) : null;
  const fontSize = text && text.length > 2 ? 30 : 38;
  return (
    <span className={cx('relative inline-flex shrink-0', TONE[state], className)} data-state={state}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" focusable="false" className="block overflow-visible">
        {state === 'open' ? <circle cx={50} cy={50} r={42} fill="none" stroke="currentColor" strokeWidth={10} /> : null}
        {state === 'tentative' ? (
          <circle cx={50} cy={50} r={42} fill="none" stroke="currentColor" strokeWidth={9} strokeDasharray="15 11" strokeLinecap="round" />
        ) : null}
        {filled ? <circle cx={50} cy={50} r={47} fill="currentColor" /> : null}
        {state === 'started' && !text ? (
          <path d="M28 52 L44 67 L73 35" fill="none" className="stroke-surface" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
        {text ? (
          <text
            x={50}
            y={51}
            textAnchor="middle"
            dominantBaseline="central"
            className={filled ? 'fill-surface' : 'fill-current'}
            fontFamily="'Barlow Condensed', 'Barlow', sans-serif"
            fontWeight={700}
            fontSize={fontSize}
          >
            {text}
          </text>
        ) : null}
        {state === 'started' && text ? (
          // With initials inside, a check badge on the rim keeps "started" distinct from "filled".
          <g>
            <circle cx={84} cy={84} r={19} className="fill-surface" />
            <circle cx={84} cy={84} r={15} fill="currentColor" />
            <path d="M76 84 L82 90 L92 78" fill="none" className="stroke-surface" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : null}
      </svg>
      {startsSoon ? <span aria-hidden="true" className="absolute -right-[0.12em] -top-[0.12em] size-[0.42em] rounded-full border-[0.08em] border-surface bg-warning" /> : null}
      {spoken ? <span className="sr-only">{openingSpoken({ state, mark, startsSoon })}</span> : null}
    </span>
  );
}
