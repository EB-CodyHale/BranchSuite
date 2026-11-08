import { cx } from '../ui/cx.js';

/** BranchSuite mark: three marker lines on a board tile. The word mark hides on very narrow screens. */
export function ProductMark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden="true" focusable="false">
        <rect width="32" height="32" rx="7" fill="var(--text)" />
        <path d="M8 11h16M8 16h11M8 21h13" stroke="var(--bg)" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="24" cy="21" r="3" fill="#3d8bd9" />
      </svg>
      <span className={cx('font-display text-xl font-bold tracking-tight text-fg', compact && 'max-sm:sr-only')}>BranchSuite</span>
    </span>
  );
}
