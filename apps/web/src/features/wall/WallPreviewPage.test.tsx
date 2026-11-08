import type { MeResponse, WallLegend } from '@branchsuite/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BranchScopeProvider } from '../../app/BranchScope.js';
import { MeProvider } from '../../app/MeContext.js';
import { keys } from '../../lib/queryKeys.js';
import { jsonResponse, meResponse } from '../../test/fixtures.js';
import { fullView } from '../whiteboard/testFixtures.js';
import { wallFeed, wallOrder } from './testFeed.js';
import { WallPreviewPage } from './WallPreviewPage.js';

const LEGEND: WallLegend = {
  branchId: 'br_north',
  entries: [{ accountId: 'acc_1', name: 'Lakeside Foods', code: 'K7', color: 'w1', glyph: 'diamond' }],
};

function renderPreview(me: MeResponse = meResponse()) {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (url === '/api/branches/br_north/wall/preview?mode=whiteboard') {
      const view = fullView();
      return jsonResponse(
        wallFeed([], {
          mode: 'whiteboard',
          branch: { name: 'Northfield', timeZone: 'America/Chicago' },
          whiteboard: { ...view, blocks: view.blocks.filter((b) => b.kind !== 'image') },
        }),
      );
    }
    if (url === '/api/branches/br_north/wall/preview') return jsonResponse(wallFeed([wallOrder({ role: 'Forklift operator' })], { branch: { name: 'Northfield', timeZone: 'America/Chicago' } }));
    if (url === '/api/branches/br_south/wall/preview') return jsonResponse(wallFeed([wallOrder({ role: 'Packer' })], { branch: { name: 'Southport', timeZone: 'America/Chicago' } }));
    if (url === '/api/branches/br_north/wall/legend') return jsonResponse(LEGEND);
    if (method === 'PATCH') return jsonResponse({});
    return jsonResponse({ error: { code: 'not_found', message: 'nope' } }, 404);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(keys.me(), me);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MeProvider me={me}>
          <BranchScopeProvider>
            <WallPreviewPage />
          </BranchScopeProvider>
        </MeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('WallPreviewPage', () => {
  it('renders the coded feed without names until the legend is toggled on', async () => {
    const calls = renderPreview();
    expect(await screen.findByText('Forklift operator')).toBeTruthy();
    expect(screen.queryByText('Lakeside Foods')).toBeNull();
    expect(calls).not.toContain('GET /api/branches/br_north/wall/legend');

    fireEvent.click(screen.getByRole('button', { name: 'Show legend' }));
    expect((await screen.findAllByText('Lakeside Foods')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/staff only/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Hide legend' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Hide legend' }));
    expect(screen.queryByText('Lakeside Foods')).toBeNull();
  });

  it('switches branches with the picker', async () => {
    renderPreview();
    await screen.findByText('Forklift operator');
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'br_south' } });
    expect(await screen.findByText('Packer')).toBeTruthy();
  });

  it('shows setup links to managers only', async () => {
    renderPreview();
    await screen.findByText('Forklift operator');
    expect(screen.getByRole('link', { name: /Wall settings/ }).getAttribute('href')).toBe('/setup/wall');
    expect(screen.getByRole('link', { name: /Displays/ }).getAttribute('href')).toBe('/setup/displays');
  });

  it('hides setup links from members', async () => {
    renderPreview(meResponse({ user: { role: 'member' } }));
    await screen.findByText('Forklift operator');
    expect(screen.queryByRole('link', { name: /Wall settings/ })).toBeNull();
  });

  it('opens and closes the full-screen preview', async () => {
    renderPreview();
    await screen.findByText('Forklift operator');
    fireEvent.click(screen.getByRole('button', { name: 'Full-screen preview' }));
    expect(screen.getByRole('dialog', { name: 'Full-screen wall preview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close full-screen preview' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('toggles to the whiteboard takeover preview (?mode=whiteboard) and hides the legend control', async () => {
    const calls = renderPreview();
    await screen.findByText('Forklift operator');
    fireEvent.click(screen.getByRole('radio', { name: 'Whiteboard' }));
    expect(await screen.findByText('Welcome back, Jordan')).toBeTruthy();
    expect(calls).toContain('GET /api/branches/br_north/wall/preview?mode=whiteboard');
    expect(screen.getByRole('region', { name: 'Northfield morning whiteboard' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show legend' })).toBeNull();
    expect(screen.getByText(/Outside the window displays never receive whiteboard content/)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Board' }));
    expect(await screen.findByText('Forklift operator')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show legend' })).toBeTruthy();
  });
});
