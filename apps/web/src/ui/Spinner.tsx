import { cx } from './cx.js';

export interface SpinnerProps {
  /** Announced to screen readers. Pass null when a parent already announces the busy state. */
  label?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'size-3.5 border-2', md: 'size-5 border-2', lg: 'size-8 border-[3px]' } as const;

export function Spinner({ label = 'Loading', size = 'md', className }: SpinnerProps) {
  const ring = <span aria-hidden="true" className={cx('inline-block animate-spin-slow rounded-full border-current border-r-transparent', SIZES[size])} />;
  if (label === null) return <span className={cx('inline-flex', className)}>{ring}</span>;
  return (
    <span role="status" className={cx('inline-flex items-center', className)}>
      {ring}
      <span className="sr-only">{label}</span>
    </span>
  );
}
