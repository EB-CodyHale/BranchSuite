import { useLayoutEffect, useState, type RefObject } from 'react';

export type Placement = 'bottom-start' | 'bottom-end' | 'top' | 'bottom';

const GAP = 6;
const MARGIN = 8;

export interface AnchorPosition {
  top: number;
  left: number;
  /** Actual side used after flipping for space. */
  side: 'top' | 'bottom';
}

/**
 * Fixed-position coordinates for a floating element next to its anchor. Flips above/below to fit,
 * clamps into the viewport, and follows scroll and resize while open.
 */
export function useAnchorPosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  open: boolean,
  placement: Placement,
): AnchorPosition | null {
  const [pos, setPos] = useState<AnchorPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (!anchor || !floating) return;
      const a = anchor.getBoundingClientRect();
      const f = floating.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const wantTop = placement === 'top';
      const fitsBelow = a.bottom + GAP + f.height <= vh - MARGIN;
      const fitsAbove = a.top - GAP - f.height >= MARGIN;
      const side: 'top' | 'bottom' = wantTop ? (fitsAbove || !fitsBelow ? 'top' : 'bottom') : fitsBelow || !fitsAbove ? 'bottom' : 'top';
      let left: number;
      if (placement === 'bottom-end') left = a.right - f.width;
      else if (placement === 'top' || placement === 'bottom') left = a.left + a.width / 2 - f.width / 2;
      else left = a.left;
      left = Math.max(MARGIN, Math.min(left, vw - f.width - MARGIN));
      const top = side === 'bottom' ? a.bottom + GAP : a.top - GAP - f.height;
      setPos({ top: Math.max(MARGIN, top), left, side });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, placement, anchorRef, floatingRef]);

  return pos;
}

/**
 * Where floating UI must render. A modal <dialog> lives in the browser top layer, so a popover
 * opened from inside one has to render inside that dialog to appear above it.
 */
export function portalContainer(anchor: HTMLElement | null): HTMLElement {
  return anchor?.closest('dialog') ?? document.body;
}
