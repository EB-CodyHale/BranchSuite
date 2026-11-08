import { cx } from './cx.js';

/** Keyboard shortcut hint, e.g. <KeyboardShortcut keys={['Shift', 'N']} />. */
export function KeyboardShortcut({ keys, className }: { keys: readonly string[]; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-0.5', className)} aria-label={`Shortcut: ${keys.join(' plus ')}`}>
      {keys.map((k) => (
        <kbd
          key={k}
          aria-hidden="true"
          className="min-w-5 rounded-sm border border-line border-b-2 bg-surface px-1 text-center font-mono text-[0.6875rem] leading-4 text-muted"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
