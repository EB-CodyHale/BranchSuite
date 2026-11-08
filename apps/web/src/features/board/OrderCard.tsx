import {
  openingCounts,
  orderAgeDays,
  payText,
  scheduleText,
  shortDay,
  LIMITS,
  type AccountLite,
  type Order,
  type PersonLite,
} from '@branchsuite/shared';
import { CircleCheck, CirclePause, Clock, Mail, Star } from 'lucide-react';
import { memo, useId, useState } from 'react';
import { markerInkVar } from '../../app/theme.js';
import { Badge } from '../../ui/Badge.js';
import { cx } from '../../ui/cx.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { WallGlyph, wallCodeLabel } from '../../ui/WallGlyph.js';
import { unitText } from './boardModel.js';
import { OrderLine } from './OrderLine.js';
import { OrderMenu } from './OrderMenu.js';

const NOTE_PREVIEW = 110;

export interface OrderCardProps {
  order: Order;
  account: AccountLite | undefined;
  owner: PersonLite | null;
  today: string;
  timeZone: string;
  /** Branch name when several branches are in scope; null hides the chip. */
  branchName: string | null;
  canManage: boolean;
}

/** "Forklift operator · 2nd · M-F · 6a-2:30p · $19.50/hr" (empty parts omitted). */
export function subtitleOf(order: Order): string {
  return [order.role, order.shift, scheduleText(order), payText(order.payRate)].filter((s) => s.trim().length > 0).join(' · ');
}

export function ToFillTally({ toFill, covered, className }: { toFill: number; covered: boolean; className?: string }) {
  if (covered) {
    return (
      <span className={cx('inline-flex items-center gap-1 font-semibold text-success', className)}>
        <CircleCheck aria-hidden="true" className="size-4" />
        Covered
      </span>
    );
  }
  const hot = toFill >= 3;
  return (
    <span className={cx('inline-flex items-baseline gap-1 tabular-nums', hot ? 'rounded-sm bg-danger-soft px-1.5 text-danger' : 'text-fg', className)}>
      <span className={cx('font-display font-bold leading-none', hot ? 'text-xl' : 'text-lg')}>{toFill}</span>
      <span className="text-sm font-semibold">to fill</span>
    </span>
  );
}

function OrderCardImpl({ order, account, owner, today, timeZone, branchName, canManage }: OrderCardProps) {
  const headingId = useId();
  const [noteOpen, setNoteOpen] = useState(false);
  const counts = openingCounts(order);
  const age = orderAgeDays(order, timeZone);
  const aging = !counts.covered && age >= LIMITS.agingOrderDays;
  const unit = unitText(account, order.unitId);
  const where = [unit, order.site].filter(Boolean).join(' · ');
  const name = account?.name ?? 'Unknown account';
  const editable = order.status === 'active' || order.status === 'paused';
  const longNote = order.note.length > NOTE_PREVIEW;
  const paused = order.status === 'paused';

  return (
    <article
      aria-labelledby={headingId}
      data-order-id={order.id}
      className={cx(
        'relative flex min-w-0 flex-col rounded-md border border-rule bg-paper text-ink shadow-card',
        'border-l-[5px]',
        paused && 'border-dashed',
      )}
      style={{ borderLeftColor: owner ? `var(${markerInkVar(owner.marker)})` : 'var(--board-line)', borderLeftStyle: 'solid' }}
    >
      <header className="flex items-start gap-2 px-3 pt-2.5">
        {account ? (
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1" title={`Wall code ${account.wall.code}`}>
            <WallGlyph glyph={account.wall.glyph} color={account.wall.color} size={16} label={null} />
            <span className="font-display text-sm font-bold tracking-wider text-muted">
              <span className="sr-only">Wall code </span>
              {account.wall.code}
              <span className="sr-only"> ({wallCodeLabel(account.wall.glyph, account.wall.color)})</span>
            </span>
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="font-display text-lg font-bold leading-tight text-ink">
            {name}
            <span className="sr-only">, {order.role}{order.shift ? `, ${order.shift} shift` : ''}</span>
          </h3>
          {where ? <p className="truncate text-xs text-muted">{where}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {order.isPriority ? (
            <span className="inline-flex text-warning" title="Priority">
              <Star aria-hidden="true" className="size-4 fill-current" />
              <span className="sr-only">Priority</span>
            </span>
          ) : null}
          {owner ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold tracking-wide" title={`Owner: ${owner.name}`}>
              <MarkerDot marker={owner.marker} label={null} size="sm" />
              <span className="sr-only">Owner </span>
              <span style={{ color: `var(${markerInkVar(owner.marker)})` }}>{owner.initials}</span>
            </span>
          ) : null}
          <OrderMenu order={order} title={`${name} ${order.role}`} canManage={canManage} className="-mr-1.5 -mt-0.5" />
        </div>
      </header>

      {branchName || paused || order.source === 'email' ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-1.5">
          {branchName ? <Badge tone="neutral">{branchName}</Badge> : null}
          {paused ? (
            <Badge tone="warning" icon={<CirclePause />}>
              Paused{order.pause?.reason ? ` · ${order.pause.reason}` : ''}
              {order.pause?.resumeOn ? ` · until ${shortDay(order.pause.resumeOn)}` : ''}
            </Badge>
          ) : null}
          {order.source === 'email' ? (
            <Badge tone="neutral" icon={<Mail />}>
              From email
            </Badge>
          ) : null}
        </div>
      ) : null}

      <p className="px-3 pt-1 text-sm font-medium text-fg">{subtitleOf(order)}</p>

      {order.note ? (
        <div className="px-3 pt-1">
          <p className={cx('whitespace-pre-line text-sm italic text-muted', !noteOpen && 'line-clamp-2')}>{order.note}</p>
          {longNote ? (
            <button type="button" aria-expanded={noteOpen} onClick={() => setNoteOpen((v) => !v)} className="text-xs font-semibold text-accent hover:underline">
              {noteOpen ? 'Show less' : 'Show full note'}
            </button>
          ) : null}
        </div>
      ) : null}

      <ul aria-label={`Lines, ${counts.total} total`} className="grid grid-cols-[repeat(auto-fill,minmax(5.75rem,1fr))] gap-x-3 gap-y-1 px-3 pb-1 pt-2">
        {order.openings.map((line, i) => (
          <OrderLine key={line.id} order={order} line={line} index={i} today={today} editable={editable} />
        ))}
      </ul>

      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-rule/70 px-3 py-2 text-sm">
        <ToFillTally toFill={counts.toFill} covered={counts.covered} />
        <span className={cx('inline-flex items-center gap-1 tabular-nums', aging ? 'font-semibold text-warning' : 'text-muted')}>
          {aging ? <Clock aria-hidden="true" className="size-3.5" /> : null}
          open {age}d{aging ? <span className="sr-only"> (aging)</span> : null}
        </span>
      </footer>
    </article>
  );
}

/** Re-render only when this order (id + updatedAt) or its lookups change; a line write elsewhere skips it. */
export const OrderCard = memo(
  OrderCardImpl,
  (a, b) =>
    a.order.id === b.order.id &&
    a.order.updatedAt === b.order.updatedAt &&
    a.account === b.account &&
    a.owner === b.owner &&
    a.today === b.today &&
    a.timeZone === b.timeZone &&
    a.branchName === b.branchName &&
    a.canManage === b.canManage,
);
