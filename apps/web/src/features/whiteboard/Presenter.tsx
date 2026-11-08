import type { WhiteboardView } from '@branchsuite/shared';
import { ChevronLeft, ChevronRight, Maximize, Minimize, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../ui/IconButton.js';
import { KeyboardShortcut } from '../../ui/Kbd.js';
import { MediaLoaderContext, type MediaLoader } from './media.js';
import { WhiteboardSlide } from './WhiteboardSlide.js';

export interface PresenterProps {
  view: WhiteboardView;
  branchName: string;
  timeZone: string;
  loadMedia: MediaLoader;
  onClose: () => void;
}

/**
 * Full-screen in-app presenter for running the huddle from a laptop or a meeting-room screen.
 * Arrow keys / PageUp / PageDown move between pages, Esc exits, F toggles browser full screen.
 */
export function Presenter({ view, branchName, timeZone, loadMedia, onClose }: PresenterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const countRef = useRef(pageCount);
  countRef.current = pageCount;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    else void ref.current?.requestFullscreen?.().catch(() => undefined);
  };
  const toggleRef = useRef(toggleFullscreen);
  toggleRef.current = toggleFullscreen;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          setPage((p) => Math.min(countRef.current - 1, p + 1));
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          setPage((p) => Math.max(0, p - 1));
          break;
        case 'Home':
          e.preventDefault();
          setPage(0);
          break;
        case 'End':
          e.preventDefault();
          setPage(countRef.current - 1);
          break;
        case 'Escape':
          // The browser leaves full screen on its own; a second Esc closes the presenter.
          if (!document.fullscreenElement) onCloseRef.current();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleRef.current();
          break;
      }
    };
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
      opener?.focus?.();
    };
  }, []);

  const current = Math.min(page, pageCount - 1);

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Whiteboard presenter" className="fixed inset-0 z-50 bg-bg">
      <MediaLoaderContext.Provider value={loadMedia}>
        <WhiteboardSlide view={view} branchName={branchName} timeZone={timeZone} frame="fullscreen" page={current} onPageCountChange={setPageCount} />
      </MediaLoaderContext.Provider>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <IconButton label={isFullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} variant="secondary" onClick={toggleFullscreen} className="rounded-full shadow-pop">
          {isFullscreen ? <Minimize /> : <Maximize />}
        </IconButton>
        <IconButton ref={closeRef} label="Close presenter (Esc)" variant="secondary" onClick={onClose} className="rounded-full shadow-pop">
          <X />
        </IconButton>
      </div>
      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface/95 px-2 py-1 text-sm text-muted shadow-pop">
        <IconButton label="Previous page" size="sm" disabled={current === 0} onClick={() => setPage(Math.max(0, current - 1))}>
          <ChevronLeft />
        </IconButton>
        <span className="whitespace-nowrap font-semibold tabular-nums text-fg" aria-live="polite">
          Page {current + 1} of {pageCount}
        </span>
        <IconButton label="Next page" size="sm" disabled={current >= pageCount - 1} onClick={() => setPage(Math.min(pageCount - 1, current + 1))}>
          <ChevronRight />
        </IconButton>
        <span className="hidden items-center gap-2 border-l border-line pl-2 md:inline-flex">
          <KeyboardShortcut keys={['←', '→']} /> pages
          <KeyboardShortcut keys={['F']} /> full screen
          <KeyboardShortcut keys={['Esc']} /> exit
        </span>
      </div>
    </div>
  );
}
