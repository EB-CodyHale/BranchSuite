import type { Task } from '@branchsuite/shared';
import { ChevronDown, CircleCheck, Reply, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { cx } from '../../ui/cx.js';
import { useInboxActions, useInboxEnv } from './InboxContext.js';
import { categoryLabel, formatTime } from './inboxModel.js';
import { PersonTag, PrivateBadge } from './TaskBits.js';

/** Tasks completed on the viewed date, collapsed by default. */
export function ClearedTray({ tasks, isToday }: { tasks: Task[]; isToday: boolean }) {
  const env = useInboxEnv();
  const actions = useInboxActions();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const count = tasks.length;

  return (
    <section aria-label="Cleared tasks" className="rounded-lg border border-line bg-surface">
      <h2>
        <button
          type="button"
          aria-expanded={open && count > 0}
          aria-controls={panelId}
          disabled={count === 0}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left disabled:cursor-default"
        >
          <ChevronDown aria-hidden="true" className={cx('size-4 text-muted transition-transform', !(open && count > 0) && '-rotate-90')} />
          <span className="font-display text-base font-bold uppercase tracking-wide text-fg">Cleared</span>
          <span className="font-display text-lg font-bold tabular-nums text-fg">{count}</span>
          <span className="truncate text-sm text-muted">{count === 0 ? (isToday ? 'Nothing completed yet today' : 'Nothing was completed this day') : isToday ? 'Completed today' : 'Completed this day'}</span>
        </button>
      </h2>
      {open && count > 0 ? (
        <ul id={panelId} className="divide-y divide-line border-t border-line">
          {tasks.map((t) => {
            const by = t.completedBy ? env.peopleById.get(t.completedBy) : undefined;
            const at = t.completedAt ?? t.closedByReply?.at ?? null;
            return (
              <li key={t.id} data-task-id={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => actions.open(t)} className="block max-w-full truncate text-left text-sm font-semibold text-muted line-through decoration-muted/60 underline-offset-2 hover:text-fg hover:no-underline">
                    {t.title}
                  </button>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>{categoryLabel(t.category)}</span>
                    {t.scope === 'personal' ? <PrivateBadge /> : null}
                    {t.status === 'reply_closed' ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-fg">
                        <Reply aria-hidden="true" className="size-3.5" />
                        Completed by reply
                        {t.closedByReply?.fromAddress ? <span className="font-normal text-muted">from {t.closedByReply.fromAddress}</span> : null}
                      </span>
                    ) : by ? (
                      <PersonTag person={by} prefix="Completed by" />
                    ) : null}
                    {at ? <span className="tabular-nums">{formatTime(at)}</span> : null}
                  </p>
                </div>
                {!env.readOnly ? (
                  <button
                    type="button"
                    onClick={() => actions.reopen(t)}
                    disabled={actions.busyIds.has(t.id)}
                    aria-label={`Reopen ${t.title}`}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-55"
                  >
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                    Reopen
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
