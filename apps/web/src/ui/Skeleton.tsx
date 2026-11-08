import { cx } from './cx.js';

/** Decorative loading placeholder; pair with a status message for assistive tech. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx('block animate-pulse-soft rounded-md bg-surface-2', className)} />;
}
