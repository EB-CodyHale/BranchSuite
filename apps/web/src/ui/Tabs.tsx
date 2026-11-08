import { useRef, type ReactNode } from 'react';
import { cx } from './cx.js';
import { rovingIndex } from './rovingFocus.js';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Optional count shown after the label (tabular figures). */
  count?: number;
}

export interface TabsProps<T extends string> {
  /** Unique prefix tying tabs to their panels (see TabPanel). */
  idBase: string;
  label: string;
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

const tabId = (base: string, id: string) => `${base}-tab-${id}`;
const panelId = (base: string, id: string) => `${base}-panel-${id}`;

/** WAI-ARIA tabs with automatic activation and roving tabindex. */
export function Tabs<T extends string>({ idBase, label, items, value, onChange, className }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, items.findIndex((i) => i.id === value));
  return (
    <div role="tablist" aria-label={label} className={cx('flex gap-1 overflow-x-auto border-b border-line', className)}>
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={tabId(idBase, item.id)}
            aria-selected={selected}
            aria-controls={panelId(idBase, item.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => {
              const next = rovingIndex(e, current, items.length);
              if (next === null) return;
              e.preventDefault();
              onChange(items[next]!.id);
              refs.current[next]?.focus();
            }}
            className={cx(
              '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
              selected ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="rounded-sm bg-surface-2 px-1.5 text-xs tabular-nums text-muted">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  idBase: string;
  id: string;
  /** Currently selected tab id; the panel renders only when it matches. */
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ idBase, id, value, children, className }: TabPanelProps) {
  if (id !== value) return null;
  return (
    <div role="tabpanel" id={panelId(idBase, id)} aria-labelledby={tabId(idBase, id)} tabIndex={0} className={className}>
      {children}
    </div>
  );
}
