import { ROLE_CATEGORIES, type Branch, type OrderSort, type PersonLite } from '@branchsuite/shared';
import { ChevronDown, Layers, LayoutGrid, Rows3, Search, UserRound, X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cx } from '../../ui/cx.js';
import { ToggleChip } from '../../ui/Chip.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { Menu, MenuRadioItem, MenuSeparator } from '../../ui/Menu.js';
import { Segmented } from '../../ui/Segmented.js';
import { OWNER_ALL, OWNER_NONE, ROLE_ALL, type BoardView, type ToolbarState } from './boardModel.js';

export const SORT_OPTIONS: ReadonlyArray<{ value: OrderSort; label: string }> = [
  { value: 'need', label: 'Most to fill' },
  { value: 'start', label: 'Next start' },
  { value: 'age', label: 'Open longest' },
  { value: 'account', label: 'Account' },
];

const VIEW_OPTIONS: ReadonlyArray<{ value: BoardView; label: string; icon: ReactNode }> = [
  { value: 'board', label: 'Board', icon: <LayoutGrid /> },
  { value: 'list', label: 'List', icon: <Rows3 /> },
];

export interface BoardToolbarProps {
  state: ToolbarState;
  onChange: (patch: Partial<ToolbarState>) => void;
  search: string;
  onSearch: (value: string) => void;
  people: readonly PersonLite[];
  /** Branches in scope; chips render only when there are several. */
  branches: readonly Branch[];
}

export function BoardToolbar({ state, onChange, search, onSearch, people, branches }: BoardToolbarProps) {
  const searchId = useId();
  const roleId = useId();
  const ownerPerson = people.find((p) => p.id === state.owner);
  const ownerText = state.owner === OWNER_ALL ? 'All owners' : state.owner === OWNER_NONE ? 'Unowned' : (ownerPerson?.name ?? 'Owner');

  const toggleBranch = (id: string) => {
    const next = state.branchIds.includes(id) ? state.branchIds.filter((b) => b !== id) : [...state.branchIds, id];
    onChange({ branchIds: next });
  };

  return (
    <div role="search" aria-label="Filter and sort orders" className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-[1_1_14rem]">
          <label htmlFor={searchId} className="sr-only">
            Search orders
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search account, unit, site, role"
            autoComplete="off"
            className="h-9 w-full rounded-md border border-line-strong bg-surface pl-8 pr-8 text-[0.9375rem] text-fg placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
          />
          {search ? (
            <button type="button" aria-label="Clear search" onClick={() => onSearch('')} className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg">
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
        <Segmented label="Sort orders" options={SORT_OPTIONS} value={state.sort} onChange={(sort) => onChange({ sort })} className="max-w-full overflow-x-auto" />
        <Segmented label="View" options={VIEW_OPTIONS} value={state.view} onChange={(view) => onChange({ view })} className="ml-auto" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Menu
          label="Owner filter"
          placement="bottom-start"
          className="max-h-80 overflow-y-auto"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              aria-label={`Owner: ${ownerText}`}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-sm font-medium',
                state.owner === OWNER_ALL ? 'border-line bg-surface text-muted hover:text-fg' : 'border-accent bg-accent-soft font-semibold text-accent',
              )}
            >
              {ownerPerson ? <MarkerDot marker={ownerPerson.marker} label={null} size="sm" /> : <UserRound aria-hidden="true" className="size-3.5" />}
              <span className="max-w-[10rem] truncate">{ownerText}</span>
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
          )}
        >
          <MenuRadioItem checked={state.owner === OWNER_ALL} onSelect={() => onChange({ owner: OWNER_ALL })}>
            All owners
          </MenuRadioItem>
          <MenuRadioItem checked={state.owner === OWNER_NONE} onSelect={() => onChange({ owner: OWNER_NONE })}>
            Unowned
          </MenuRadioItem>
          {people.length > 0 ? <MenuSeparator /> : null}
          {people.map((p) => (
            <MenuRadioItem key={p.id} checked={state.owner === p.id} onSelect={() => onChange({ owner: p.id })}>
              <span className="inline-flex items-center gap-2">
                <MarkerDot marker={p.marker} label={null} size="sm" />
                {p.name}
                <span className="text-xs font-bold text-muted">{p.initials}</span>
              </span>
            </MenuRadioItem>
          ))}
        </Menu>

        <label htmlFor={roleId} className="sr-only">
          Role category
        </label>
        <select
          id={roleId}
          value={state.roleCategory}
          onChange={(e) => onChange({ roleCategory: e.target.value as ToolbarState['roleCategory'] })}
          className={cx(
            'h-8 max-w-[12rem] rounded-full border pl-2.5 pr-7 text-sm font-medium',
            state.roleCategory === ROLE_ALL ? 'border-line bg-surface text-muted' : 'border-accent bg-accent-soft font-semibold text-accent',
          )}
        >
          <option value={ROLE_ALL}>All roles</option>
          {ROLE_CATEGORIES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>

        <ToggleChip pressed={state.hasOpenings} onPressedChange={(hasOpenings) => onChange({ hasOpenings })}>
          Has openings
        </ToggleChip>
        <ToggleChip pressed={state.showPaused} onPressedChange={(showPaused) => onChange({ showPaused })}>
          Show paused
        </ToggleChip>
        {state.view === 'board' ? (
          <ToggleChip
            pressed={state.groupByAccount || state.sort === 'account'}
            disabled={state.sort === 'account'}
            title={state.sort === 'account' ? 'Account sort already groups orders' : undefined}
            onPressedChange={(groupByAccount) => onChange({ groupByAccount })}
            icon={<Layers />}
            className="disabled:opacity-60"
          >
            Group by account
          </ToggleChip>
        ) : null}

        {branches.length > 1 ? (
          <div role="group" aria-label="Branches" className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            {branches.map((b) => (
              <ToggleChip key={b.id} pressed={state.branchIds.includes(b.id)} onPressedChange={() => toggleBranch(b.id)}>
                {b.name}
              </ToggleChip>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
