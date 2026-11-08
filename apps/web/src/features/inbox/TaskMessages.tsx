import type { EmailMessage } from '@branchsuite/shared';
import { CircleAlert, Sparkles } from 'lucide-react';
import { errorMessage } from '../../lib/api.js';
import { useTaskMessages } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { formatDateTime } from './inboxModel.js';

/** The email thread behind a task, loaded on demand when this component mounts. */
export function TaskMessages({ scopeId, taskId, timeZone }: { scopeId: string; taskId: string; timeZone?: string }) {
  const messages = useTaskMessages(scopeId, taskId);

  if (messages.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Loading messages…</span>
        <Skeleton className="h-16 w-4/5" />
        <Skeleton className="ml-auto h-12 w-3/5" />
      </div>
    );
  }
  if (messages.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
        <CircleAlert aria-hidden="true" className="size-4" />
        <span className="flex-1">Messages did not load. {errorMessage(messages.error)}</span>
        <Button size="sm" onClick={() => void messages.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  const list = [...messages.data].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  if (list.length === 0) return <p className="text-sm text-muted">No stored messages for this task.</p>;
  return (
    <ol className="flex flex-col gap-2.5" aria-label="Email thread">
      {list.map((m) => (
        <MessageBubble key={m.id} message={m} timeZone={timeZone} />
      ))}
    </ol>
  );
}

function MessageBubble({ message: m, timeZone }: { message: EmailMessage; timeZone?: string }) {
  const outbound = m.direction === 'outbound';
  return (
    <li className={cx('flex flex-col', outbound ? 'items-end' : 'items-start')}>
      <article
        aria-label={`${outbound ? 'Team reply' : 'Inbound'} from ${m.fromName || m.fromAddress}`}
        className={cx(
          'max-w-[92%] rounded-lg border px-3 py-2 text-sm',
          outbound ? 'rounded-br-sm border-accent/30 bg-accent-soft' : 'rounded-bl-sm border-line bg-surface-2',
        )}
      >
        <header className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold text-fg">{m.fromName || m.fromAddress}</span>
          <span className="text-muted">{outbound ? 'Team reply' : 'Inbound'}</span>
          <time dateTime={m.receivedAt} className="ml-auto tabular-nums text-muted">
            {formatDateTime(m.receivedAt, timeZone)}
          </time>
        </header>
        <p className="mt-1 whitespace-pre-line break-words text-fg">{m.bodyText || <span className="italic text-muted">(no new text)</span>}</p>
      </article>
      {m.decision ? (
        <p className="mt-1 inline-flex max-w-[92%] items-start gap-1 px-1 text-xs italic text-muted">
          <Sparkles aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          <span>
            <span className="sr-only">Decision note: </span>
            {m.decision}
          </span>
        </p>
      ) : null}
    </li>
  );
}
