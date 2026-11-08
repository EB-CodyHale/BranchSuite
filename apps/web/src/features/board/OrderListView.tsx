import { openingCounts, orderAgeOn, shortDay, sortOrders, DEFAULT_TIME_ZONE, LIMITS, type Order, type PersonLite } from '@branchsuite/shared';
import { ArrowDown, ArrowUp, ChevronRight, CirclePause, Star } from 'lucide-react';
import { Fragment, memo, useMemo, useState } from 'react';
import { cx } from '../../ui/cx.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { useBoardEnv } from './BoardContext.js';
import { nextStartDate, todayFor, unitText } from './boardModel.js';
import { OrderLine } from './OrderLine.js';
import { OrderMenu } from './OrderMenu.js';

export type ListColumn = 'account' | 'unit' | 'role' | 'shift' | 'toFill' | 'tentative' | 'committed' | 'started' | 'nextStart' | 'age' | 'owner';

const COLUMNS: ReadonlyArray<{ id: ListColumn; label: string; numeric?: boolean; className?: string }> = [
  { id: 'account', label: 'Account' },
  { id: 'unit', label: 'Unit', className: 'max-md:hidden' },
  { id: 'role', label: 'Role' },
  { id: 'shift', label: 'Shift', className: 'max-sm:hidden' },
  { id: 'toFill', label: 'To fill', numeric: true },
  { id: 'tentative', label: 'Pencils', numeric: true, className: 'max-lg:hidden' },
  { id: 'committed', label: 'Committed', numeric: true, className: 'max-lg:hidden' },
  { id: 'started', label: 'Started', numeric: true, className: 'max-lg:hidden' },
  { id: 'nextStart', label: 'Next start', className: 'max-md:hidden' },
  { id: 'age', label: 'Age', numeric: true, className: 'max-sm:hidden' },
  { id: 'owner', label: 'Owner', className: 'max-md:hidden' },
];

interface Row {
  order: Order;
  account: string;
  unit: string;
  counts: ReturnType<typeof openingCounts>;
  nextStart: string | null;
  age: number;
  owner: PersonLite | null;
  today: string;
}

export interface OrderListViewProps {
  orders: readonly Order[];
  owners: Map<string, string | null>;
}

/** Dense, sortable table. With no column chosen it keeps the toolbar's sort; rows expand to show lines. */
export function OrderListView({ orders, owners }: OrderListViewProps) {
  const env = useBoardEnv();
  const [sort, setSort] = useState<{ col: ListColumn; dir: 'asc' | 'desc' } | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo<Row[]>(
    () =>
      orders.map((order) => {
        const account = env.accountsById.get(order.accountId);
        const branch = env.branchesById.get(order.branchId);
        const today = todayFor(env.today, order.branchId, branch?.timeZone);
        const ownerId = owners.get(order.id) ?? null;
        return {
          order,
          account: account?.name ?? 'Unknown account',
          unit: [unitText(account, order.unitId), order.site].filter(Boolean).join(' · '),
          counts: openingCounts(order),
          nextStart: nextStartDate(order, today),
          age: orderAgeOn(order, branch?.timeZone ?? DEFAULT_TIME_ZONE, today),
          owner: ownerId ? (env.peopleById.get(ownerId) ?? null) : null,
          today,
        };
      }),
    [orders, owners, env],
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    if (sort.col === 'nextStart') {
      // Reuse the shared "next start" ordering (orders without an upcoming start last).
      const order = sortOrders(rows.map((r) => r.order), 'start', { today: env.today, accountsById: env.accountsById });
      const byId = new Map(rows.map((r) => [r.order.id, r] as const));
      const list = order.map((o) => byId.get(o.id)!);
      return dir === 1 ? list : list.reverse();
    }
    const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
    const key: Record<Exclude<ListColumn, 'nextStart'>, (a: Row, b: Row) => number> = {
      account: (a, b) => text(a.account, b.account),
      unit: (a, b) => text(a.unit, b.unit),
      role: (a, b) => text(a.order.role, b.order.role),
      shift: (a, b) => text(a.order.shift, b.order.shift),
      toFill: (a, b) => a.counts.toFill - b.counts.toFill,
      tentative: (a, b) => a.counts.tentative - b.counts.tentative,
      committed: (a, b) => a.counts.committed - b.counts.committed,
      started: (a, b) => a.counts.started - b.counts.started,
      age: (a, b) => a.age - b.age,
      owner: (a, b) => text(a.owner?.name ?? '￿', b.owner?.name ?? '￿'),
    };
    const cmp = key[sort.col];
    return [...rows].sort((a, b) => cmp(a, b) * dir || text(a.account, b.account));
  }, [rows, sort, env.today, env.accountsById]);

  const onSort = (col: ListColumn, numeric: boolean) =>
    setSort((s) => {
      if (!s || s.col !== col) return { col, dir: numeric ? 'desc' : 'asc' };
      if (s.dir === (numeric ? 'desc' : 'asc')) return { col, dir: numeric ? 'asc' : 'desc' };
      return null; // third click returns to the toolbar sort
    });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="relative overflow-x-auto rounded-lg border border-line bg-paper shadow-card">
      <table className="w-full border-collapse text-sm text-ink">
        <caption className="sr-only">Open orders. Select a column heading to sort; expand a row to see its lines.</caption>
        <thead>
          <tr className="border-b border-rule text-left">
            <th scope="col" className="w-9 px-1">
              <span className="sr-only">Expand</span>
            </th>
            {COLUMNS.map((c) => {
              const active = sort?.col === c.id;
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={cx('whitespace-nowrap px-2 py-1.5 font-semibold text-muted', c.numeric && 'text-right', c.className)}
                >
                  <button type="button" onClick={() => onSort(c.id, Boolean(c.numeric))} className={cx('inline-flex items-center gap-1 rounded-sm hover:text-fg', active && 'text-fg')}>
                    {c.label}
                    {active ? sort!.dir === 'asc' ? <ArrowUp aria-hidden="true" className="size-3.5" /> : <ArrowDown aria-hidden="true" className="size-3.5" /> : null}
                  </button>
                </th>
              );
            })}
            <th scope="col" className="w-10 px-1">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <ListRow key={row.order.id} row={row} expanded={expanded.has(row.order.id)} onToggle={toggle} canManage={env.canManage(row.order.branchId)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ListRow = memo(function ListRow({ row, expanded, onToggle, canManage }: { row: Row; expanded: boolean; onToggle: (id: string) => void; canManage: boolean }) {
  const { order, counts } = row;
  const aging = !counts.covered && row.age >= LIMITS.agingOrderDays;
  const detailsId = `lines-${order.id}`;
  const editable = order.status === 'active' || order.status === 'paused';
  return (
    <Fragment>
      <tr className={cx('border-b border-rule/70 align-middle hover:bg-surface-2/50', expanded && 'bg-surface-2/40')}>
        <td className="px-1 py-1">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={expanded ? detailsId : undefined}
            aria-label={`${expanded ? 'Hide' : 'Show'} lines for ${row.account} ${order.role}`}
            onClick={() => onToggle(order.id)}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ChevronRight aria-hidden="true" className={cx('size-4 transition-transform', expanded && 'rotate-90')} />
          </button>
        </td>
        <td className="max-w-[14rem] px-2 py-1.5">
          <span className="flex items-center gap-1.5">
            {order.isPriority ? (
              <>
                <Star aria-hidden="true" className="size-3.5 shrink-0 fill-current text-warning" />
                <span className="sr-only">Priority, </span>
              </>
            ) : null}
            <span className="truncate font-semibold">{row.account}</span>
            {order.status === 'paused' ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-warning">
                <CirclePause aria-hidden="true" className="size-3.5" />
                Paused
              </span>
            ) : null}
          </span>
        </td>
        <td className="max-w-[12rem] truncate px-2 py-1.5 text-muted max-md:hidden">{row.unit}</td>
        <td className="max-w-[14rem] truncate px-2 py-1.5">{order.role}</td>
        <td className="whitespace-nowrap px-2 py-1.5 max-sm:hidden">{order.shift}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {counts.covered ? <span className="font-semibold text-success">Covered</span> : <span className={cx('font-bold', counts.toFill >= 3 && 'text-danger')}>{counts.toFill}</span>}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-muted max-lg:hidden">{counts.tentative}</td>
        <td className="px-2 py-1.5 text-right tabular-nums max-lg:hidden">{counts.committed}</td>
        <td className="px-2 py-1.5 text-right tabular-nums max-lg:hidden">{counts.started}</td>
        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums max-md:hidden">{row.nextStart ? shortDay(row.nextStart) : <span className="text-subtle">—</span>}</td>
        <td className={cx('whitespace-nowrap px-2 py-1.5 text-right tabular-nums max-sm:hidden', aging ? 'font-semibold text-warning' : 'text-muted')}>{row.age}d</td>
        <td className="whitespace-nowrap px-2 py-1.5 max-md:hidden">
          {row.owner ? (
            <span className="inline-flex items-center gap-1.5">
              <MarkerDot marker={row.owner.marker} label={null} size="sm" />
              <span className="font-semibold">{row.owner.initials}</span>
              <span className="sr-only">{row.owner.name}</span>
            </span>
          ) : (
            <span className="text-subtle">Unowned</span>
          )}
        </td>
        <td className="px-1 py-1">
          <OrderMenu order={order} title={`${row.account} ${order.role}`} canManage={canManage} />
        </td>
      </tr>
      {expanded ? (
        <tr id={detailsId} className="border-b border-rule bg-surface-2/30">
          <td />
          <td colSpan={COLUMNS.length + 1} className="px-2 pb-2 pt-1">
            <ul aria-label={`Lines for ${row.account} ${order.role}`} className="grid max-w-3xl grid-cols-[repeat(auto-fill,minmax(5.75rem,1fr))] gap-x-3 gap-y-1">
              {order.openings.map((line, i) => (
                <OrderLine key={line.id} order={order} line={line} index={i} today={row.today} editable={editable} />
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
});
