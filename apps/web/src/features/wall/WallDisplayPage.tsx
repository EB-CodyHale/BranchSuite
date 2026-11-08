import { Maximize, Minimize } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useDocumentTitle } from '../../app/useDocumentTitle.js';
import { cx } from '../../ui/cx.js';
import { shortTime } from './clock.js';
import { clearSession, deviceApi, readSession, saveSession, type DisplaySession } from './deviceApi.js';
import { useFullscreen, useRecentActivity, useScreenWakeLock } from './hooks.js';
import { PairingScreen } from './PairingScreen.js';
import { useWallDeviceFeed } from './useWallDeviceFeed.js';
import { WallScreen } from './WallScreen.js';

const DISCONNECTED = 'This display was disconnected. Pair it again to continue.';

/** Paint the document itself in the wall theme so overscroll and letterboxing match the board. */
function useDocumentTheme(theme: 'night' | 'daylight'): void {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = theme;
    return () => {
      if (previous === undefined) delete root.dataset.theme;
      else root.dataset.theme = previous;
    };
  }, [theme]);
}

/**
 * /wall — the lobby display. During the branch's live huddle window the server sends
 * `mode: 'whiteboard'` and the display shows the morning whiteboard instead of the board (scheduled
 * takeover); the feed loop refetches exactly at `nextModeChangeAt` so the switch is on time. No staff session, no navigation, no links, never calls /api/me.
 * State machine: no stored token → pairing; paired → feed; a 401 from the feed → back to pairing.
 * A hard refresh or power cycle lands here and resumes from the stored token.
 */
export function WallDisplayPage() {
  const [session, setSession] = useState<DisplaySession | null>(() => readSession());
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRecentActivity(3000);
  const fullscreen = useFullscreen<HTMLElement>();
  useScreenWakeLock(true);

  const onPaired = useCallback((next: DisplaySession) => {
    saveSession(next);
    setNotice(null);
    setSession(next);
  }, []);

  const onUnauthorized = useCallback(() => {
    clearSession();
    setNotice(DISCONNECTED);
    setSession(null);
  }, []);

  return (
    <main
      ref={fullscreen.ref}
      onDoubleClick={() => void fullscreen.toggle()}
      className={cx('relative min-h-dvh select-none overflow-hidden bg-bg text-fg', !active && 'cursor-none')}
      data-theme="night"
    >
      {session ? <PairedDisplay key={session.token} session={session} onUnauthorized={onUnauthorized} /> : <PairingView notice={notice} onPaired={onPaired} />}

      <button
        type="button"
        onClick={() => void fullscreen.toggle()}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-label={fullscreen.isFullscreen ? 'Exit full screen' : 'Enter full screen'}
        title={fullscreen.isFullscreen ? 'Exit full screen' : 'Enter full screen'}
        tabIndex={active ? 0 : -1}
        aria-hidden={active ? undefined : true}
        className={cx(
          'wall-fade fixed bottom-4 right-4 z-20 inline-flex size-12 items-center justify-center rounded-full border border-line-strong bg-surface text-fg shadow-pop hover:bg-surface-2',
          active ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {fullscreen.isFullscreen ? <Minimize aria-hidden="true" className="size-5" /> : <Maximize aria-hidden="true" className="size-5" />}
      </button>
    </main>
  );
}

function PairingView({ notice, onPaired }: { notice: string | null; onPaired: (s: DisplaySession) => void }) {
  useDocumentTitle('Pair display');
  useDocumentTheme('night');
  return <PairingScreen notice={notice} onPaired={onPaired} />;
}

function PairedDisplay({ session, onUnauthorized }: { session: DisplaySession; onUnauthorized: () => void }) {
  const { feed, updatedAt, problem, message, connection } = useWallDeviceFeed(session.token, onUnauthorized);
  const theme = feed?.settings.theme === 'light' ? 'daylight' : 'night';
  useDocumentTheme(theme);
  useDocumentTitle(feed?.branch.name ?? session.branchName ?? 'Wall');

  const reconnecting = problem === 'network' || connection === 'offline';
  const token = session.token;
  const loadMedia = useCallback((url: string, signal: AbortSignal) => deviceApi.media(token, url, signal), [token]);

  return (
    <div data-theme={theme} className="relative min-h-dvh bg-bg text-fg">
      {feed ? (
        <WallScreen feed={feed} frame="fullscreen" loadMedia={loadMedia} />
      ) : (
        <div className="grid min-h-dvh place-items-center px-4 text-center">
          <div>
            <p className="font-display text-[clamp(2rem,4vw,4.5rem)] font-bold leading-tight">{session.branchName ?? 'BranchSuite'}</p>
            <p className="mt-2 text-[clamp(1rem,1.6vw,1.8rem)] text-muted" role="status">
              {problem === 'inactive' ? (message ?? 'This display is not available right now.') : reconnecting ? 'Reconnecting…' : 'Loading the board…'}
            </p>
          </div>
        </div>
      )}

      {feed && problem === 'inactive' ? (
        <p role="status" className="fixed inset-x-0 top-0 z-10 bg-warning-soft px-4 py-2 text-center text-[clamp(0.9rem,1.1vw,1.4rem)] font-semibold text-warning">
          {message ?? 'This display is not available right now.'}
        </p>
      ) : null}

      {feed && reconnecting ? (
        <p
          role="status"
          className="fixed left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-line-strong bg-surface/95 px-4 py-1.5 text-[clamp(0.85rem,0.9vw,1.25rem)] font-semibold text-muted shadow-pop"
        >
          <span aria-hidden="true" className="mr-2 inline-block size-2 animate-pulse-soft rounded-full bg-warning align-middle" />
          Reconnecting…
          {updatedAt ? <span className="font-medium text-subtle"> · Last updated {shortTime(updatedAt, feed.branch.timeZone)}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
