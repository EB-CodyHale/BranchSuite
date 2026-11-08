import { TASK_CATEGORIES, type Task, type TaskCategory } from '@branchsuite/shared';
import { Briefcase, Building2, Users } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { cx } from '../../ui/cx.js';
import { useInboxActions, useInboxEnv } from './InboxContext.js';
import type { CategoryGroups } from './inboxModel.js';
import { TASK_DRAG_TYPE, TaskCard } from './TaskCard.js';

const ICONS: Record<TaskCategory, ReactNode> = {
  client: <Briefcase />,
  associate: <Users />,
  operations: <Building2 />,
};

export interface TaskQueueProps {
  groups: CategoryGroups;
  /** Every task currently on screen, to resolve a dropped id. */
  tasksById: Map<string, Task>;
}

/** Three category columns. Open cards drag between columns (today only); the card menu is the keyboard path. */
export function TaskQueue({ groups, tasksById }: TaskQueueProps) {
  const env = useInboxEnv();
  const actions = useInboxActions();
  const [dragging, setDragging] = useState<Task | null>(null);
  const [over, setOver] = useState<TaskCategory | null>(null);
  // dragenter/leave fire for every child; count them so the highlight does not flicker.
  const depth = useRef<Record<string, number>>({});

  const accepts = (e: DragEvent) => !env.readOnly && Array.from(e.dataTransfer.types).includes(TASK_DRAG_TYPE);

  const onDrop = (category: TaskCategory) => (e: DragEvent<HTMLElement>) => {
    if (!accepts(e)) return;
    e.preventDefault();
    depth.current = {};
    setOver(null);
    setDragging(null);
    const id = e.dataTransfer.getData(TASK_DRAG_TYPE);
    const task = tasksById.get(id);
    if (task && task.status === 'open' && task.category !== category) actions.recategorize(task, category);
  };

  return (
    <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-3" role="region" aria-label="Task queue">
      {TASK_CATEGORIES.map((c) => {
        const id = c.id as TaskCategory;
        const list = groups[id];
        const isOver = over === id && dragging !== null && dragging.category !== id;
        return (
          <section
            key={id}
            aria-labelledby={`inbox-col-${id}`}
            data-category={id}
            onDragEnter={(e) => {
              if (!accepts(e)) return;
              e.preventDefault();
              depth.current[id] = (depth.current[id] ?? 0) + 1;
              setOver(id);
            }}
            onDragOver={(e) => {
              if (!accepts(e)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDragLeave={(e) => {
              if (!accepts(e)) return;
              depth.current[id] = Math.max(0, (depth.current[id] ?? 1) - 1);
              if (depth.current[id] === 0) setOver((o) => (o === id ? null : o));
            }}
            onDrop={onDrop(id)}
            className={cx(
              'flex min-h-40 min-w-0 flex-col rounded-lg border bg-surface-2/60 transition-colors',
              isOver ? 'border-accent border-dashed bg-accent-soft' : 'border-line',
            )}
          >
            <header className="flex items-center gap-2 border-b border-line px-3 py-2">
              <span aria-hidden="true" className="inline-flex text-muted [&>svg]:size-4">
                {ICONS[id]}
              </span>
              <h2 id={`inbox-col-${id}`} className="min-w-0 flex-1 truncate font-display text-base font-bold uppercase tracking-wide text-fg">
                {c.label}
              </h2>
              <span className="font-display text-lg font-bold tabular-nums text-fg">
                {list.length}
                <span className="sr-only"> open {list.length === 1 ? 'task' : 'tasks'}</span>
              </span>
            </header>
            {list.length === 0 ? (
              <p className={cx('px-3 py-6 text-center text-sm', isOver ? 'font-semibold text-accent' : 'text-subtle')}>
                {isOver ? `Drop to move to ${c.label}` : 'All clear'}
              </p>
            ) : (
              <ul className="flex flex-col gap-2 p-2" aria-label={`${c.label} tasks`}>
                {list.map((t) => (
                  <li key={t.id} className={cx(dragging?.id === t.id && 'opacity-50')}>
                    <TaskCard
                      task={t}
                      onDragStart={setDragging}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                        depth.current = {};
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
