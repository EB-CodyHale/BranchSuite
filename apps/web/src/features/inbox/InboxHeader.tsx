import { isDayKey } from '@branchsuite/shared';
import { CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Flame, Inbox, UserRoundX } from 'lucide-react';
import type { ReactNode } from 'react';
import { dayLabel, formatCount, stepDay } from '../../lib/format.js';
import { Button } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import { IconButton } from '../../ui/IconButton.js';
import { Segmented } from '../../ui/Segmented.js';
import type { InboxCounts, InboxView } from './inboxModel.js';

const VIEW_OPTIONS: ReadonlyArray<{ value: InboxView; label: string }> = [
  { value: 'branch', label: 'Branch' },
  { value: 'personal', label: 'Personal' },
  { value: 'combined', label: 'Combined' },
];

export interface InboxHeaderProps {
  scopeName: string;
  view: InboxView;
  onView: (v: InboxView) => void;
  showViews: boolean;
  /** The viewed day and today's day key. */
  date: string;
  today: string;
  onDate: (date: string | null) => void;
  counts: InboxCounts | null;
}

function Metric({ label, value, icon, tone }: { label: string; value: number | null; icon: ReactNode; tone: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2">
      <span aria-hidden="true" className={cx('inline-flex [&>svg]:size-[1.1rem]', tone)}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-display text-2xl font-bold leading-none tabular-nums text-fg">{value === null ? '–' : formatCount(value)}</span>
        <span className="truncate text-xs font-semibold text-muted">{label}</span>
      </span>
    </div>
  );
}

export function InboxHeader({ scopeName, view, onView, showViews, date, today, onDate, counts }: InboxHeaderProps) {
  const isToday = date === today;
  const label = dayLabel(date, today) || date;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="font-display text-[1.75rem] font-bold leading-none tracking-tight sm:text-3xl">Inbox</h1>
          <p className="mt-1 truncate text-sm font-semibold text-muted">{view === 'personal' ? 'Personal · only you' : scopeName}</p>
        </div>
        {showViews ? <Segmented label="Inbox view" options={VIEW_OPTIONS} value={view} onChange={onView} /> : null}
        <div role="group" aria-label="Board date" className="flex flex-wrap items-center gap-1.5">
          <IconButton label="Previous day" variant="secondary" size="sm" onClick={() => onDate(stepDay(date, -1))}>
            <ChevronLeft />
          </IconButton>
          <label className="relative inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface pl-2 pr-1 text-sm font-semibold">
            <CalendarDays aria-hidden="true" className="size-4 text-muted" />
            <span className="sr-only">Pick a date</span>
            <span aria-hidden="true" className="min-w-[4.5rem] tabular-nums">{label}</span>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => {
                const v = e.target.value;
                if (!isDayKey(v)) return;
                onDate(v >= today ? null : v);
              }}
              className="w-[1.75rem] cursor-pointer bg-transparent text-transparent [color-scheme:light_dark] focus-visible:outline-2 focus-visible:outline-focus"
            />
          </label>
          <IconButton label="Next day" variant="secondary" size="sm" disabled={isToday} onClick={() => onDate(stepDay(date, 1) >= today ? null : stepDay(date, 1))}>
            <ChevronRight />
          </IconButton>
          {!isToday ? (
            <Button size="sm" variant="primary" onClick={() => onDate(null)}>
              Return to today
            </Button>
          ) : null}
        </div>
      </div>

      <div role="group" aria-label={isToday ? 'Today’s totals' : `Totals for ${label}`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Open" value={counts?.open ?? null} icon={<Inbox />} tone="text-accent" />
        <Metric label="Hot" value={counts?.hot ?? null} icon={<Flame />} tone="text-danger" />
        <Metric label="Unassigned" value={counts?.unassigned ?? null} icon={<UserRoundX />} tone="text-warning" />
        <Metric label={isToday ? 'Cleared today' : 'Cleared'} value={counts?.cleared ?? null} icon={<CircleCheck />} tone="text-success" />
      </div>
    </div>
  );
}
