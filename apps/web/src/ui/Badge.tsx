import type { ReactNode } from 'react';
import { cx } from './cx.js';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Small status label. Always carries text, so meaning never depends on color alone. */
export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold tabular-nums leading-none', TONES[tone], className)}>
      {icon ? <span aria-hidden="true" className="inline-flex [&>svg]:size-3">{icon}</span> : null}
      {children}
    </span>
  );
}
