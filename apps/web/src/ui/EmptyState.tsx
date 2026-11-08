import type { ReactNode } from 'react';
import { cx } from './cx.js';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cx('mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-10 text-center', className)}>
      {icon ? <div aria-hidden="true" className="mb-1 text-subtle [&>svg]:size-8">{icon}</div> : null}
      <h2 className="font-display text-xl font-semibold text-fg">{title}</h2>
      {description ? <div className="text-sm text-muted">{description}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
