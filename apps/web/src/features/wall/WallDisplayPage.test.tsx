import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../test/fixtures.js';
import { WALL_DISPLAY_KEY, WALL_TOKEN_KEY } from './deviceApi.js';
import { PAIR_POLL_MS } from './PairingScreen.js';
import { wallFeed, wallOrder } from './testFeed.js';
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
});
