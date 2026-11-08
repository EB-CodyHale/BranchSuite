import { ChevronDown, LayoutGrid, Target } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../ui/cx.js';
import { WallGlyph } from '../../ui/WallGlyph.js';
import type { AccountNeed } from './pipelineModel.js';

export interface OpeningsPanelProps {
  needs: AccountNeed[];
  open: boolean;
  onToggle: () => void;
  /** Account currently filtering the pipeline ('all' when none). */
  activeAccount: string;
  onPick: (accountId: string) => void;
}

/** "Openings at a glance": where the branch still needs people vs. who is already in process. */
export function OpeningsPanel({ needs, open, onToggle, activeAccount, onPick }: OpeningsPanelProps) {
  const bodyId = useId();
  const totalToFill = needs.reduce((n, a) => n + a.toFill, 0);
  return (
    <aside aria-label="Openings at a glance" className="rounded-lg border border-line bg-surface shadow-card">
      <h2 className="font-display text-base font-bold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2"
        >
          <Target aria-hidden="true" className="size-4 text-accent" />
          <span className="flex-1 uppercase tracking-wide">Openings at a glance</span>
          <span className="font-display text-sm font-bold tabular-nums text-muted">{totalToFill} to fill</span>
          <ChevronDown aria-hidden="true" className={cx('size-4 text-muted transition-transform', open && 'rotate-180')} />
        </button>
      </h2>
      {open ? (
        <div id={bodyId} className="border-t border-line px-2 pb-2 pt-1.5">
          {needs.length === 0 ? (
            <p className="px-1.5 py-3 text-sm text-muted">Every order on the board is covered.</p>
          ) : (
            <>
              <div aria-hidden="true" className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-1.5 pb-1 font-display text-[0.7rem] font-bold uppercase tracking-wider text-subtle">
                <span>Account</span>
                <span className="w-10 text-right">To fill</span>
                <span className="w-14 text-right">In process</span>
              </div>
              <ul className="flex flex-col">
                {needs.map((n) => {
                  const gap = n.toFill - n.inProcess;
                  const active = activeAccount === n.account.id;
                  return (
                    <li key={n.account.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => onPick(active ? 'all' : n.account.id)}
                        aria-label={`${n.account.name}: ${n.toFill} to fill, ${n.inProcess} in process${gap > 0 ? `, source ${gap} more` : ''}. ${active ? 'Clear filter' : 'Show these candidates'}`}
                        className={cx(
                          'grid min-w-0 flex-1 grid-cols-[1fr_auto_auto] items-center gap-x-3 rounded-md px-1.5 py-1.5 text-left text-sm',
                          active ? 'bg-accent-soft font-semibold text-accent' : 'hover:bg-surface-2',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <WallGlyph glyph={n.account.wall.glyph} color={n.account.wall.color} size={14} label={null} />
                          <span className="truncate">{n.account.name}</span>
                        </span>
                        <span className="w-10 text-right font-display text-base font-bold tabular-nums">{n.toFill}</span>
                        <span className={cx('w-14 text-right font-display text-base font-bold tabular-nums', gap > 0 ? 'text-warning' : 'text-success')}>
                          {n.inProcess}
                          <span aria-hidden="true" className="ml-0.5 text-xs font-semibold">
                            {gap > 0 ? `−${gap}` : '✓'}
                          </span>
                        </span>
                      </button>
                      <Link
                        to={`/?account=${encodeURIComponent(n.account.id)}`}
                        aria-label={`Open ${n.account.name} orders on the board`}
                        title="Open on the board"
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
                      >
                        <LayoutGrid aria-hidden="true" className="size-4" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="px-1.5 pt-2 text-xs text-subtle">
                <span className="font-semibold text-warning">−n</span> means n more candidates are needed. Select an account to filter the pipeline, or use the board icon to see its orders.
              </p>
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
}
