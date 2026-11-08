import { OPENING_STATES, type OpeningState, type WallOrder } from '@branchsuite/shared';
import { cx } from '../../ui/cx.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { WallGlyph, wallCodeLabel } from '../../ui/WallGlyph.js';
import { MAX_SYMBOLS } from './layout.js';
import { OPENING_WORDS, OpeningSymbol } from './OpeningSymbol.js';

/** "2nd shift"; text that already names a shift ("Night shift") is kept as is. */
export function shiftText(shift: string): string {
  const s = shift.trim();
  if (!s) return '';
  return /shift/i.test(s) ? s : `${s} shift`;
}

/** "5 openings: 2 open, 1 pending, 2 filled" for screen readers. */
export function openingsSummary(order: Pick<WallOrder, 'openings'>): string {
  const counts = new Map<OpeningState, number>();
  for (const o of order.openings) counts.set(o.state, (counts.get(o.state) ?? 0) + 1);
  const total = order.openings.length;
  const parts = OPENING_STATES.filter((s) => counts.get(s)).map((s) => `${counts.get(s)} ${OPENING_WORDS[s].toLowerCase()}`);
  return `${total} ${total === 1 ? 'opening' : 'openings'}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

export interface WallTileProps {
  order: WallOrder;
  /** Account name for the staff legend overlay; undefined on the public display. */
  legendName?: string;
  className?: string;
}

/** One order on the wall. Pure presentation of server-coded data: it shows exactly what the feed holds. */
export function WallTile({ order, legendName, className }: WallTileProps) {
  const shown = order.openings.length > MAX_SYMBOLS ? order.openings.slice(0, MAX_SYMBOLS - 1) : order.openings;
  const hidden = order.openings.length - shown.length;
  const startsSoon = order.openings.some((o) => o.startsSoon);
  const details = [shiftText(order.shift), order.schedule].filter(Boolean).join(' · ');
  const extras = [order.pay, order.location].filter((v): v is string => Boolean(v));

  return (
    <article
      className={cx(
        'relative flex h-full flex-col gap-[0.5em] overflow-hidden rounded-[0.6em] border border-line bg-surface px-[0.85em] pb-[0.75em] pt-[0.8em] shadow-card',
        order.isPriority && 'border-t-[0.28em] border-t-danger pt-[0.6em]',
        className,
      )}
      data-key={order.key}
    >
      <div className={cx('flex flex-col gap-[0.5em]', order.paused && 'opacity-60')}>
        <header className="flex items-start gap-[0.6em]">
          {order.client ? (
            <WallGlyph glyph={order.client.glyph} color={order.client.color} size="2.7em" label={wallCodeLabel(order.client.glyph, order.client.color)} />
          ) : null}
          <div className="min-w-0 flex-1">
            {order.clientName ? (
              <p className="truncate font-display text-[1.7em] font-bold leading-none tracking-tight">{order.clientName}</p>
            ) : order.client ? (
              <p className="font-display text-[2.2em] font-bold leading-none tracking-wide tabular-nums">
                <span className="sr-only">Client code </span>
                {order.client.code}
              </p>
            ) : null}
            {legendName ? (
              <p className="mt-[0.2em] inline-flex max-w-full items-center gap-[0.3em] rounded-[0.25em] border border-dashed border-warning bg-warning-soft px-[0.35em] py-[0.05em] text-[0.85em] font-semibold text-warning">
                <span className="shrink-0 text-[0.75em] font-bold uppercase tracking-wider">Staff</span>
                <span className="truncate">{legendName}</span>
              </p>
            ) : null}
            <p className={cx('font-semibold leading-tight', order.client || order.clientName ? 'mt-[0.2em] text-[1.3em]' : 'text-[1.55em]')}>{order.role}</p>
          </div>
          <p className="shrink-0 text-right leading-none">
            <span className="block font-display text-[2.4em] font-bold tabular-nums">{order.toFill}</span>
            <span className="mt-[0.15em] block text-[0.75em] font-semibold uppercase tracking-wider text-muted">to fill</span>
          </p>
        </header>

        {details ? <p className="text-[1.05em] font-medium leading-snug text-muted">{details}</p> : null}
        {extras.length ? (
          <p className="flex flex-wrap gap-x-[0.8em] gap-y-[0.1em] text-[1.05em] font-semibold leading-snug">
            {order.pay ? (
              <span className="tabular-nums">
                <span className="sr-only">Pay </span>
                {order.pay}
              </span>
            ) : null}
            {order.location ? <span className="text-muted">{order.location}</span> : null}
          </p>
        ) : null}

        {order.openings.length ? (
          <div>
            <p className="sr-only">{openingsSummary(order)}</p>
            <ul className="flex flex-wrap items-center gap-[0.32em]" aria-label="Openings">
              {shown.map((o, i) => (
                <li key={i} className="inline-flex">
                  <OpeningSymbol state={o.state} mark={o.mark} startsSoon={o.startsSoon} size={o.mark ? '1.9em' : '1.55em'} />
                </li>
              ))}
              {hidden > 0 ? <li className="font-display text-[1.15em] font-bold tabular-nums text-muted">+{hidden} more</li> : null}
            </ul>
          </div>
        ) : null}
      </div>

      <footer className="mt-auto flex flex-wrap items-center gap-[0.4em] pt-[0.1em]">
        {order.isPriority ? (
          <span className="inline-flex items-center gap-[0.25em] rounded-[0.25em] bg-danger-soft px-[0.45em] py-[0.15em] text-[0.95em] font-bold uppercase tracking-wide text-danger">
            <span aria-hidden="true">★</span>Hot
          </span>
        ) : null}
        {startsSoon ? (
          <span className="inline-flex items-center gap-[0.3em] rounded-[0.25em] bg-warning-soft px-[0.45em] py-[0.15em] text-[0.9em] font-semibold text-warning">
            <span aria-hidden="true" className="size-[0.5em] rounded-full bg-warning" />
            Starts soon
          </span>
        ) : null}
        {order.paused ? (
          <span className="inline-flex items-center gap-[0.3em] rounded-[0.25em] border border-line-strong px-[0.45em] py-[0.1em] text-[0.9em] font-bold uppercase tracking-wide text-fg">
            <span aria-hidden="true">❙❙</span>Paused
          </span>
        ) : null}
        {order.owner ? (
          <span className="ml-auto inline-flex items-center gap-[0.35em] text-[0.95em] font-semibold text-muted">
            <MarkerDot marker={order.owner.marker} className="size-[0.9em]!" label={order.owner.initials ? null : undefined} />
            {order.owner.initials ? (
              <span>
                <span className="sr-only">Recruiter </span>
                {order.owner.initials}
              </span>
            ) : null}
          </span>
        ) : null}
      </footer>
    </article>
  );
}
