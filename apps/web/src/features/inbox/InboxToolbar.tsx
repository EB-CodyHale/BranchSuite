import { TASK_PRIORITIES, type PersonLite } from '@branchsuite/shared';
import { ArrowRightLeft, ChevronDown, Columns3, Flame, List, Plus, Search, UserRound, X } from 'lucide-react';
import { buttonClasses, Button } from '../../ui/Button.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { Menu, MenuRadioItem, MenuSeparator } from '../../ui/Menu.js';
import { Segmented } from '../../ui/Segmented.js';
import { PRIORITY_LABEL, type AssigneeFilter, type InboxFilters, type InboxLayout, type PriorityFilter } from './inboxModel.js';

export interface InboxToolbarProps {
  filters: InboxFilters;
  onFilters: (patch: Partial<InboxFilters>) => void;
  layout: InboxLayout;
  onLayout: (l: InboxLayout) => void;
  people: readonly PersonLite[];
  viewerId: string;
  /** Hide the assignee filter where it means nothing (personal view). */
  showAssignee: boolean;
  canAdd: boolean;
  onAdd: () => void;
  canReassign: boolean;
  onReassign: () => void;
}

const LAYOUTS = [
  { value: 'queue' as const, label: 'Queue', icon: <Columns3 /> },
  { value: 'list' as const, label: 'List', icon: <List /> },
];

function assigneeText(a: AssigneeFilter, people: readonly PersonLite[]): string {
  if (a === 'all') return 'Everyone';
  if (a === 'me') return 'Mine';
  if (a === 'unassigned') return 'Unclaimed';
  return people.find((p) => p.id === a.userId)?.name ?? 'Someone';
}

const sameAssignee = (a: AssigneeFilter, b: AssigneeFilter) => (typeof a === 'object' && typeof b === 'object' ? a.userId === b.userId : a === b);

export function InboxToolbar({ filters, onFilters, layout, onLayout, people, viewerId, showAssignee, canAdd, onAdd, canReassign, onReassign }: InboxToolbarProps) {
  const others = people.filter((p) => p.id !== viewerId);
  const priorityText = filters.priority === 'all' ? 'Any priority' : PRIORITY_LABEL[filters.priority];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <input
          type="search"
          aria-label="Search tasks"
          placeholder="Search title, sender, account…"
          value={filters.search}
          onChange={(e) => onFilters({ search: e.target.value })}
          className="h-8 w-full rounded-md border border-line-strong bg-surface pl-8 pr-8 text-sm text-fg placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-search-cancel-button]:hidden"
        />
        {filters.search ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onFilters({ search: '' })}
            className="absolute right-1 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted hover:text-fg"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>

      {showAssignee ? (
        <Menu
          label="Filter by assignee"
          placement="bottom-start"
          trigger={(props) => (
            <button {...props} type="button" className={buttonClasses(filters.assignee === 'all' ? 'secondary' : 'primary', 'sm')} aria-label={`Assignee: ${assigneeText(filters.assignee, people)}`}>
              <UserRound aria-hidden="true" className="size-4" />
              {assigneeText(filters.assignee, people)}
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
          )}
        >
          {(['all', 'me', 'unassigned'] as const).map((v) => (
            <MenuRadioItem key={v} checked={sameAssignee(filters.assignee, v)} onSelect={() => onFilters({ assignee: v })}>
              {assigneeText(v, people)}
            </MenuRadioItem>
          ))}
          {others.length > 0 ? <MenuSeparator /> : null}
          {others.map((p) => (
            <MenuRadioItem key={p.id} checked={sameAssignee(filters.assignee, { userId: p.id })} onSelect={() => onFilters({ assignee: { userId: p.id } })}>
              <span className="inline-flex items-center gap-2">
                <MarkerDot marker={p.marker} label={null} size="sm" />
                {p.name}
              </span>
            </MenuRadioItem>
          ))}
        </Menu>
      ) : null}

      <Menu
        label="Filter by priority"
        placement="bottom-start"
        trigger={(props) => (
          <button {...props} type="button" className={buttonClasses(filters.priority === 'all' ? 'secondary' : 'primary', 'sm')} aria-label={`Priority: ${priorityText}`}>
            <Flame aria-hidden="true" className="size-4" />
            {priorityText}
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </button>
        )}
      >
        {(['all', ...TASK_PRIORITIES] as PriorityFilter[]).map((p) => (
          <MenuRadioItem key={p} checked={filters.priority === p} onSelect={() => onFilters({ priority: p })}>
            {p === 'all' ? 'Any priority' : PRIORITY_LABEL[p]}
          </MenuRadioItem>
        ))}
      </Menu>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Segmented label="Layout" size="sm" options={LAYOUTS} value={layout} onChange={onLayout} />
        {canReassign ? (
          <Button size="sm" variant="ghost" icon={<ArrowRightLeft aria-hidden="true" className="size-4" />} onClick={onReassign}>
            Reassign tasks from…
          </Button>
        ) : null}
        {canAdd ? (
          <Button size="sm" variant="primary" icon={<Plus aria-hidden="true" className="size-4" />} onClick={onAdd}>
            Add task
          </Button>
        ) : null}
      </div>
    </div>
  );
}
