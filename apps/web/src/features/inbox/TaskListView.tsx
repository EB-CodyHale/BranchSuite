import { effectivePriority, type Task } from '@branchsuite/shared';
import { Mail } from 'lucide-react';
import { useInboxActions, useInboxEnv } from './InboxContext.js';
import { ageLabel, ageLongLabel, categoryLabel, needsRouting, staffingState, taskAccountText } from './inboxModel.js';
import { AssigneeSlot, AutoBadge, PriorityBadge, RoutingChip, StaffingChip, TaskMenu } from './TaskBits.js';

/** Dense table alternative to the queue columns (open tasks only; cleared work sits in the tray). */
export function TaskListView({ tasks }: { tasks: Task[] }) {
  const env = useInboxEnv();
  const actions = useInboxActions();
  const open = tasks.filter((t) => t.status === 'open');
  if (open.length === 0) {
    return <p className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-subtle">No open tasks match.</p>;
  }
  return (
    <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <caption className="sr-only">Open tasks</caption>
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
            <th scope="col" className="px-3 py-2">Priority</th>
            <th scope="col" className="px-3 py-2">Task</th>
            <th scope="col" className="px-3 py-2">Category</th>
            <th scope="col" className="px-3 py-2">Account</th>
            <th scope="col" className="px-3 py-2">Owner</th>
            <th scope="col" className="px-3 py-2 text-right">Age</th>
            <th scope="col" className="px-3 py-2 text-right">
              <span className="sr-only">Messages</span>
              <Mail aria-hidden="true" className="ml-auto size-3.5" />
            </th>
            <th scope="col" className="px-2 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {open.map((t) => {
            const priority = effectivePriority(t, env.accountsById);
            const today = env.todayFor(t);
            const account = taskAccountText(t, env.accountsById);
            const staffing = staffingState(t, env.ordersById);
            const branchName = env.multiBranch && t.branchId ? env.branchesById.get(t.branchId)?.name : null;
            return (
              <tr key={t.id} data-task-id={t.id} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                <td className="px-3 py-1.5 align-middle">{priority === 'normal' ? <span className="text-xs text-subtle">Normal</span> : <PriorityBadge priority={priority} />}</td>
                <td className="max-w-[22rem] px-3 py-1.5">
                  <button type="button" onClick={() => actions.open(t)} className="block max-w-full truncate text-left font-semibold text-fg underline-offset-2 hover:underline">
                    {t.title}
                  </button>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {branchName ? <span className="text-xs text-muted">{branchName}</span> : null}
                    {staffing ? <StaffingChip state={staffing} /> : null}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    {categoryLabel(t.category)}
                    {t.categorySource === 'auto' ? <AutoBadge /> : null}
                  </span>
                </td>
                <td className="max-w-[14rem] truncate px-3 py-1.5 text-muted">{account ?? (needsRouting(t) ? <RoutingChip /> : <span className="text-subtle">—</span>)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <AssigneeSlot task={t} compact />
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums" title={ageLongLabel(t.boardDate, today)}>
                  {ageLabel(t.boardDate, today)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted">{t.email ? t.email.messageCount : ''}</td>
                <td className="px-2 py-1.5 text-right">
                  <TaskMenu task={t} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
