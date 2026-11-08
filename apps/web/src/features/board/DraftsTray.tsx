import { accountLabel, scheduleText, type Order } from '@branchsuite/shared';
import { Inbox, PencilLine, Send, XCircle } from 'lucide-react';
import { useId } from 'react';
import { relativeAge } from '../../lib/format.js';
import { Button } from '../../ui/Button.js';
import { useBoardActions, useBoardEnv } from './BoardContext.js';

export interface DraftsTrayProps {
  drafts: readonly Order[];
  publishingId: string | null;
}

/** Manager-only strip of draft orders (usually created from email) waiting for review. */
export function DraftsTray({ drafts, publishingId }: DraftsTrayProps) {
  const { accountsById, branchesById, multiBranch } = useBoardEnv();
  const actions = useBoardActions();
  const headingId = useId();
  if (drafts.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-warning/40 bg-warning-soft/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Inbox aria-hidden="true" className="size-4 text-warning" />
        <h2 id={headingId} className="font-display text-lg font-bold leading-none">
          Needs review
        </h2>
        <span className="rounded-sm bg-warning px-1.5 text-xs font-bold tabular-nums text-surface">{drafts.length}</span>
        <p className="text-sm text-muted max-sm:sr-only">Draft orders stay off the board and the wall until you publish them.</p>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {drafts.map((d) => {
          const account = accountsById.get(d.accountId);
          const title = account ? accountLabel(account, d.unitId) : 'Unknown account';
          const details = [d.shift, scheduleText(d)].filter(Boolean).join(' · ');
          return (
            <li key={d.id} className="flex w-[17rem] shrink-0 flex-col gap-1 rounded-md border border-rule bg-paper p-2.5 text-ink shadow-card">
              <p className="truncate font-display text-base font-bold leading-tight" title={title}>
                {title}
              </p>
              <p className="truncate text-sm">
                {d.role} · <span className="font-semibold tabular-nums">{d.openings.length}</span> {d.openings.length === 1 ? 'opening' : 'openings'}
              </p>
              <p className="truncate text-xs text-muted">
                {details ? `${details} · ` : ''}
                {d.source === 'email' ? 'From email' : 'Draft'} · {relativeAge(d.createdAt)}
                {multiBranch ? ` · ${branchesById.get(d.branchId)?.name ?? ''}` : ''}
              </p>
              <div className="mt-1 flex gap-1.5">
                <Button size="sm" variant="primary" loading={publishingId === d.id} icon={<Send aria-hidden="true" className="size-3.5" />} aria-label={`Publish ${title} ${d.role}`} onClick={() => actions.publish(d)}>
                  Publish
                </Button>
                <Button size="sm" icon={<PencilLine aria-hidden="true" className="size-3.5" />} aria-label={`Edit ${title} ${d.role}`} onClick={() => actions.open('edit', d)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" icon={<XCircle aria-hidden="true" className="size-3.5" />} aria-label={`Close ${title} ${d.role}`} onClick={() => actions.open('close', d)}>
                  Close
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
