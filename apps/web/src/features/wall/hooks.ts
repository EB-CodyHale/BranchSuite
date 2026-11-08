/** Small DOM hooks used by the wall board, display page and preview. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

/**
 * Layout size (clientWidth / clientHeight, unaffected by CSS transforms) of the element passed to the
 * returned callback ref. Uses ResizeObserver, with a window resize listener where it is missing.
 */
export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, Size] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const read = () =>
      setSize((prev) => {
        const width = el.clientWidth;
        const height = el.clientHeight;
        return prev.width === width && prev.height === height ? prev : { width, height };
      });
    read();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(read);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [el]);
  return [setEl, size];
}

function query(q: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q) : null;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => query('(prefers-reduced-motion: reduce)')?.matches ?? false);
  useEffect(() => {
    const mq = query('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** Bumps a counter once web fonts finish loading, so measurements taken with fallback fonts are redone. */
export function useFontsReady(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts?.ready) return;
    let live = true;
    void fonts.ready.then(() => {
      if (live) setTick((t) => t + 1);
    });
    return () => {
      live = false;
    };
  }, []);
  return tick;
}

/**
 * True while the pointer or keyboard was used within `idleMs`. The wall hides the cursor and the
 * fullscreen button when this turns false.
 */
export function useRecentActivity(idleMs = 3000): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poke = () => {
      setActive(true);
      clearTimeout(timer);
      timer = setTimeout(() => setActive(false), idleMs);
    };
    const events = ['mousemove', 'pointerdown', 'keydown', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, poke, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, poke);
    };
  }, [idleMs]);
  return active;
}

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

/** Keep the screen on (Screen Wake Lock API) and re-acquire after the tab becomes visible again. */
export function useScreenWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;
    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const next = await wakeLock.request('screen');
        if (disposed) void next.release().catch(() => undefined);
        else sentinel = next;
      } catch {
        // Denied (battery saver, unsupported context). The TV's own sleep settings then apply.
      }
    };
    const onVisibility = () => void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    void acquire();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);
}

/** Fullscreen state of the document plus a toggle that targets `ref` (or the document element). */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement));
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const enter = useCallback(async () => {
    const target = ref.current ?? document.documentElement;
    try {
      await target.requestFullscreen?.();
    } catch {
      // Fullscreen needs a user gesture or is blocked by the browser; the page still works windowed.
    }
  }, []);
  const exit = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
    } catch {
      // Already left fullscreen.
    }
  }, []);
  const toggle = useCallback(() => (document.fullscreenElement ? exit() : enter()), [enter, exit]);
  return { ref, isFullscreen, enter, exit, toggle, supported: typeof document !== 'undefined' && Boolean(document.fullscreenEnabled) };
}
