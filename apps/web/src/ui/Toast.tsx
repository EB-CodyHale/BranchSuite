import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx.js';

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Optional single action, e.g. Undo. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before auto-dismiss; errors stay until dismissed when 0. */
  durationMs?: number;
}

interface ToastItem extends Required<Pick<ToastInput, 'title' | 'tone' | 'durationMs'>> {
  id: number;
  description?: string;
  action?: ToastInput['action'];
}

interface ToastApi {
  toast: (input: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>.');
  return ctx;
}

const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    const tone = input.tone ?? 'info';
    const item: ToastItem = {
      id,
      title: input.title,
      description: input.description,
      action: input.action,
      tone,
      durationMs: input.durationMs ?? (tone === 'danger' ? 8000 : 5000),
    };
    setItems((list) => [...list, item].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 p-4 sm:items-end">
        <div role="status" aria-live="polite" className="contents">
          {items.filter((t) => t.tone !== 'danger').map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" className="contents">
          {items.filter((t) => t.tone === 'danger').map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

const ICONS = { info: Info, success: CircleCheck, danger: CircleAlert } as const;
const TONE_CLASS = { info: 'text-accent', success: 'text-success', danger: 'text-danger' } as const;

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || item.durationMs === 0) return;
    const t = setTimeout(() => onDismiss(item.id), item.durationMs);
    return () => clearTimeout(t);
  }, [paused, item.id, item.durationMs, onDismiss]);
  const Icon = ICONS[item.tone];
  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 text-fg shadow-pop"
    >
      <Icon aria-hidden="true" className={cx('mt-0.5 size-5 shrink-0', TONE_CLASS[item.tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{item.title}</p>
        {item.description ? <p className="mt-0.5 text-sm text-muted">{item.description}</p> : null}
        {item.action ? (
          <button
            type="button"
            className="mt-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline"
            onClick={() => {
              item.action!.onClick();
              onDismiss(item.id);
            }}
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button type="button" aria-label="Dismiss notification" onClick={() => onDismiss(item.id)} className="-m-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg">
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
