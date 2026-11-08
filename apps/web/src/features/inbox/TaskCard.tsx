import { effectivePriority, type Task } from '@branchsuite/shared';
import { GripVertical, Mail } from 'lucide-react';
import { memo, useId, type DragEvent } from 'react';
import { markerInkVar } from '../../app/theme.js';
import { Badge } from '../../ui/Badge.js';
import { cx } from '../../ui/cx.js';
import { useInboxActions, useInboxEnv } from './InboxContext.js';
import { ageLabel, ageLongLabel, canRecategorize, needsRouting, staffingState, taskAccountText } from './inboxModel.js';
import { AssigneeSlot, AutoBadge, PriorityBadge, PrivateBadge, RoutingChip, StaffingChip, TaskMenu } from './TaskBits.js';

/** MIME type used for dragging task cards between columns. */
export const TASK_DRAG_TYPE = 'application/x-branchsuite-task';

export interface TaskCardProps {
  task: Task;
  onDragStart?: (task: Task) => void;
  onDragEnd?: () => void;
}

function TaskCardImpl({ task, onDragStart, onDragEnd }: TaskCardProps) {
  const env = useInboxEnv();
  const actions = useInboxActions();
  const headingId = useId();
  const priority = effectivePriority(task, env.accountsById);
  const today = env.todayFor(task);
  const age = ageLabel(task.boardDate, today);
  const accountText = taskAccountText(task, env.accountsById);
  const staffing = staffingState(task, env.ordersById);
  const assignee = task.assigneeId ? env.peopleById.get(task.assigneeId) : undefined;
  const draggable = canRecategorize(task, env.readOnly);
  const branchName = env.multiBranch && task.branchId ? env.branchesById.get(task.branchId)?.name : null;
  const carried = age !== 'today' && age !== '';

  const handleDragStart = (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
    e.dataTransfer.setData('text/plain', task.title);
    onDragStart?.(task);
  };

  return (
    <article
      aria-labelledby={headingId}
      data-task-id={task.id}
      draggable={draggable || undefined}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      className={cx(
        'group relative flex min-w-0 flex-col gap-1.5 rounded-md border border-rule bg-paper py-2 pl-3 pr-2 text-ink shadow-card',
        'border-l-[4px] transition-shadow hover:shadow-pop',
        priority === 'hot' && 'bg-danger-soft/40',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
      style={{
        borderLeftColor: priority === 'hot' ? 'var(--danger)' : assignee ? `var(${markerInkVar(assignee.marker)})` : 'var(--board-line)',
      }}
    >
      <div className="flex items-start gap-1.5">
        {draggable ? <GripVertical aria-hidden="true" className="-ml-1.5 mt-0.5 size-4 shrink-0 text-subtle opacity-50 group-hover:opacity-100" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={priority} />
            {task.scope === 'personal' ? <PrivateBadge /> : null}
            {branchName ? <Badge tone="neutral">{branchName}</Badge> : null}
            {task.categorySource === 'auto' && task.status === 'open' ? <AutoBadge /> : null}
          </div>
          <h3 id={headingId} className="mt-0.5 font-display text-[1.0625rem] font-semibold leading-snug text-ink">
            <button
              type="button"
              onClick={() => actions.open(task)}
              className="text-left underline-offset-2 hover:underline focus-visible:underline"
            >
              {task.title}
            </button>
          </h3>
          {task.scope === 'branch' ? (
            accountText ? (
              <p className="truncate text-xs font-medium text-muted">{accountText}</p>
            ) : needsRouting(task) ? (
              <div className="mt-0.5">
                <RoutingChip />
              </div>
            ) : null
          ) : null}
        </div>
        <TaskMenu task={task} className="-mt-0.5 shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
        <span className={cx('tabular-nums font-semibold', carried ? 'text-fg' : 'text-muted')} title={ageLongLabel(task.boardDate, today)}>
          <span className="sr-only">Age </span>
          {age}
        </span>
        {task.email ? (
          <span className="inline-flex items-center gap-1 tabular-nums" title={`${task.email.messageCount} email ${task.email.messageCount === 1 ? 'message' : 'messages'}`}>
            <Mail aria-hidden="true" className="size-3.5" />
            {task.email.messageCount}
            <span className="sr-only"> {task.email.messageCount === 1 ? 'message' : 'messages'}</span>
          </span>
        ) : null}
        {staffing ? <StaffingChip state={staffing} /> : null}
        {task.scope === 'branch' ? (
          <span className="ml-auto">
            <AssigneeSlot task={task} />
          </span>
        ) : null}
      </div>
    </article>
  );
}

export const TaskCard = memo(TaskCardImpl);
