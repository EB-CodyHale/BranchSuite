import { MARKERS, type MarkerId } from '@branchsuite/shared';
import { Check } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { markerInkVar, markerWashVar } from '../../app/theme.js';
import { cx } from '../../ui/cx.js';

export interface MarkerPickerProps {
  value: MarkerId;
  onChange: (marker: MarkerId) => void;
  /** Initials of people in the branch already using each marker (shown as a hint, not blocked). */
  usage?: Partial<Record<MarkerId, string[]>>;
  label?: string;
}

const COLUMNS = 5;

/**
 * Grid of marker swatches with radiogroup semantics. Every swatch carries its color name as
 * visible text and accessible name; arrow keys move in two dimensions and select.
 */
export function MarkerPicker({ value, onChange, usage = {}, label = 'Marker color' }: MarkerPickerProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, MARKERS.findIndex((m) => m.id === value));

  const onKeyDown = (e: KeyboardEvent) => {
    const n = MARKERS.length;
    const delta: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS };
    let next: number | null = null;
    if (e.key in delta) next = (current + delta[e.key]! + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(MARKERS[next]!.id);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1.5 min-[400px]:grid-cols-5" onKeyDown={onKeyDown}>
      {MARKERS.map((m, i) => {
        const checked = m.id === value;
        const users = usage[m.id] ?? [];
        return (
          <button
            key={m.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${m.label} marker${users.length ? `, also used by ${users.join(', ')}` : ''}`}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(m.id)}
            className={cx(
              'flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm font-semibold transition-colors',
              checked ? 'border-2 shadow-card' : 'border-line hover:border-line-strong',
            )}
            style={checked ? { borderColor: `var(${markerInkVar(m.id)})`, backgroundColor: `var(${markerWashVar(m.id)})` } : undefined}
          >
            <span aria-hidden="true" className="relative inline-flex size-5 shrink-0 items-center justify-center rounded-full ring-1 ring-black/10" style={{ backgroundColor: `var(${markerInkVar(m.id)})` }}>
              {checked ? <Check className="size-3.5" strokeWidth={3} style={{ color: `var(${markerWashVar(m.id)})` }} /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate" style={{ color: checked ? `var(${markerInkVar(m.id)})` : undefined }}>
              {m.label}
            </span>
            {users.length ? (
              <span aria-hidden="true" className="shrink-0 text-[0.6875rem] font-bold tabular-nums text-subtle" title={`Used by ${users.join(', ')}`}>
                {users.length}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
