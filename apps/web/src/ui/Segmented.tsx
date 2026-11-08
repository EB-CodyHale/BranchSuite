import { useRef, type ReactNode } from 'react';
import { cx } from './cx.js';
import { rovingIndex } from './rovingFocus.js';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedProps<T extends string> {
  label: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}

/** Single-choice segmented control (radiogroup semantics, arrow keys move and select). */
export function Segmented<T extends string>({ label, options, value, onChange, size = 'md', className }: SegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-md border border-line bg-surface-2 p-0.5', className)}>
      {options.map((opt, index) => {
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              const next = rovingIndex(e, current, options.length);
              if (next === null) return;
              e.preventDefault();
              onChange(options[next]!.value);
              refs.current[next]?.focus();
            }}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-[5px] font-semibold transition-colors',
              size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
              checked ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg',
            )}
          >
            {opt.icon ? <span aria-hidden="true" className="inline-flex [&>svg]:size-4">{opt.icon}</span> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
