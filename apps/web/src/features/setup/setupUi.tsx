/** Small building blocks shared by the setup sections. Theme tokens only. */
import { Check, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ApiError, errorMessage } from '../../lib/api.js';
import { cx } from '../../ui/cx.js';
import { useSetupBranch } from './SetupBranchContext.js';

// ---------- layout ----------

export function SectionHeader({ title, description, actions, branchScoped = false }: { title: string; description?: ReactNode; actions?: ReactNode; branchScoped?: boolean }) {
  const { branch } = useSetupBranch();
  return (
    <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-2xl font-bold leading-tight tracking-tight">{title}</h2>
        {description ? <p className="mt-0.5 max-w-prose text-sm text-muted">{description}</p> : null}
        {branchScoped && branch ? (
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-subtle">
            {branch.name} <span className="font-mono normal-case tracking-normal">· {branch.code}</span>
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, description, children, className, actions }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface shadow-card', className)}>
      {title ? (
        <header className="flex flex-wrap items-start gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-lg font-semibold leading-tight">{title}</h3>
            {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

const NOTICE_TONES = {
  info: { cls: 'border-line bg-surface-2 text-fg', icon: Info, iconCls: 'text-accent' },
  warning: { cls: 'border-warning/40 bg-warning-soft text-fg', icon: TriangleAlert, iconCls: 'text-warning' },
  danger: { cls: 'border-danger/50 bg-danger-soft text-fg', icon: CircleAlert, iconCls: 'text-danger' },
} as const;

/** Callout with an icon and a title, so the tone never relies on color alone. */
export function Notice({ tone = 'info', title, children, className, role }: { tone?: keyof typeof NOTICE_TONES; title?: ReactNode; children?: ReactNode; className?: string; role?: 'alert' | 'status' | 'note' }) {
  const t = NOTICE_TONES[tone];
  return (
    <div role={role} className={cx('flex gap-2.5 rounded-md border px-3 py-2.5 text-sm', t.cls, className)}>
      <t.icon aria-hidden="true" className={cx('mt-0.5 size-4 shrink-0', t.iconCls)} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cx(title ? 'mt-0.5' : '', 'text-muted [&_strong]:text-fg')}>{children}</div> : null}
      </div>
    </div>
  );
}

/** Detail lines the API attaches to a 400 (unit tree errors, import rows). */
export function errorDetails(e: unknown): string[] {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return [];
  return e.details.flatMap((d: unknown) => {
    if (typeof d === 'string') return [d];
    if (typeof d === 'object' && d !== null && 'message' in d) {
      const row = d as { name?: unknown; message?: unknown };
      return [typeof row.name === 'string' ? `${row.name}: ${String(row.message)}` : String(row.message)];
    }
    return [];
  });
}

/** Inline API error: message plus any detail lines. Renders nothing without an error. */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const details = errorDetails(error);
  return (
    <Notice tone="danger" role="alert" title={errorMessage(error)} className={className}>
      {details.length > 0 ? (
        <ul className="list-disc pl-4">
          {details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
    </Notice>
  );
}

// ---------- controls ----------

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** On/off switch (role="switch") with a visible On/Off word next to the track. */
export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const id = useId();
  return (
    <div className={cx('flex items-start gap-3', className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-55',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-2',
        )}
      >
        <span
          aria-hidden="true"
          className={cx('inline-block size-4 rounded-full shadow-card transition-transform', checked ? 'translate-x-[1.375rem] bg-accent-fg' : 'translate-x-1 bg-surface')}
        />
      </button>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="flex items-baseline gap-2 text-sm font-semibold">
          {label}
          <span aria-hidden="true" className={cx('text-xs font-bold uppercase tracking-wider', checked ? 'text-accent' : 'text-subtle')}>
            {checked ? 'On' : 'Off'}
          </span>
        </label>
        {description ? (
          <p id={`${id}-d`} className="mt-0.5 text-xs text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface ChipInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** Returns an error message for an invalid entry, or null. */
  validate?: (value: string, values: string[]) => string | null;
  /** Normalizes an entry before validation (e.g. lowercase domains). */
  normalize?: (value: string) => string;
  placeholder?: string;
  hint?: ReactNode;
  disabled?: boolean;
  max?: number;
  className?: string;
}

/**
 * Tag list editor: Enter or comma adds, Backspace on an empty field removes the last chip,
 * each chip has a labelled remove button. Duplicates are rejected.
 */
export function ChipInput({ label, values, onChange, validate, normalize = (v) => v.trim(), placeholder, hint, disabled, max, className }: ChipInputProps) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const full = max !== undefined && values.length >= max;

  const add = (): boolean => {
    const value = normalize(text);
    if (!value) return false;
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      setError(`"${value}" is already in the list.`);
      return false;
    }
    if (full) {
      setError(`The list holds at most ${max} entries.`);
      return false;
    }
    const problem = validate?.(value, values) ?? null;
    if (problem) {
      setError(problem);
      return false;
    }
    onChange([...values, value]);
    setText('');
    setError(null);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && text === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const describedBy = [error ? `${id}-e` : null, hint ? `${id}-h` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div
        className={cx(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-surface px-1.5 py-1 focus-within:outline-2 focus-within:outline-focus',
          error ? 'border-danger' : 'border-line-strong',
          disabled && 'opacity-60',
        )}
      >
        <ul aria-label={`${label}: ${values.length} ${values.length === 1 ? 'entry' : 'entries'}`} className="contents">
          {values.map((v) => (
            <li key={v} className="inline-flex max-w-full items-center gap-0.5 rounded-sm border border-line bg-surface-2 py-0.5 pl-2 pr-0.5 text-sm font-medium">
              <span className="truncate">{v}</span>
              {disabled ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${v}`}
                  onClick={() => onChange(values.filter((x) => x !== v))}
                  className="inline-flex size-5 items-center justify-center rounded-sm text-muted hover:bg-surface hover:text-fg"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {disabled ? null : (
          <input
            id={id}
            value={text}
            disabled={full}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              if (text.trim()) add();
            }}
            placeholder={full ? 'List is full' : (placeholder ?? 'Type and press Enter')}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-[0.9375rem] outline-none placeholder:text-subtle"
          />
        )}
      </div>
      {error ? (
        <p id={`${id}-e`} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={`${id}-h`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Checkbox list for picking several branches. Locked ids stay checked and cannot be changed. */
export function BranchChecklist({
  legend,
  options,
  value,
  onChange,
  locked = [],
  error,
  hint,
}: {
  legend: string;
  options: ReadonlyArray<{ id: string; name: string; code?: string }>;
  value: string[];
  onChange: (ids: string[]) => void;
  locked?: string[];
  error?: string | null;
  hint?: ReactNode;
}) {
  const errId = useId();
  return (
    <fieldset aria-describedby={error ? errId : undefined} className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {options.map((o) => {
          const isLocked = locked.includes(o.id);
          const checked = value.includes(o.id);
          return (
            <label key={o.id} className={cx('flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm', checked ? 'border-accent bg-accent-soft' : 'border-line bg-surface', isLocked && 'opacity-70')}>
              <input
                type="checkbox"
                checked={checked}
                disabled={isLocked}
                onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((id) => id !== o.id))}
                className="size-4 accent-accent"
              />
              <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
              {o.code ? <span className="font-mono text-xs text-subtle">{o.code}</span> : null}
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={errId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </fieldset>
  );
}

/** "Read only" ribbon for people who can see but not change a section. */
export function ReadOnlyNote({ children }: { children: ReactNode }) {
  return (
    <Notice tone="info" title="View only" className="mb-4">
      {children}
    </Notice>
  );
}

export interface RadioGridOption<T extends string> {
  value: T;
  /** Accessible name (also the visible text unless `content` is given). */
  label: string;
  content?: ReactNode;
}

/**
 * Grid of radio cards (radiogroup semantics, roving tabindex, arrow keys move and select).
 * The checked card gets a thicker accent border and a check mark, not only a color change.
 */
export function RadioGrid<T extends string>({ label, options, value, onChange, className, disabled }: { label: string; options: ReadonlyArray<RadioGridOption<T>>; value: T; onChange: (v: T) => void; className?: string; disabled?: boolean }) {
  const current = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (e: KeyboardEvent<HTMLButtonElement>) => {
    const n = options.length;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(options[next]!.value);
    const group = e.currentTarget.parentElement;
    group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={cx('grid gap-1.5', className)}>
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.label}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={move}
            className={cx(
              'relative flex min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55',
              checked ? 'border-2 border-accent bg-accent-soft text-fg' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
            )}
          >
            {o.content ?? o.label}
            {checked ? <Check aria-hidden="true" className="absolute right-1 top-1 size-3 text-accent" strokeWidth={3} /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Local id for records created in the browser before the first save (the API keeps given ids). */
export function newLocalId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 18);
  return `${prefix}_${rand}`;
}
