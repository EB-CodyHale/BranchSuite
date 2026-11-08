import type { Candidate } from '@branchsuite/shared';
import { Archive, CalendarDays, Clock } from 'lucide-react';
import { memo, useId, type DragEvent } from 'react';
import { markerInkVar } from '../../app/theme.js';
import { Badge } from '../../ui/Badge.js';
import { cx } from '../../ui/cx.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { AccountTag, CandidateAvatar, LineStatusPill, MoveMenu } from './PipelineBits.js';
import { usePipelineActions, usePipelineEnv } from './PipelineContext.js';
import { fullName, isStale, linkedLine, roleShift, stageDays, startInfo } from './pipelineModel.js';

export const DRAG_TYPE = 'application/x-branchsuite-candidate';

export interface CandidateCardProps {
  candidate: Candidate;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}

const START_TONE = { past: 'text-danger font-semibold', soon: 'rounded-sm bg-warning-soft px-1 font-semibold text-warning', later: 'text-muted' } as const;

function CandidateCardImpl({ candidate, dragging, onDragStart, onDragEnd }: CandidateCardProps) {
  const env = usePipelineEnv();
  const { openCandidate, movingIds } = usePipelineActions();
  const nameId = useId();
  const recruiter = candidate.recruiterId ? env.peopleById.get(candidate.recruiterId) : undefined;
  const account = candidate.accountId ? env.accountsById.get(candidate.accountId) : undefined;
  const link = linkedLine(candidate, env.ordersById);
  const days = stageDays(candidate);
  const stale = isStale(days) && candidate.stage !== 'started' && candidate.stage !== 'dropped';
  const start = startInfo(candidate.startDate, env.today);
  const archived = candidate.status === 'archived';
  const moving = movingIds.has(candidate.id);
  const name = fullName(candidate);

  const dragStart = (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_TYPE, candidate.id);
    e.dataTransfer.setData('text/plain', name);
    onDragStart(candidate.id);
  };

  return (
    <article
      aria-labelledby={nameId}
      data-candidate-id={candidate.id}
      draggable={!archived && !moving}
      onDragStart={archived ? undefined : dragStart}
      onDragEnd={onDragEnd}
      aria-busy={moving || undefined}
      className={cx(
        'group relative flex flex-col gap-2 rounded-md border border-rule bg-paper p-2.5 text-ink shadow-card transition-[opacity,box-shadow]',
        !archived && 'cursor-grab active:cursor-grabbing hover:shadow-pop',
        dragging && 'opacity-40',
        moving && 'opacity-70',
        archived && 'border-dashed opacity-80',
      )}
    >
      <div className="flex items-start gap-2.5">
        <CandidateAvatar candidate={candidate} recruiter={recruiter} />
        <div className="min-w-0 flex-1">
          <h3 id={nameId} className="font-display text-[1.05rem] font-bold leading-tight">
            <button
              type="button"
              onClick={() => openCandidate(candidate.id)}
              className="text-left underline-offset-2 hover:underline focus-visible:underline"
            >
              {name}
            </button>
          </h3>
          {account ? (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted">
              <span className="shrink-0">In process for</span>
              <AccountTag account={account} className="font-semibold text-fg" />
            </p>
          ) : (
            <p className="mt-0.5 text-xs italic text-subtle">No account yet</p>
          )}
        </div>
        <MoveMenu candidate={candidate} className="-mr-1 -mt-0.5" />
      </div>

      {link ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border-l-2 border-rule bg-surface-2/60 px-2 py-1 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">
            <span className="sr-only">Order: </span>
            {roleShift(link.order)}
          </span>
          <LineStatusPill line={link.line} />
        </div>
      ) : candidate.orderId ? (
        <p className="text-xs italic text-subtle">Linked order is no longer on the board</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
        {start ? (
          <span className={cx('inline-flex items-center gap-1', START_TONE[start.tone])}>
            <CalendarDays aria-hidden="true" className="size-3.5" />
            {start.label}
          </span>
        ) : null}
        <span className={cx('inline-flex items-center gap-1', stale ? 'font-semibold text-warning' : 'text-muted')} title={`${days} days in this stage`}>
          {stale ? <Clock aria-hidden="true" className="size-3.5" /> : null}
          {days}d in stage
          {stale ? <span className="sr-only"> (stalled)</span> : null}
        </span>
        {archived ? (
          <Badge icon={<Archive />} tone="neutral">
            Archived
          </Badge>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1 font-bold tracking-wide" title={recruiter ? `Recruiter: ${recruiter.name}` : 'No recruiter'}>
          {recruiter ? (
            <>
              <MarkerDot marker={recruiter.marker} label={null} size="sm" />
              <span className="sr-only">Recruiter </span>
              <span style={{ color: `var(${markerInkVar(recruiter.marker)})` }}>{recruiter.initials}</span>
            </>
          ) : (
            <span className="font-normal italic text-subtle">Unassigned</span>
          )}
        </span>
      </div>
    </article>
  );
}

export const CandidateCard = memo(CandidateCardImpl);
