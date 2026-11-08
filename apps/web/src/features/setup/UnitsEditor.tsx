import { LIMITS, unitPath, validateUnits, type AccountUnit } from '@branchsuite/shared';
import { ChevronRight, CornerDownRight, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RosterEntry } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import { IconButton } from '../../ui/IconButton.js';
import { ChipInput, newLocalId, Notice } from './setupUi.js';

/** Shared tree rules (unknown parent, cycle, depth, duplicate ids) plus local checks the schema enforces. */
export function unitTreeErrors(units: AccountUnit[]): string[] {
  const local: string[] = [];
  const blank = units.filter((u) => !u.name.trim()).length;
  if (blank > 0) local.push(`${blank} unit${blank === 1 ? ' has' : 's have'} no name.`);
  const seen = new Map<string, number>();
  for (const u of units) {
    const key = `${u.parentId ?? ''}|${u.name.trim().toLowerCase()}`;
    if (u.name.trim()) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) if (n > 1) local.push(`Two units under the same parent are both named "${units.find((u) => `${u.parentId ?? ''}|${u.name.trim().toLowerCase()}` === key)?.name.trim()}".`);
  const shortAlias = units.filter((u) => u.aliases.some((a) => a.trim().length < 2));
  if (shortAlias.length) local.push('Aliases need at least 2 characters.');
  return [...validateUnits(units), ...local];
}

export interface UnitsEditorProps {
  units: AccountUnit[];
  onChange: (units: AccountUnit[]) => void;
  people: readonly RosterEntry[];
  /** Ids already saved on the server: these are deactivated, never removed. */
  savedIds: ReadonlySet<string>;
}

export function UnitsEditor({ units, onChange, people, savedIds }: UnitsEditorProps) {
  const errors = unitTreeErrors(units);
  const byId = new Map(units.map((u) => [u.id, u] as const));
  const children = new Map<string | null, AccountUnit[]>();
  for (const u of units) {
    const parent = u.parentId !== null && byId.has(u.parentId) ? u.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(u);
  }
  const depthOf = (id: string) => unitPath({ units }, id).length;

  const patch = (id: string, change: Partial<AccountUnit>) => onChange(units.map((u) => (u.id === id ? { ...u, ...change } : u)));
  const add = (parentId: string | null) =>
    onChange([...units, { id: newLocalId('unit'), name: '', parentId, ownerId: null, aliases: [], active: true }]);
  const remove = (id: string) => onChange(units.filter((u) => u.id !== id).map((u) => (u.parentId === id ? { ...u, parentId: null } : u)));

  // Units in a cycle are unreachable from the top level; list them separately so they stay editable.
  const placed = new Set<string>();
  const renderLevel = (parentId: string | null, depth: number): ReactNode => {
    const list = (children.get(parentId) ?? []).filter((u) => !placed.has(u.id));
    if (list.length === 0) return null;
    return (
      <ul className={cx('flex flex-col gap-2', depth > 0 && 'ml-3 border-l border-line pl-3 sm:ml-5 sm:pl-4')}>
        {list.map((u) => {
          placed.add(u.id);
          return (
            <li key={u.id}>
              <UnitRow
                unit={u}
                units={units}
                people={people}
                depth={depthOf(u.id)}
                saved={savedIds.has(u.id)}
                onPatch={(c) => patch(u.id, c)}
                onAddChild={() => add(u.id)}
                onRemove={() => remove(u.id)}
              />
              {renderLevel(u.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };
  const tree = renderLevel(null, 0);
  const unplaced = units.filter((u) => !placed.has(u.id));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Units are sites, departments or buildings under this account, up to {LIMITS.maxUnitDepth} levels deep. A unit owner overrides the account owner on the board.
      </p>
      {errors.length > 0 ? (
        <Notice tone="danger" role="alert" title="Fix the unit tree before saving">
          <ul className="list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {units.length === 0 ? <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-sm text-muted">No units. Orders go to the account as a whole.</p> : tree}
      {unplaced.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-danger/60 p-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-danger">Not reachable from the top level</p>
          {unplaced.map((u) => (
            <UnitRow key={u.id} unit={u} units={units} people={people} depth={LIMITS.maxUnitDepth} saved={savedIds.has(u.id)} onPatch={(c) => patch(u.id, c)} onAddChild={() => undefined} onRemove={() => remove(u.id)} />
          ))}
        </div>
      ) : null}
      <div>
        <Button size="sm" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => add(null)} disabled={units.length >= LIMITS.maxUnitsPerAccount}>
          Add top-level unit
        </Button>
      </div>
    </div>
  );
}

function UnitRow({
  unit,
  units,
  people,
  depth,
  saved,
  onPatch,
  onAddChild,
  onRemove,
}: {
  unit: AccountUnit;
  units: AccountUnit[];
  people: readonly RosterEntry[];
  depth: number;
  saved: boolean;
  onPatch: (c: Partial<AccountUnit>) => void;
  onAddChild: () => void;
  onRemove: () => void;
}) {
  const label = unit.name.trim() || 'New unit';
  const atMax = depth >= LIMITS.maxUnitDepth;
  const owners = people.filter((p) => p.active || p.id === unit.ownerId);
  return (
    <div className={cx('rounded-md border bg-surface p-2.5', unit.active ? 'border-line' : 'border-dashed border-line-strong bg-surface-2/50')}>
      <div className="flex flex-wrap items-center gap-2">
        {depth > 1 ? <CornerDownRight aria-hidden="true" className="size-4 shrink-0 text-subtle" /> : null}
        <label className="min-w-[10rem] flex-1">
          <span className="sr-only">Unit name</span>
          <input
            value={unit.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder="Unit name, e.g. Dock B"
            maxLength={LIMITS.maxShortText}
            aria-invalid={!unit.name.trim() || undefined}
            className={cx('h-8 w-full rounded-md border bg-surface px-2 font-semibold', unit.name.trim() ? 'border-line-strong' : 'border-danger')}
          />
        </label>
        {!unit.active ? <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-muted">Inactive</span> : null}
        <span className="text-xs font-semibold tabular-nums text-subtle" title="Depth in the tree">
          L{depth}
        </span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-0.5 text-xs font-semibold text-muted">
          Parent
          <select
            aria-label={`Parent of ${label}`}
            value={unit.parentId ?? ''}
            onChange={(e) => onPatch({ parentId: e.target.value || null })}
            className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm font-normal text-fg"
          >
            <option value="">Top level</option>
            {units
              .filter((u) => u.id !== unit.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name.trim() || 'New unit'}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs font-semibold text-muted">
          Owner
          <select
            aria-label={`Owner of ${label}`}
            value={unit.ownerId ?? ''}
            onChange={(e) => onPatch({ ownerId: e.target.value || null })}
            className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm font-normal text-fg"
          >
            <option value="">Same as account</option>
            {owners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.initials})
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="group mt-2">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs font-semibold text-muted hover:text-fg">
          <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-90" />
          Aliases ({unit.aliases.length})
        </summary>
        <ChipInput
          className="mt-1.5"
          label={`Aliases for ${label}`}
          values={unit.aliases}
          onChange={(aliases) => onPatch({ aliases })}
          validate={(v) => (v.length < 2 ? 'Aliases need at least 2 characters.' : null)}
          max={LIMITS.maxAliases}
          hint="Other names clients use in email for this unit. Used by routing."
        />
      </details>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <Button size="sm" variant="ghost" icon={<Plus aria-hidden="true" className="size-4" />} onClick={onAddChild} disabled={atMax} title={atMax ? `Units can be at most ${LIMITS.maxUnitDepth} levels deep.` : undefined}>
          Add child
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onPatch({ active: !unit.active })}>
          {unit.active ? 'Deactivate' : 'Reactivate'}
        </Button>
        {saved ? null : (
          <IconButton label={`Remove ${label}`} size="sm" onClick={onRemove} className="ml-auto">
            <Trash2 />
          </IconButton>
        )}
      </div>
    </div>
  );
}
