import type { MeResponse } from '@branchsuite/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { getDevUser } from '../lib/api.js';
import { jsonResponse, meResponse } from '../test/fixtures.js';
import { AppProviders, routes } from './App.js';

type Handler = (init: RequestInit | undefined) => Response;

function setup(path: string, handlers: Record<string, Handler>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const handler = handlers[`${init?.method ?? 'GET'} ${url}`];
    return handler ? handler(init) : jsonResponse({ error: { code: 'not_found', message: `No mock for ${url}` } }, 404);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { calls, router };
}

const negotiate = { 'POST /api/realtime/negotiate': () => jsonResponse({ url: null, pollSeconds: 30 }) };
const withMe = (me: MeResponse) => ({ 'GET /api/me': () => jsonResponse(me), ...negotiate });

describe('app shell', () => {
  it('renders the board inside the shell for a signed-in manager', async () => {
    setup('/', withMe(meResponse()));
    expect(await screen.findByRole('heading', { name: 'Job order board' })).toBeTruthy();

    const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0]!;
    const links = within(nav).getAllByRole('link').map((a) => a.textContent);
    expect(links).toEqual(['Board', 'Whiteboard', 'Inbox', 'Setup']);
    expect(within(nav).getByRole('link', { name: 'Board' }).getAttribute('aria-current')).toBe('page');

    const scope = screen.getByRole('combobox', { name: 'Branch scope' }) as HTMLSelectElement;
    expect(Array.from(scope.options).map((o) => o.textContent)).toEqual(['All assigned branches', 'Northfield', 'Southport']);
    expect(scope.value).toBe('all');

    expect(screen.getByRole('button', { name: 'Account: Avery Quinn' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Theme: Daylight' })).toBeTruthy();
    expect(document.title).toBe('Job order board · BranchSuite');
  });

  it('shows Pipeline only with the feature flag and hides Setup from members', async () => {
    setup('/', withMe(meResponse({ pipeline: true, user: { role: 'member' } })));
    await screen.findByRole('heading', { name: 'Job order board' });
    const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0]!;
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Board', 'Whiteboard', 'Pipeline', 'Inbox']);
  });

  it('redirects a member away from setup', async () => {
    setup('/setup/accounts', withMe(meResponse({ user: { role: 'member' } })));
    expect(await screen.findByRole('heading', { name: 'Job order board' })).toBeTruthy();
  });

  it('persists the branch scope to preferences and localStorage', async () => {
    const me = meResponse();
    const { calls } = setup('/', {
      ...withMe(me),
      'PATCH /api/me/preferences': (init) => jsonResponse({ ...me.user, preferences: { ...me.user.preferences, ...JSON.parse(String(init?.body)) } }),
    });
    const scope = (await screen.findByRole('combobox', { name: 'Branch scope' })) as HTMLSelectElement;
    fireEvent.change(scope, { target: { value: 'br_south' } });
    expect(scope.value).toBe('br_south');
    await waitFor(() => expect(calls.some((c) => c.url === '/api/me/preferences')).toBe(true));
    const patch = calls.find((c) => c.url === '/api/me/preferences')!;
    expect(JSON.parse(String(patch.init?.body))).toEqual({ branchScope: 'br_south' });
    expect(localStorage.getItem('bs.branchScope')).toBe('br_south');
  });

  it('applies and saves a theme from the theme menu', async () => {
    const me = meResponse();
    const { calls } = setup('/', {
      ...withMe(me),
      'PATCH /api/me/preferences': () => jsonResponse({ ...me.user, preferences: { ...me.user.preferences, theme: 'night' } }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Theme: Daylight' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Night' }));
    expect(document.documentElement.dataset.theme).toBe('night');
    expect(document.documentElement.style.getPropertyValue('--marker-teal-ink')).toBe('#6fd6cc');
    await waitFor(() => expect(calls.some((c) => c.url === '/api/me/preferences' && String(c.init?.body).includes('night'))).toBe(true));
  });

  it('shows the roster screen for a signed-in user who is not provisioned', async () => {
    setup('/', { 'GET /api/me': () => jsonResponse({ error: { code: 'not_provisioned', message: 'Not on roster' } }, 403) });
    expect(await screen.findByRole('heading', { name: /not on the roster/i })).toBeTruthy();
    expect(screen.getByText(/Ask your branch manager/)).toBeTruthy();
  });

  it('offers the dev sign-in picker on 401 in development and remembers the choice', async () => {
    setup('/', {
      'GET /api/me': () => jsonResponse({ error: { code: 'unauthenticated', message: 'Sign in' } }, 401),
      'GET /api/dev/users': () =>
        jsonResponse([
          { email: 'riley.member@example.test', name: 'Riley Member', role: 'member' },
          { email: 'morgan.admin@example.test', name: 'Morgan Admin', role: 'admin' },
        ]),
    });
    expect(await screen.findByRole('heading', { name: 'Sign in as…' })).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'Dev users' });
    const options = within(list).getAllByRole('button');
    expect(options.map((b) => b.textContent)).toEqual([expect.stringContaining('Morgan Admin'), expect.stringContaining('Riley Member')]);
    fireEvent.click(options[1]!);
    expect(getDevUser()).toBe('riley.member@example.test');
  });

  it('renders /wall without a user session or a call to /api/me', async () => {
    localStorage.removeItem('bs.wall.token');
    const { calls } = setup('/wall', {});
    // An unpaired display lands on the pairing screen (features/wall/PairingScreen).
    expect(await screen.findByRole('heading', { name: 'Pair this display' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/wall/pair/start')).toBe(true));
    expect(calls.some((c) => c.url === '/api/me')).toBe(false);
  });
});
