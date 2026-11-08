import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx.js';
import { Spinner } from './Spinner.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-card',
  secondary: 'bg-surface text-fg border border-line-strong hover:bg-surface-2',
  ghost: 'text-fg hover:bg-surface-2',
  danger: 'bg-danger text-danger-fg hover:bg-danger-hover shadow-card',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-sm gap-1.5',
  md: 'h-9 px-3.5 text-[0.9375rem] gap-2',
  lg: 'h-11 px-5 text-base gap-2',
};

export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
  return cx(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-semibold transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks clicks while true. */
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', loading = false, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClasses(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner size="sm" label={null} /> : icon}
      {children}
    </button>
  );
}
