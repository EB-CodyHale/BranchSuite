import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx.js';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'children'> {
  /** Required accessible name; icon-only controls are otherwise silent to screen readers. */
  label: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'secondary';
}

const SIZES = { sm: 'size-8', md: 'size-9', lg: 'size-11' } as const;

export function IconButton({ label, children, size = 'md', variant = 'ghost', className, type = 'button', title, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-55',
        variant === 'ghost' ? 'hover:bg-surface-2' : 'border border-line-strong bg-surface hover:bg-surface-2',
        SIZES[size],
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex [&>svg]:size-[1.15em] text-[1.05rem]">
        {children}
      </span>
    </button>
  );
}
