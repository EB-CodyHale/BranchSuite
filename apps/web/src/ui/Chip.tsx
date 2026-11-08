import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx.js';

const base = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium leading-tight';

export interface ChipProps {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Static label chip (filters in effect, tags). */
export function Chip({ children, icon, className }: ChipProps) {
  return (
    <span className={cx(base, 'border-line bg-surface text-fg', className)}>
      {icon ? <span aria-hidden="true" className="inline-flex [&>svg]:size-3.5">{icon}</span> : null}
      {children}
    </span>
  );
}

export interface ToggleChipProps extends Omit<ComponentPropsWithRef<'button'>, 'onChange'> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  count?: number;
  icon?: ReactNode;
}

/** Filter toggle. State is exposed with aria-pressed and a visible check-style fill, not color alone. */
export function ToggleChip({ pressed, onPressedChange, count, icon, children, className, ...rest }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cx(
        base,
        'transition-colors',
        pressed ? 'border-accent bg-accent-soft text-accent font-semibold' : 'border-line bg-surface text-muted hover:text-fg hover:border-line-strong',
        className,
      )}
      {...rest}
    >
      {icon ? <span aria-hidden="true" className="inline-flex [&>svg]:size-3.5">{icon}</span> : null}
      {children}
      {count !== undefined ? <span className="tabular-nums opacity-80">{count}</span> : null}
    </button>
  );
}
