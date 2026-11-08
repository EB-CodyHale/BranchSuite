import { X } from 'lucide-react';
import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { cx } from './cx.js';
import { IconButton } from './IconButton.js';

type ModalVariant = 'dialog' | 'drawer';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Element to focus on open; defaults to the first focusable element (the browser's choice). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Set false to keep the dialog open on backdrop click (forms with unsaved input). */
  closeOnBackdrop?: boolean;
  className?: string;
}

/**
 * Native <dialog> modal: the browser provides the focus trap, top layer and inert background.
 * Escape closes, focus returns to the element that opened it.
 */
function Modal({ open, onClose, title, description, children, footer, initialFocusRef, closeOnBackdrop = true, className, variant }: ModalProps & { variant: ModalVariant }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof el.showModal === 'function') el.showModal();
    else el.setAttribute('open', '');
    initialFocusRef?.current?.focus();
    return () => {
      if (typeof el.close === 'function' && el.open) el.close();
      else el.removeAttribute('open');
      returnTo?.focus();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (closeOnBackdrop && e.target === e.currentTarget) onCloseRef.current();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClick={onBackdrop}
      className={cx(
        'm-0 max-h-none max-w-none bg-transparent p-0 backdrop:backdrop-blur-[1px]',
        variant === 'dialog'
          ? 'fixed inset-0 m-auto h-fit w-[min(calc(100%_-_2rem),var(--dialog-w,32rem))]'
          : 'fixed inset-y-0 right-0 left-auto h-dvh w-[min(100%,var(--dialog-w,28rem))]',
      )}
    >
      <div
        className={cx(
          'flex flex-col border border-line bg-surface text-fg shadow-pop',
          variant === 'dialog' ? 'max-h-[calc(100dvh_-_2rem)] rounded-xl' : 'h-full border-y-0 border-r-0',
          className,
        )}
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-xl font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-0.5 text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Close" size="sm" onClick={() => onCloseRef.current()} className="-mr-1.5 -mt-0.5">
            <X />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer> : null}
      </div>
    </dialog>
  );
}

export type DialogProps = ModalProps;
export function Dialog(props: DialogProps) {
  return <Modal {...props} variant="dialog" />;
}

export type DrawerProps = ModalProps;
/** Side panel (right edge), full height; full width on phones. */
export function Drawer(props: DrawerProps) {
  return <Modal {...props} variant="drawer" />;
}
