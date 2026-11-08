/** Small presentational pieces shared by the queue card, the list view and the drawer. */
import { TASK_CATEGORIES, type PersonLite, type Task, type TaskCategory, type TaskPriority } from '@branchsuite/shared';
import { ArrowRightLeft, CircleCheck, ClipboardList, Ellipsis, Flame, Lock, PanelRightOpen, RotateCcw, Route, Sparkles, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { markerInkVar } from '../../app/theme.js';
import { Badge } from '../../ui/Badge.js';
import { cx } from '../../ui/cx.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../ui/Menu.js';
import { useInboxActions, useInboxEnv } from './InboxContext.js';
import { boardOrderHref, canClaim, canRecategorize, staffingChipLabel, type StaffingState } from './inboxModel.js';

export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  if (priority === 'hot') {
    return (
      <Badge tone="danger" icon={<Flame />} className={cx('uppercase tracking-wide', className)}>
        Hot
      </Badge>
    );
  }
  if (priority === 'low') {
    return (
      <Badge tone="neutral" className={className}>
        Low
      </Badge>
    );
  }
  return null;
}

export function PrivateBadge({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs font-semibold text-muted', className)} title="Personal task: only you can see it">
      <Lock aria-hidden="true" className="size-3.5" />
      Private
    </span>
  );
}

export function AutoBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-sm border border-line px-1 text-[0.6875rem] font-semibold uppercase leading-4 tracking-wider text-subtle" title="Category chosen automatically from the email">
      <Sparkles aria-hidden="true" className="size-3" />
      Auto
      <span className="sr-only"> category</span>
    </span>
  );
}

export function RoutingChip() {
  return (
    <Badge tone="warning" icon={<Route />}>
      Needs routing
    </Badge>
  );
}

export function StaffingChip({ state }: { state: Exclude<StaffingState, null> }) {
  const label = staffingChipLabel(state);
  if (state.kind === 'order') {
    return (
      <Link
        to={boardOrderHref(state.orderId)}
        className="inline-flex items-center gap-1 rounded-sm bg-success-soft px-1.5 py-0.5 text-xs font-semibold leading-none text-success underline-offset-2 hover:underline"
        title="Open this order on the job order board"
      >
        <CircleCheck aria-hidden="true" className="size-3" />
        {label}
      </Link>
    );
  }
  return (
    <Badge tone="accent" icon={<ClipboardList />}>
      {label}
    </Badge>
  );
}

/** Marker dot + initials in the person's ink, with the name for assistive tech. */
export function PersonTag({ person, prefix = 'Assigned to', className }: { person: PersonLite; prefix?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs font-bold tracking-wide', className)} title={`${prefix} ${person.name}`}>
      <MarkerDot marker={person.marker} label={null} size="sm" />
      <span className="sr-only">{prefix} {person.name}</span>
      <span aria-hidden="true" style={{ color: `var(${markerInkVar(person.marker)})` }}>
        {person.initials}
      </span>
    </span>
  );
}

/** Assignee, or "Unclaimed" with a one-click Claim on today's board. */
export function AssigneeSlot({ task, compact = false }: { task: Task; compact?: boolean }) {
  const env = useInboxEnv();
  const actions = useInboxActions();
  if (task.scope === 'personal') return <PrivateBadge />;
  const person = task.assigneeId ? env.peopleById.get(task.assigneeId) : undefined;
  if (task.assigneeId) {
    return person ? <PersonTag person={person} /> : <span className="text-xs text-muted">Assigned</span>;
  }
  const busy = env.readOnly ? false : actions.busyIds.has(task.id);
  return (
    <span className="inline-flex items-center gap-1.5">
      {!compact ? <span className="text-xs font-semibold italic text-muted">Unclaimed</span> : null}
      {canClaim(task, env.readOnly) ? (
        <button
          type="button"
          onClick={() => actions.claim(task)}
          disabled={busy}
          aria-label={`Claim ${task.title}`}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-line-strong bg-surface px-2 text-xs font-semibold text-fg transition-colors hover:border-accent hover:text-accent disabled:opacity-55"
        >
          <UserPlus aria-hidden="true" className="size-3.5" />
          {busy ? 'Claiming…' : 'Claim'}
        </button>
      ) : compact ? (
        <span className="text-xs font-semibold italic text-muted">Unclaimed</span>
      ) : null}
    </span>
  );
}

/** Per-task actions; the keyboard alternative to dragging between columns. */
export function TaskMenu({ task, className }: { task: Task; className?: string }) {
  const env = useInboxEnv();
  const actions = useInboxActions();
  const movable = canRecategorize(task, env.readOnly);
  const others = TASK_CATEGORIES.filter((c) => c.id !== task.category);
  return (
    <Menu
      label={`Actions for ${task.title}`}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`Actions for ${task.title}`}
          title="Task actions"
          className={cx('inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg', className)}
        >
          <Ellipsis aria-hidden="true" className="size-4" />
        </button>
      )}
    >
      <MenuItem icon={<PanelRightOpen />} onSelect={() => actions.open(task)}>
        Open details
      </MenuItem>
      {canClaim(task, env.readOnly) ? (
        <MenuItem icon={<UserPlus />} onSelect={() => actions.claim(task)}>
          Claim
        </MenuItem>
      ) : null}
      {movable ? (
        <>
          <MenuSeparator />
          <MenuLabel>
            <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Move to</span>
          </MenuLabel>
          {others.map((c) => (
            <MenuItem key={c.id} icon={<ArrowRightLeft />} onSelect={() => actions.recategorize(task, c.id as TaskCategory)}>
              {c.label}
            </MenuItem>
          ))}
          {task.categorySource === 'manual' ? (
            <MenuItem icon={<Sparkles />} onSelect={() => actions.recategorize(task, null)}>
              Automatic category
            </MenuItem>
          ) : null}
        </>
      ) : null}
      {!env.readOnly ? (
        <>
          <MenuSeparator />
          {task.status === 'open' ? (
            <MenuItem icon={<CircleCheck />} onSelect={() => actions.complete(task)}>
              Mark complete
            </MenuItem>
          ) : (
            <MenuItem icon={<RotateCcw />} onSelect={() => actions.reopen(task)}>
              Reopen
            </MenuItem>
          )}
        </>
      ) : null}
    </Menu>
  );
}

