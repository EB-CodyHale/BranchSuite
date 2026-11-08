import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../test/fixtures.js';
import { WALL_DISPLAY_KEY, WALL_TOKEN_KEY } from './deviceApi.js';
import { PAIR_POLL_MS } from './PairingScreen.js';
import { fullView } from '../whiteboard/testFixtures.js';
import { wallFeed, wallOrder } from './testFeed.js';
import { MODE_SWITCH_JITTER_MS, modeChangeDelay } from './useWallDeviceFeed.js';
import { WallDisplayPage } from './WallDisplayPage.js';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
}

type Handler = () => Response | Promise<Response>;

function mockFetch(handlers: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(handlers).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, headers: { ...(init?.headers as Record<string, string>) } });
    const queue = queues.get(`${method} ${url}`);
    if (!queue || queue.length === 0) return jsonResponse({ error: { code: 'not_found', message: `No mock for ${method} ${url}` } }, 404);
    const handler = queue.length > 1 ? queue.shift()! : queue[0]!;
    return handler();
  });
  return calls;
}

const flush = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const PAIR_START = {
  pairingId: 'pair_1',
  code: 'K7Q-29M',
  secret: 'device-secret',
  expiresAt: '2026-03-02T15:10:00.000Z',
};
const NEGOTIATE = () => jsonResponse({ url: null, pollSeconds: 60 });

describe('WallDisplayPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-03-02T15:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pairs, stores the token, then shows the feed', async () => {
    const feed = wallFeed([wallOrder({ role: 'Reach truck driver' })]);
    const calls = mockFetch({
      'POST /api/wall/pair/start': () => jsonResponse(PAIR_START, 201),
      'GET /api/wall/pair/pair_1': [
        () => jsonResponse({ status: 'waiting', expiresAt: PAIR_START.expiresAt }),
        () => jsonResponse({ status: 'paired', displayToken: 'tok_abc', displayId: 'dsp_1', branchName: 'Riverbend' }),
      ],
      'GET /api/wall/feed': () => jsonResponse(feed),
      'POST /api/wall/negotiate': NEGOTIATE,
    });

    render(<WallDisplayPage />);
    await flush();
    expect(screen.getByText('Pairing code K 7 Q - 2 9 M')).toBeTruthy();
    expect(screen.getByText(/Setup → Displays → Pair a display/)).toBeTruthy();
    expect(screen.getByText('10:00')).toBeTruthy();

    await flush(PAIR_POLL_MS); // waiting
    const polls = calls.filter((c) => c.url === '/api/wall/pair/pair_1');
    expect(polls).toHaveLength(1);
    expect(polls[0]!.headers['x-pairing-secret']).toBe('device-secret');

    await flush(PAIR_POLL_MS); // paired
    await flush();
    expect(localStorage.getItem(WALL_TOKEN_KEY)).toBe('tok_abc');
    expect(JSON.parse(localStorage.getItem(WALL_DISPLAY_KEY)!)).toEqual({ displayId: 'dsp_1', branchName: 'Riverbend' });
    expect(screen.getByText('Reach truck driver')).toBeTruthy();

    const feedCall = calls.find((c) => c.url === '/api/wall/feed')!;
    expect(feedCall.headers['x-display-token']).toBe('tok_abc');
    expect(feedCall.headers['x-dev-user']).toBeUndefined();
    expect(calls.some((c) => c.url.startsWith('/api/me'))).toBe(false);
  });

  it('starts from the stored token after a power cycle', async () => {
    localStorage.setItem(WALL_TOKEN_KEY, 'tok_saved');
    const calls = mockFetch({
      'GET /api/wall/feed': () => jsonResponse(wallFeed([wallOrder({ role: 'Machine operator' })])),
      'POST /api/wall/negotiate': NEGOTIATE,
    });
    render(<WallDisplayPage />);
    await flush();
    expect(screen.getByText('Machine operator')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/wall/pair/start')).toBe(false);
  });

  it('returns to pairing with a notice when the token is rejected (401)', async () => {
    localStorage.setItem(WALL_TOKEN_KEY, 'tok_revoked');
    mockFetch({
      'GET /api/wall/feed': () => jsonResponse({ error: { code: 'unauthenticated', message: 'This display is not paired.' } }, 401),
      'POST /api/wall/negotiate': () => jsonResponse({ error: { code: 'unauthenticated', message: 'This display is not paired.' } }, 401),
      'POST /api/wall/pair/start': () => jsonResponse(PAIR_START, 201),
    });
    render(<WallDisplayPage />);
    await flush();
    await flush();
    expect(screen.getByText(/This display was disconnected/)).toBeTruthy();
    expect(screen.getByText('Pairing code K 7 Q - 2 9 M')).toBeTruthy();
    expect(localStorage.getItem(WALL_TOKEN_KEY)).toBeNull();
  });

  it('keeps the last feed and shows "Reconnecting…" when the network drops', async () => {
    localStorage.setItem(WALL_TOKEN_KEY, 'tok_ok');
    let online = true;
    mockFetch({
      'GET /api/wall/feed': () => (online ? jsonResponse(wallFeed([wallOrder({ role: 'Order picker' })])) : Promise.reject(new TypeError('Failed to fetch'))),
      'POST /api/wall/negotiate': NEGOTIATE,
    });
    render(<WallDisplayPage />);
    await flush();
    expect(screen.getByText('Order picker')).toBeTruthy();
    expect(screen.queryByText(/Reconnecting/)).toBeNull();

    online = false;
    await flush(60_000); // fallback poll fails
    expect(screen.getByText('Order picker')).toBeTruthy();
    expect(screen.getByText(/Reconnecting/)).toBeTruthy();
    expect(screen.getByText(/Last updated/)).toBeTruthy();

    online = true;
    await flush(5_000); // backoff retry succeeds
    expect(screen.queryByText(/Reconnecting/)).toBeNull();
  });

  it('asks for a new code when the pairing expires', async () => {
    const calls = mockFetch({
      'POST /api/wall/pair/start': [
        () => jsonResponse(PAIR_START, 201),
        () => jsonResponse({ ...PAIR_START, pairingId: 'pair_2', code: 'ACD-347', expiresAt: '2026-03-02T15:20:00.000Z' }, 201),
      ],
      'GET /api/wall/pair/pair_1': () => jsonResponse({ status: 'expired' }),
    });
    render(<WallDisplayPage />);
    await flush();
    await flush(PAIR_POLL_MS);
    await flush();
    expect(calls.filter((c) => c.url === '/api/wall/pair/start')).toHaveLength(2);
    expect(screen.getByText('Pairing code A C D - 3 4 7')).toBeTruthy();
  });

  describe('scheduled whiteboard takeover', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:wall-media');
      URL.revokeObjectURL = vi.fn();
    });

    it('refetches at nextModeChangeAt, switches to the whiteboard, and back when the window ends', async () => {
      localStorage.setItem(WALL_TOKEN_KEY, 'tok_ok');
      // now = 15:00Z; the huddle starts 30 s later and ends 45 min after that.
      const start = '2026-03-02T15:00:30.000Z';
      const end = '2026-03-02T15:45:30.000Z';
      const board = wallFeed([wallOrder({ role: 'Order picker' })], { nextModeChangeAt: start });
      const huddle = wallFeed([wallOrder({ role: 'Order picker' })], { mode: 'whiteboard', whiteboard: fullView(), nextModeChangeAt: end });
      const after = wallFeed([wallOrder({ role: 'Order picker' })], { nextModeChangeAt: null });
      const calls = mockFetch({
        // The server's answer depends on the clock, so fallback polls cannot mask a late switch.
        'GET /api/wall/feed': () => {
          const t = Date.now();
          return jsonResponse(t < Date.parse(start) ? board : t < Date.parse(end) ? huddle : after);
        },
        'POST /api/wall/negotiate': NEGOTIATE,
        'GET /api/wall/media/med_1': () => new Response(new Blob(['png'], { type: 'image/png' }), { status: 200, headers: { 'content-type': 'image/png' } }),
      });
      render(<WallDisplayPage />);
      await flush();
      expect(screen.getByText('Order picker')).toBeTruthy();
      expect(screen.queryByText('Welcome back, Jordan')).toBeNull();
      expect(calls.filter((c) => c.url === '/api/wall/feed')).toHaveLength(1);
      // Displays never ask for media while the board is showing.
      expect(calls.some((c) => c.url.startsWith('/api/wall/media/'))).toBe(false);

      await flush(29_000);
      expect(calls.filter((c) => c.url === '/api/wall/feed')).toHaveLength(1);
      await flush(1_000 + MODE_SWITCH_JITTER_MS.max);
      await flush();
      expect(calls.filter((c) => c.url === '/api/wall/feed')).toHaveLength(2);
      expect(screen.getByRole('region', { name: 'Riverbend morning whiteboard' })).toBeTruthy();
      expect(screen.getByText('Welcome back, Jordan')).toBeTruthy();
      expect(document.querySelector('[data-wall-mode]')!.getAttribute('data-wall-mode')).toBe('whiteboard');

      // Images: fetched with the display token (no cookies), shown through an object URL.
      const media = calls.filter((c) => c.url === '/api/wall/media/med_1');
      expect(media.length).toBeGreaterThanOrEqual(1);
      expect(media[0]!.headers['x-display-token']).toBe('tok_ok');
      expect(media[0]!.headers['x-dev-user']).toBeUndefined();
      expect(screen.getByRole('img', { name: 'Fill rate by week' }).getAttribute('src')).toBe('blob:wall-media');

      // Still the whiteboard just before the end (polls and the 10-minute refresh keep it).
      await flush(45 * 60_000 - 3_000);
      expect(document.querySelector('[data-wall-mode]')!.getAttribute('data-wall-mode')).toBe('whiteboard');
      // The window ends: the scheduled refetch (not the next 60 s poll at 15:46) brings the board back.
      await flush(1_000 + MODE_SWITCH_JITTER_MS.max + 50);
      await flush();
      expect(document.querySelector('[data-wall-mode]')!.getAttribute('data-wall-mode')).toBe('board');
      // Cross-fade: the outgoing whiteboard is hidden from assistive tech, then removed.
      expect(screen.getByText('Welcome back, Jordan').closest('[aria-hidden="true"]')).toBeTruthy();
      await flush(800);
      expect(screen.queryByText('Welcome back, Jordan')).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wall-media');
    });

    it('never sends the display token to a media URL outside /api/wall/media/', async () => {
      localStorage.setItem(WALL_TOKEN_KEY, 'tok_ok');
      const view = fullView();
      const tampered = { ...view, blocks: view.blocks.map((b) => (b.kind === 'image' ? { ...b, mediaUrl: 'https://example.test/steal' } : b)) };
      const calls = mockFetch({
        'GET /api/wall/feed': () => jsonResponse(wallFeed([], { mode: 'whiteboard', whiteboard: tampered })),
        'POST /api/wall/negotiate': NEGOTIATE,
      });
      render(<WallDisplayPage />);
      await flush();
      await flush();
      expect(screen.getByText('Welcome back, Jordan')).toBeTruthy();
      expect(calls.some((c) => c.url.includes('example.test'))).toBe(false);
      expect(screen.getByRole('img', { name: 'Fill rate by week (image unavailable)' })).toBeTruthy();
    });
  });
});

describe('modeChangeDelay', () => {
  const now = Date.parse('2026-03-02T13:29:00.000Z');
  it('waits until the switch plus jitter', () => {
    expect(modeChangeDelay('2026-03-02T13:30:00.000Z', now, () => 0)).toBe(60_000 + MODE_SWITCH_JITTER_MS.min);
    expect(modeChangeDelay('2026-03-02T13:30:00.000Z', now, () => 1)).toBe(60_000 + MODE_SWITCH_JITTER_MS.max);
  });
  it('ignores missing, invalid, long-past and far-future times', () => {
    expect(modeChangeDelay(null, now)).toBeNull();
    expect(modeChangeDelay(undefined, now)).toBeNull();
    expect(modeChangeDelay('soon', now)).toBeNull();
    expect(modeChangeDelay('2026-03-02T13:00:00.000Z', now)).toBeNull();
    expect(modeChangeDelay('2026-03-05T13:00:00.000Z', now)).toBeNull();
  });
});
