/**
 * Realtime invalidation over Azure Web PubSub (subprotocol json.webpubsub.azure.v1).
 *
 * Messages carry no business data: `{type:'invalidate', scopeId, entities}` is mapped to TanStack
 * Query invalidations and the affected screens refetch. When realtime is disabled (negotiate returns
 * url null) or the socket is down, the hook falls back to polling every `pollSeconds`.
 */
import { paths, type RealtimeMessage, type RealtimeNegotiateResponse } from '@branchsuite/shared';
import { useQueryClient, type InvalidateQueryFilters, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { DISPLAY_TOKEN_HEADER } from './queries.js';
import { boardKeyIncludes, keys } from './queryKeys.js';

export type ConnectionStatus = 'live' | 'polling' | 'offline';

export const WEBPUBSUB_SUBPROTOCOL = 'json.webpubsub.azure.v1';
const MAX_BACKOFF_MS = 30_000;
const STAFF_POLL_SECONDS = 30;

const ENTITIES = new Set<RealtimeMessage['entities'][number]>(['orders', 'accounts', 'candidates', 'tasks', 'people', 'branch', 'wall']);

/** Extract a RealtimeMessage from a raw Web PubSub frame; null for system frames or anything malformed. */
export function parseRealtimeFrame(raw: unknown): RealtimeMessage | null {
  if (typeof raw !== 'string') return null;
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof frame !== 'object' || frame === null || (frame as { type?: unknown }).type !== 'message') return null;
  let data = (frame as { data?: unknown }).data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Partial<RealtimeMessage>;
  if (msg.type !== 'invalidate' || typeof msg.scopeId !== 'string' || !Array.isArray(msg.entities)) return null;
  const entities = msg.entities.filter((e) => ENTITIES.has(e));
  return { type: 'invalidate', scopeId: msg.scopeId, entities, at: typeof msg.at === 'string' ? msg.at : new Date().toISOString() };
}

/** Which caches a realtime message makes stale. Pure, so it is unit-testable. */
export function invalidationsFor(msg: RealtimeMessage): InvalidateQueryFilters[] {
  const scope = msg.scopeId;
  const board: InvalidateQueryFilters = { predicate: (q) => boardKeyIncludes(q.queryKey, scope) };
  const wall: InvalidateQueryFilters = { queryKey: [keys.wallRoot()[0], scope] };
  const out: InvalidateQueryFilters[] = [];
  for (const entity of new Set(msg.entities)) {
    switch (entity) {
      case 'orders':
        out.push(board, { queryKey: keys.ordersRoot(scope) }, wall);
        break;
      case 'accounts':
        out.push(board, { queryKey: keys.accounts(scope) }, wall);
        break;
      case 'candidates':
        out.push({ queryKey: keys.candidatesRoot(scope) });
        break;
      case 'tasks':
        out.push({ queryKey: keys.tasksRoot() }, { queryKey: keys.filtered(scope) }, { queryKey: ['taskMessages', scope] });
        break;
      case 'people':
        out.push({ queryKey: keys.usersRoot() }, board, { queryKey: keys.me(), exact: true });
        break;
      case 'branch':
        out.push({ queryKey: keys.branches() }, { queryKey: keys.me(), exact: true }, wall);
        break;
      case 'wall':
        out.push(wall);
        break;
    }
  }
  return [...new Set(out)];
}

/** Refetch every on-screen view that realtime would otherwise keep fresh. */
function refreshLiveViews(qc: QueryClient): void {
  for (const root of [keys.boardRoot(), keys.tasksRoot(), ['candidates'], keys.wallRoot(), ['filtered'], ['orders']]) {
    void qc.invalidateQueries({ queryKey: root });
  }
}

export interface RealtimeConnectionOptions {
  /** Changing this value tears the connection down and negotiates a new one. */
  connectionKey: string;
  enabled: boolean;
  negotiate: () => Promise<RealtimeNegotiateResponse>;
  onMessage: (msg: RealtimeMessage) => void;
  /** Called every poll interval while not live (and the page is visible and online). */
  onPoll: () => void;
  /** Called when a live socket opens after a gap, to catch up on missed messages. */
  onResume: () => void;
  fallbackPollSeconds: number;
}

/**
 * Transport-level hook shared by the staff app and the wall device: negotiate, connect, reconnect
 * with exponential backoff (renegotiating each time, since access tokens expire), poll while down.
 */
export function useRealtimeConnection(options: RealtimeConnectionOptions): { status: ConnectionStatus } {
  const [status, setStatus] = useState<ConnectionStatus>('polling');
  const latest = useRef(options);
  latest.current = options;
  const { enabled, connectionKey, fallbackPollSeconds } = options;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let pollSeconds = fallbackPollSeconds;
    let wasLive = false;
    let hadGap = false;

    const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = undefined;
    };
    const startPolling = () => {
      if (pollTimer !== undefined) return;
      pollTimer = setInterval(() => {
        if (document.visibilityState === 'hidden' || isOffline()) return;
        latest.current.onPoll();
      }, pollSeconds * 1000);
    };
    const setMode = (mode: ConnectionStatus) => {
      if (disposed) return;
      setStatus(mode);
      if (mode === 'live') stopPolling();
      else startPolling();
    };

    const scheduleReconnect = () => {
      clearTimeout(retryTimer);
      const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
      attempt += 1;
      retryTimer = setTimeout(() => void connect(), base * (0.75 + Math.random() * 0.5));
    };

    const connect = async () => {
      if (disposed) return;
      let negotiated: RealtimeNegotiateResponse;
      try {
        negotiated = await latest.current.negotiate();
      } catch {
        setMode(isOffline() ? 'offline' : 'polling');
        scheduleReconnect();
        return;
      }
      if (disposed) return;
      const nextPoll = negotiated.pollSeconds > 0 ? negotiated.pollSeconds : fallbackPollSeconds;
      if (nextPoll !== pollSeconds) {
        pollSeconds = nextPoll;
        stopPolling();
      }
      if (!negotiated.url) {
        setMode('polling');
        return;
      }
      const ws = new WebSocket(negotiated.url, WEBPUBSUB_SUBPROTOCOL);
      socket = ws;
      ws.onopen = () => {
        if (disposed || socket !== ws) return;
        attempt = 0;
        setMode('live');
        if (hadGap) latest.current.onResume();
        wasLive = true;
        hadGap = false;
      };
      ws.onmessage = (event: MessageEvent) => {
        const msg = parseRealtimeFrame(event.data);
        if (msg) latest.current.onMessage(msg);
      };
      ws.onclose = () => {
        if (disposed || socket !== ws) return;
        socket = null;
        hadGap = wasLive;
        setMode(isOffline() ? 'offline' : 'polling');
        scheduleReconnect();
      };
    };

    const handleOffline = () => setMode('offline');
    const handleOnline = () => {
      if (socket) return;
      attempt = 0;
      clearTimeout(retryTimer);
      setMode('polling');
      latest.current.onPoll();
      void connect();
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    setMode(isOffline() ? 'offline' : 'polling');
    void connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      stopPolling();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      const ws = socket;
      socket = null;
      ws?.close();
    };
  }, [enabled, connectionKey, fallbackPollSeconds]);

  return { status: enabled ? status : 'offline' };
}

/**
 * Staff realtime. `scopeIds` are the branches the caller can read; the server fixes the groups when
 * it issues the token, so a change in readable branches renegotiates.
 */
export function useRealtime(scopeIds: readonly string[]): { status: ConnectionStatus } {
  const qc = useQueryClient();
  return useRealtimeConnection({
    connectionKey: [...scopeIds].sort().join(','),
    enabled: scopeIds.length > 0,
    negotiate: () => api.post<RealtimeNegotiateResponse>(paths.realtimeNegotiate()),
    onMessage: (msg) => {
      for (const filters of invalidationsFor(msg)) void qc.invalidateQueries(filters);
    },
    onPoll: () => refreshLiveViews(qc),
    onResume: () => refreshLiveViews(qc),
    fallbackPollSeconds: STAFF_POLL_SECONDS,
  });
}

/** Wall device negotiate (group wall:<branchId> only). */
export function negotiateWall(displayToken: string): Promise<RealtimeNegotiateResponse> {
  return api.post<RealtimeNegotiateResponse>(paths.wallNegotiate(), undefined, { headers: { [DISPLAY_TOKEN_HEADER]: displayToken } });
}
