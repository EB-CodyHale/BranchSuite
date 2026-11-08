import type { WallFeed } from '@branchsuite/shared';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../../ui/cx.js';
import { MediaLoaderContext, type MediaLoader } from '../whiteboard/media.js';
import { WhiteboardSlide } from '../whiteboard/WhiteboardSlide.js';
import '../whiteboard/whiteboard.css';
import { usePrefersReducedMotion } from './hooks.js';
import { WallBoard } from './WallBoard.js';

export type WallScreenMode = 'board' | 'whiteboard';

/** The mode a feed actually renders: whiteboard only when the server sent one. */
export function screenModeOf(feed: WallFeed): WallScreenMode {
  return feed.mode === 'whiteboard' && feed.whiteboard ? 'whiteboard' : 'board';
}

export interface WallScreenProps {
  feed: WallFeed;
  frame?: 'fullscreen' | 'embedded';
  /** How whiteboard images are fetched (display token on the TV, staff session in the preview). */
  loadMedia: MediaLoader;
  /** Staff preview only. */
  legend?: Map<string, string>;
}

const FADE_MS = 750;

function ScreenContent({ feed, frame, legend }: Omit<WallScreenProps, 'loadMedia'>) {
  if (screenModeOf(feed) === 'whiteboard') {
    return (
      <WhiteboardSlide
        view={feed.whiteboard!}
        branchName={feed.branch.name}
        timeZone={feed.branch.timeZone}
        theme={feed.settings.theme === 'light' ? 'light' : 'dark'}
        frame={frame}
      />
    );
  }
  return <WallBoard feed={feed} legend={legend} frame={frame} />;
}

/**
 * Scheduled takeover: the coded order board, or the morning whiteboard while the huddle is live.
 * A mode switch cross-fades (the outgoing screen fades out above the incoming one); with reduced
 * motion it simply swaps.
 */
export function WallScreen({ feed, frame = 'fullscreen', loadMedia, legend }: WallScreenProps) {
  const mode = screenModeOf(feed);
  const reducedMotion = usePrefersReducedMotion();
  const last = useRef<{ mode: WallScreenMode; feed: WallFeed }>({ mode, feed });
  const [leaving, setLeaving] = useState<{ mode: WallScreenMode; feed: WallFeed } | null>(null);

  useEffect(() => {
    if (last.current.mode !== mode && !reducedMotion) setLeaving(last.current);
    last.current = { mode, feed };
  }, [mode, feed, reducedMotion]);

  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(() => setLeaving(null), FADE_MS);
    return () => clearTimeout(id);
  }, [leaving]);

  return (
    <MediaLoaderContext.Provider value={loadMedia}>
      <div className={cx('relative', frame === 'fullscreen' ? 'h-dvh w-full' : 'h-full w-full')} data-wall-mode={mode}>
        <div key={mode} className={cx('h-full w-full', leaving && 'wb-mode-in')}>
          <ScreenContent feed={feed} frame={frame} legend={legend} />
        </div>
        {leaving ? (
          <div key={`leaving-${leaving.mode}`} aria-hidden="true" inert className="wb-mode-out pointer-events-none absolute inset-0">
            {/* No loader: the outgoing copy never re-requests images (they may no longer be served). */}
            <MediaLoaderContext.Provider value={null}>
              <ScreenContent feed={leaving.feed} frame={frame} legend={legend} />
            </MediaLoaderContext.Provider>
          </div>
        ) : null}
      </div>
    </MediaLoaderContext.Provider>
  );
}
