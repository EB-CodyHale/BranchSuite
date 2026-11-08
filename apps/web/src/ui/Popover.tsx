import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.js';
import { portalContainer, useAnchorPosition, type Placement } from './useAnchorPosition.js';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  placement?: Placement;
  className?: string;
  id?: string;
  role?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Focus moves into the popover on open (first focusable element). Default true. */
  autoFocus?: boolean;
  floatingRef?: RefObject<HTMLDivElement | null>;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Anchored floating panel. Closes on Escape (returning focus to the anchor) and on a pointer press
 * outside both the panel and the anchor.
 */
export function Popover({ open, onClose, anchorRef, children, placement = 'bottom-start', className, autoFocus = true, floatingRef, ...aria }: PopoverProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = floatingRef ?? ownRef;
  const pos = useAnchorPosition(anchorRef, ref, open, placement);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCloseRef.current();
      anchorRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, anchorRef, ref]);

  useEffect(() => {
    if (open && autoFocus) ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open, autoFocus, ref]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      {...aria}
      style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0, pointerEvents: pos ? undefined : 'none' }}
      className={cx('z-50 min-w-40 max-w-[calc(100vw_-_16px)] rounded-lg border border-line bg-surface p-1 text-fg shadow-pop', className)}
    >
      {children}
    </div>,
    portalContainer(anchorRef.current),
  );
}
