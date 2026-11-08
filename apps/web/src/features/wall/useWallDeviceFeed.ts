/**
 * The paired display's feed loop:
 * - when the feed names the next board<->whiteboard switch (`nextModeChangeAt`), refetch right then
 *   (plus a small jitter so every TV in a branch does not hit the API in the same millisecond);
 * - fetch on start, on every realtime "invalidate" (debounced), on fallback polls (60 s when realtime
 *   is off or the socket is down), and a full refresh every 10 minutes regardless;
 * - keep showing the last good feed through network loss, retrying with backoff;
 * - a 401 (revoked or unknown token) hands control back to pairing.
 */
import type { WallFeed } from '@branchsuite/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeConnection, type ConnectionStatus } from '../../lib/realtime.js';
import { deviceApi, WallHttpError } from './deviceApi.js';

export const WALL_FALLBACK_POLL_SECONDS = 60;
export const WALL_FULL_REFRESH_MS = 10 * 60_000;
const REALTIME_DEBOUNCE_MS = 400;
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;
/** Refetch this long after the announced switch: 0.5-2.5 s, so the server clock is surely past it. */
export const MODE_SWITCH_JITTER_MS = { min: 500, max: 2_500 } as const;
/** setTimeout cannot wait longer than ~24.8 days; a switch is always within a day. */
const MAX_SCHEDULE_MS = 24 * 60 * 60_000;

/** Delay until the announced mode change (with jitter), or null when there is nothing to schedule. */
export function modeChangeDelay(nextModeChangeAt: string | null | undefined, now: number, random: () => number = Math.random): number | null {
  if (!nextModeChangeAt) return null;
  const at = Date.parse(nextModeChangeAt);
  if (Number.isNaN(at)) return null;
  const until = at - now;
  // Already past: the feed we hold is the post-switch feed (or the server will announce the next one).
  if (until < -MODE_SWITCH_JITTER_MS.max || until > MAX_SCHEDULE_MS) return null;
  const jitter = MODE_SWITCH_JITTER_MS.min + random() * (MODE_SWITCH_JITTER_MS.max - MODE_SWITCH_JITTER_MS.min);
  return Math.max(0, until) + jitter;
}

export type FeedProblem = null | 'network' | 'inactive';

export interface WallDeviceFeedState {
  feed: WallFeed | null;
  /** Time of the last successful fetch. */
  updatedAt: Date | null;
  problem: FeedProblem;
  /** Server message for 'inactive' (e.g. branch deactivated). */
  message: string | null;
  connection: ConnectionStatus;
}

export function useWallDeviceFeed(token: string, onUnauthorized: () => void): WallDeviceFeedState {
  const [feed, setFeed] = useState<WallFeed | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [problem, setProblem] = useState<FeedProblem>(null);
  const [message, setMessage] = useState<string | null>(null);
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;
  const inflight = useRef<AbortController | null>(null);
  const disposed = useRef(false);
  const [failures, setFailures] = useState(0);

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const next = await deviceApi.feed(token, ctrl.signal);
      if (ctrl.signal.aborted || disposed.current) return;
      setFailures(0);
      setFeed(next);
      setUpdatedAt(new Date());
      setProblem(null);
      setMessage(null);
    } catch (err) {
      if (ctrl.signal.aborted || disposed.current) return;
      if (err instanceof WallHttpError && err.unauthorized) {
        unauthorizedRef.current();
        return;
      }
      setFailures((n) => n + 1);
      if (err instanceof WallHttpError && (err.status === 404 || err.status === 403)) {
        setProblem('inactive');
        setMessage(err.message);
      } else {
        setProblem('network');
      }
    } finally {
      if (inflight.current === ctrl) inflight.current = null;
    }
  }, [token]);

  // Initial fetch + full refresh every 10 minutes regardless of realtime.
  useEffect(() => {
    disposed.current = false;
    void refresh();
    const id = setInterval(() => void refresh(), WALL_FULL_REFRESH_MS);
    return () => {
      disposed.current = true;
      clearInterval(id);
      inflight.current?.abort();
    };
  }, [refresh]);

  // While failing, retry sooner than the poll interval, backing off to a minute.
  useEffect(() => {
    if (problem === null || failures === 0) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (failures - 1));
    const id = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(id);
  }, [problem, failures, refresh]);

  // Switch on time: refetch when the huddle window starts or ends.
  const nextModeChangeAt = feed?.nextModeChangeAt ?? null;
  useEffect(() => {
    const delay = modeChangeDelay(nextModeChangeAt, Date.now());
    if (delay === null) return;
    const id = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(id);
  }, [nextModeChangeAt, refresh]);

  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(debounce.current), []);

  const { status } = useRealtimeConnection({
    connectionKey: token,
    enabled: true,
    negotiate: async () => {
      try {
        return await deviceApi.negotiate(token);
      } catch (err) {
        if (err instanceof WallHttpError && err.unauthorized) unauthorizedRef.current();
        throw err;
      }
    },
    onMessage: () => {
      clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void refresh(), REALTIME_DEBOUNCE_MS);
    },
    onPoll: () => void refresh(),
    onResume: () => void refresh(),
    fallbackPollSeconds: WALL_FALLBACK_POLL_SECONDS,
  });

  return { feed, updatedAt, problem, message, connection: status };
}
