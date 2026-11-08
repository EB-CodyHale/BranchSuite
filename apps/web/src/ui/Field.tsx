import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from './cx.js';

interface FieldChrome {
  label: ReactNode;
  /** Help text below the control. */
  hint?: ReactNode;
  /** Validation message; marks the control aria-invalid. */
  error?: ReactNode;
  /** Visually hide the label (still announced). */
  hideLabel?: boolean;
  className?: string;
}

const controlBase =
  'w-full rounded-md border bg-surface px-2.5 text-[0.9375rem] text-fg placeholder:text-subtle transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus';

const controlClass = (error: ReactNode) => cx(controlBase, error ? 'border-danger' : 'border-line-strong hover:border-fg/50');

function useFieldIds(id: string | undefined, hint: ReactNode, error: ReactNode) {
  const auto = useId();
  const controlId = id ?? auto;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  return { controlId, hintId, errorId, describedBy: [errorId, hintId].filter(Boolean).join(' ') || undefined };
}

function FieldFrame({ controlId, label, hint, error, hintId, errorId, hideLabel, className, required, children }: FieldChrome & { controlId: string; hintId?: string; errorId?: string; required?: boolean; children: ReactNode }) {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={controlId} className={cx('text-sm font-semibold text-fg', hideLabel && 'sr-only')}>
        {label}
        {required ? <span aria-hidden="true" className="ml-0.5 text-danger">*</span> : null}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export type TextFieldProps = FieldChrome & Omit<ComponentPropsWithRef<'input'>, 'className'> & { inputClassName?: string };

export function TextField({ label, hint, error, hideLabel, className, inputClassName, id, ...input }: TextFieldProps) {
  const ids = useFieldIds(id, hint, error);
  return (
    <FieldFrame {...ids} label={label} hint={hint} error={error} hideLabel={hideLabel} className={className} required={input.required}>
      <input id={ids.controlId} aria-invalid={error ? true : undefined} aria-describedby={ids.describedBy} className={cx(controlClass(error), 'h-9', inputClassName)} {...input} />
    </FieldFrame>
  );
}

export type TextareaProps = FieldChrome & Omit<ComponentPropsWithRef<'textarea'>, 'className'>;

export function Textarea({ label, hint, error, hideLabel, className, id, rows = 3, ...textarea }: TextareaProps) {
  const ids = useFieldIds(id, hint, error);
  return (
    <FieldFrame {...ids} label={label} hint={hint} error={error} hideLabel={hideLabel} className={className} required={textarea.required}>
      <textarea id={ids.controlId} rows={rows} aria-invalid={error ? true : undefined} aria-describedby={ids.describedBy} className={cx(controlClass(error), 'py-2 leading-snug')} {...textarea} />
    </FieldFrame>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectProps = FieldChrome & Omit<ComponentPropsWithRef<'select'>, 'className' | 'children'> & { options: readonly SelectOption[]; selectClassName?: string };

export function Select({ label, hint, error, hideLabel, className, selectClassName, id, options, ...select }: SelectProps) {
  const ids = useFieldIds(id, hint, error);
  return (
    <FieldFrame {...ids} label={label} hint={hint} error={error} hideLabel={hideLabel} className={className} required={select.required}>
      <select id={ids.controlId} aria-invalid={error ? true : undefined} aria-describedby={ids.describedBy} className={cx(controlClass(error), 'h-9 pr-8', selectClassName)} {...select}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

export type CheckboxProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'className'> & {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  className?: string;
};

export function Checkbox({ label, description, error, className, id, ...input }: CheckboxProps) {
  const ids = useFieldIds(id, description, error);
  return (
    <div className={cx('flex items-start gap-2.5', className)}>
      <input
        id={ids.controlId}
        type="checkbox"
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        className="mt-0.5 size-4 shrink-0 rounded-sm border-line-strong accent-accent"
        {...input}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={ids.controlId} className="text-sm font-semibold text-fg">
          {label}
        </label>
        {description ? (
          <p id={ids.hintId} className="text-xs text-muted">
            {description}
          </p>
        ) : null}
        {error ? (
          <p id={ids.errorId} className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
