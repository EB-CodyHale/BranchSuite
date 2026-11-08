import type { WallPairStartResponse } from '@branchsuite/shared';
import { useEffect, useRef, useState } from 'react';
import { useNow } from './clock.js';
import { deviceApi, WallHttpError, type DisplaySession } from './deviceApi.js';

export const PAIR_POLL_MS = 3000;
/** Wait before asking for a new code after the server refused (rate limit, outage). */
const START_RETRY_MS = 15_000;

export interface PairingScreenProps {
  onPaired: (session: DisplaySession) => void;
  /** Shown above the code, e.g. "This display was disconnected." */
  notice?: string | null;
}

function remainingText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Unpaired display: show a short code for a manager to enter in Setup → Displays. Polls every 3 s with
 * the device-only secret and starts over with a fresh code whenever the current one expires.
 */
export function PairingScreen({ onPaired, notice }: PairingScreenProps) {
  const [pairing, setPairing] = useState<WallPairStartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const now = useNow(1000);
  const pairedRef = useRef(onPaired);
  pairedRef.current = onPaired;

  // Start (or restart) a pairing.
  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setPairing(null);
    deviceApi
      .startPairing()
      .then((p) => {
        if (!live) return;
        setError(null);
        setPairing(p);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof WallHttpError && err.status !== 0 ? err.message : 'Cannot reach BranchSuite. Retrying…');
        retry = setTimeout(() => setGeneration((g) => g + 1), START_RETRY_MS);
      });
    return () => {
      live = false;
      clearTimeout(retry);
    };
  }, [generation]);

  // Poll for the manager's claim.
  useEffect(() => {
    if (!pairing) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await deviceApi.pollPairing(pairing.pairingId, pairing.secret);
        if (!live) return;
        if (res.status === 'paired') {
          pairedRef.current({ token: res.displayToken, displayId: res.displayId, branchName: res.branchName });
          return;
        }
        if (res.status === 'expired') {
          setGeneration((g) => g + 1);
          return;
        }
      } catch (err) {
        if (!live) return;
        // A rejected secret means this pairing is unusable; anything else is transient.
        if (err instanceof WallHttpError && err.unauthorized) {
          setGeneration((g) => g + 1);
          return;
        }
      }
      if (live) timer = setTimeout(() => void tick(), PAIR_POLL_MS);
    };
    timer = setTimeout(() => void tick(), PAIR_POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pairing]);

  const remainingMs = pairing ? Date.parse(pairing.expiresAt) - now.getTime() : 0;
  const expired = pairing !== null && remainingMs <= 0;

  // Local expiry (clock-based) restarts too, in case a poll is slow.
  useEffect(() => {
    if (expired) setGeneration((g) => g + 1);
  }, [expired]);

  const chars = pairing ? [...pairing.code] : [];

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-[1.6rem] px-4 py-10 text-center">
      <p className="font-display text-[clamp(1rem,1.6vw,2rem)] font-semibold uppercase tracking-[0.3em] text-muted">BranchSuite display</p>
      {notice ? (
        <p role="status" className="rounded-md border border-warning bg-warning-soft px-4 py-2 text-[clamp(1rem,1.5vw,1.75rem)] font-semibold text-warning">
          {notice}
        </p>
      ) : null}
      <h1 className="font-display text-[clamp(1.6rem,3vw,3.5rem)] font-bold leading-tight">Pair this display</h1>

      {pairing && !expired ? (
        <>
          <p className="sr-only">Pairing code {pairing.code.split('').join(' ')}</p>
          <p aria-hidden="true" className="flex items-center gap-[clamp(0.25rem,0.8vw,1rem)]" data-testid="pairing-code">
            {chars.map((c, i) =>
              c === '-' ? (
                <span key={i} className="w-[clamp(0.75rem,2vw,2.5rem)] text-center font-display text-[clamp(2.5rem,9vw,11rem)] font-bold text-subtle">
                  –
                </span>
              ) : (
                <span
                  key={i}
                  className="grid min-w-[1.15em] place-items-center rounded-lg border-2 border-line-strong bg-surface px-[0.12em] font-display text-[clamp(2.5rem,9vw,11rem)] font-bold leading-[1.2] tabular-nums shadow-card"
                >
                  {c}
                </span>
              ),
            )}
          </p>
          <p className="max-w-[46rem] text-[clamp(1rem,1.7vw,2rem)] leading-snug text-muted">
            Ask a branch manager to open <strong className="text-fg">BranchSuite → Setup → Displays → Pair a display</strong> and enter this code.
          </p>
          <p className="text-[clamp(0.95rem,1.3vw,1.5rem)] font-medium tabular-nums text-subtle">
            Code expires in <span className="text-fg">{remainingText(remainingMs)}</span>. A new code appears automatically.
          </p>
        </>
      ) : error ? (
        <p role="alert" className="max-w-[40rem] text-[clamp(1rem,1.6vw,1.8rem)] text-danger">
          {error}
        </p>
      ) : (
        <p className="text-[clamp(1rem,1.6vw,1.8rem)] text-muted" role="status">
          Getting a pairing code…
        </p>
      )}
    </div>
  );
}
