import type { BoardMetrics } from '@branchsuite/shared';
import { Archive, Clock, MonitorPlay, Pencil, Plus, Timer, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatCount } from '../../lib/format.js';
import { Button, buttonClasses } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import type { QuickFilter } from './boardModel.js';

const METRICS: ReadonlyArray<{ id: QuickFilter; label: string; hint: string; icon: ReactNode; tone: string; value: (m: BoardMetrics) => number }> = [
  { id: 'toFill', label: 'To fill', hint: 'Open and penciled lines', icon: <Users />, tone: 'text-accent', value: (m) => m.toFill },
  { id: 'pencils', label: 'Pencils', hint: 'Tentative: penciled in, not confirmed', icon: <Pencil />, tone: 'text-subtle', value: (m) => m.tentative },
  { id: 'startingSoon', label: 'Starting ≤48h', hint: 'Committed lines starting within two days', icon: <Timer />, tone: 'text-warning', value: (m) => m.startingSoon },
  { id: 'aging', label: 'Open 7+ days', hint: 'Orders not covered after a week', icon: <Clock />, tone: 'text-danger', value: (m) => m.aging },
];

export interface HeaderRailProps {
  scopeName: string;
  metrics: BoardMetrics | null;
  quick: QuickFilter | null;
  onQuick: (q: QuickFilter | null) => void;
  canCreate: boolean;
  onCreate: () => void;
  onShowClosed: () => void;
}

export function HeaderRail({ scopeName, metrics, quick, onQuick, canCreate, onCreate, onShowClosed }: HeaderRailProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[1.75rem] font-bold leading-none tracking-tight sm:text-3xl">Job order board</h1>
          <p className="mt-1 truncate text-sm font-semibold text-muted tabular-nums" aria-live="polite">
            {scopeName}
            {metrics ? (
              <>
                {' · '}
                <span className="text-fg">{formatCount(metrics.toFill)} to fill</span> of {formatCount(metrics.openings)}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" icon={<Archive aria-hidden="true" className="size-4" />} onClick={onShowClosed}>
            Recently closed
          </Button>
          <Link to="/board/wall-preview" className={buttonClasses('secondary', 'sm')}>
            <MonitorPlay aria-hidden="true" className="size-4" />
            Wall preview
          </Link>
          {canCreate ? (
            <Button size="sm" variant="primary" icon={<Plus aria-hidden="true" className="size-4" />} onClick={onCreate}>
              New order
            </Button>
          ) : null}
        </div>
      </div>

      <div role="group" aria-label="Board totals (select one to filter)" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {METRICS.map((m) => {
          const pressed = quick === m.id;
          const value = metrics ? m.value(metrics) : null;
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={pressed}
              title={m.hint}
              onClick={() => onQuick(pressed ? null : m.id)}
              className={cx(
                'group flex min-w-0 items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors',
                pressed ? 'border-accent bg-accent-soft shadow-card' : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <span aria-hidden="true" className={cx('inline-flex [&>svg]:size-[1.1rem]', m.tone)}>
                {m.icon}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-display text-2xl font-bold leading-none tabular-nums text-fg">{value === null ? '–' : formatCount(value)}</span>
                <span className={cx('truncate text-xs font-semibold', pressed ? 'text-accent' : 'text-muted')}>{m.label}</span>
              </span>
              {pressed ? <span aria-hidden="true" className="ml-auto hidden text-[0.6875rem] font-bold uppercase tracking-wider text-accent lg:inline">Filter on</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
