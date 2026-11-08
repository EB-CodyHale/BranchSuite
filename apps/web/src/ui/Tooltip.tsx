import { cloneElement, useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { portalContainer, useAnchorPosition } from './useAnchorPosition.js';

type TriggerProps = {
  'aria-describedby'?: string;
  onMouseEnter?: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
};

export interface TooltipProps {
  content: string;
  /** A single focusable element. Its existing handlers are preserved. */
  children: ReactElement<TriggerProps>;
  delayMs?: number;
}

/**
 * Supplementary hint on hover and keyboard focus (WCAG 1.4.13: dismissible with Escape, stays while
 * hovered). Never put essential information only in a tooltip.
 */
export function Tooltip({ content, children, delayMs = 400 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pos = useAnchorPosition(wrapperRef, tipRef, open, 'top');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  const p = children.props;
  const trigger = cloneElement(children, {
    'aria-describedby': [p['aria-describedby'], open ? id : null].filter(Boolean).join(' ') || undefined,
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      p.onMouseEnter?.(e);
      show(delayMs);
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      p.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      p.onFocus?.(e);
      show(0);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      p.onBlur?.(e);
      hide();
    },
  });

  return (
    <span ref={wrapperRef} className="inline-flex">
      {trigger}
      {open
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              onMouseEnter={() => clearTimeout(timer.current)}
              onMouseLeave={hide}
              style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}
              className="z-[60] max-w-64 rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-pop"
            >
              {content}
            </div>,
            portalContainer(wrapperRef.current),
          )
        : null}
    </span>
  );
}
