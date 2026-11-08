import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Check } from 'lucide-react';
import { cx } from './cx.js';
import { Popover } from './Popover.js';
import type { Placement } from './useAnchorPosition.js';

interface MenuCtx {
  close: () => void;
}
const MenuContext = createContext<MenuCtx | null>(null);

function useMenu(): MenuCtx {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error('Menu items must be rendered inside <Menu>.');
  return ctx;
}

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
}

export interface MenuProps {
  /** Accessible name of the menu itself. */
  label: string;
  /** Render the trigger button, spreading the given props onto it. */
  trigger: (props: MenuTriggerProps) => ReactNode;
  children: ReactNode;
  placement?: Placement;
  className?: string;
}

const ITEM_SELECTOR = '[role^="menuitem"]:not([aria-disabled="true"])';

/** WAI-ARIA menu button: arrow keys move, Home/End jump, Enter/Space select, Escape/Tab close. */
export function Menu({ label, trigger, children, placement = 'bottom-end', className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
  const focusAt = (index: number) => {
    const list = items();
    if (list.length === 0) return;
    list[(index + list.length) % list.length]!.focus();
  };
  const close = () => {
    setOpen(false);
    anchorRef.current?.focus();
  };

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
  }, [open]);

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(current + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(current - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(list.length - 1);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const triggerProps: MenuTriggerProps = {
    ref: anchorRef,
    onClick: () => setOpen((v) => !v),
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
  };

  return (
    <MenuContext.Provider value={{ close }}>
      {trigger(triggerProps)}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        floatingRef={menuRef}
        placement={placement}
        autoFocus={false}
        id={id}
        role="menu"
        aria-label={label}
        className={className}
      >
        <div onKeyDown={onMenuKeyDown}>{children}</div>
      </Popover>
    </MenuContext.Provider>
  );
}

const itemClass =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-fg outline-none hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] aria-disabled:opacity-55';

export interface MenuItemProps {
  onSelect: () => void;
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

export function MenuItem({ onSelect, children, icon, disabled, tone = 'default' }: MenuItemProps) {
  const { close } = useMenu();
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      className={cx(itemClass, tone === 'danger' && 'text-danger')}
      onClick={() => {
        if (disabled) return;
        close();
        onSelect();
      }}
    >
      {icon ? <span aria-hidden="true" className="inline-flex text-muted [&>svg]:size-4">{icon}</span> : null}
      <span className="flex-1">{children}</span>
    </button>
  );
}

export interface MenuRadioItemProps {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}

export function MenuRadioItem({ checked, onSelect, children }: MenuRadioItemProps) {
  const { close } = useMenu();
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      className={itemClass}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      <span aria-hidden="true" className="inline-flex size-4 text-accent">
        {checked ? <Check className="size-4" /> : null}
      </span>
      <span className="flex-1">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />;
}

/** Non-interactive heading block inside a menu (e.g. the signed-in user's name). */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 py-2 text-sm">{children}</div>;
}
