import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { opening, wallFeed, wallOrder } from './testFeed.js';
import { WallBoard } from './WallBoard.js';

function jobs() {
  return screen.getByRole('list', { name: /^Jobs/ });
}

describe('WallBoard', () => {
  it('draws every opening state as a symbol with spoken text', () => {
    const order = wallOrder({
      openings: [opening('open'), opening('tentative'), opening('committed', null, true), opening('started')],
      toFill: 2,
    });
    render(<WallBoard feed={wallFeed([order])} frame="embedded" />);
    const tile = within(jobs());
    const openings = within(tile.getByRole('list', { name: 'Openings' }));
    expect(openings.getAllByRole('listitem')).toHaveLength(4);
    expect(openings.getByText('Open').className).toContain('sr-only');
    expect(openings.getByText('Pending').className).toContain('sr-only');
    expect(openings.getByText('Filled, starts soon').className).toContain('sr-only');
    expect(openings.getByText('Started').className).toContain('sr-only');
    expect(tile.getByText('4 openings: 1 open, 1 pending, 1 filled, 1 started')).toBeTruthy();
    expect(tile.getByText('Starts soon')).toBeTruthy();
    // Distinct shapes, not just colors.
    const states = Array.from(document.querySelectorAll('[data-state]')).map((el) => el.getAttribute('data-state'));
    expect(states.slice(0, 4)).toEqual(['open', 'tentative', 'committed', 'started']);
  });

  it('shows codes and no client names without a legend', () => {
    const { container } = render(<WallBoard feed={wallFeed([wallOrder()])} frame="embedded" />);
    expect(within(jobs()).getByText('K7')).toBeTruthy();
    expect(screen.queryByText(/staff only/i)).toBeNull();
    expect(container.textContent).not.toMatch(/Lakeside/);
    // Public-friendly legend strip.
    const key = within(screen.getByRole('list', { name: 'Symbol key' }));
    for (const word of ['Open', 'Pending', 'Filled', 'Started']) expect(key.getByText(word)).toBeTruthy();
  });

  it('overlays legend names, marked STAFF ONLY, when a legend is given', () => {
    render(<WallBoard feed={wallFeed([wallOrder()])} legend={new Map([['K7', 'Lakeside Foods']])} frame="embedded" />);
    expect(screen.getByText('Lakeside Foods')).toBeTruthy();
    expect(screen.getAllByText(/staff only/i).length).toBeGreaterThan(0);
  });

  it('renders initials inside symbols when the feed carries marks', () => {
    render(<WallBoard feed={wallFeed([wallOrder({ openings: [opening('committed', 'AQ'), opening('started', 'BO')] })])} frame="embedded" />);
    expect(screen.getByText('Filled (AQ)')).toBeTruthy();
    expect(screen.getByText('Started (BO)')).toBeTruthy();
    expect(document.querySelector('svg text')?.textContent).toBe('AQ');
  });

  it('shows pay and location only when present, plus hot and paused labels', () => {
    const { rerender } = render(<WallBoard feed={wallFeed([wallOrder()])} frame="embedded" />);
    expect(screen.queryByText(/\$/)).toBeNull();
    rerender(<WallBoard feed={wallFeed([wallOrder({ pay: '$$', location: 'Dock B', isPriority: true, paused: true })])} frame="embedded" />);
    const tile = within(jobs());
    expect(tile.getByText('$$')).toBeTruthy();
    expect(tile.getByText('Dock B')).toBeTruthy();
    expect(tile.getByText('Hot')).toBeTruthy();
    expect(tile.getByText('Paused')).toBeTruthy();
  });

  it('shows the header totals, headline and branch name', () => {
    const feed = wallFeed([wallOrder(), wallOrder({ key: 'k_2', toFill: 3 })]);
    feed.totals.startingSoon = 6;
    render(<WallBoard feed={feed} frame="embedded" />);
    expect(screen.getByRole('heading', { name: 'Riverbend' })).toBeTruthy();
    expect(screen.getByText('Now hiring — ask the front desk')).toBeTruthy();
    const totals = document.querySelector('[data-wall-totals]')!;
    expect(totals.textContent).toContain('5openings');
    expect(totals.textContent).toContain('6starting soon');
  });

  it('uses its own theme, independent of the app theme', () => {
    const { container, rerender } = render(<WallBoard feed={wallFeed()} frame="embedded" />);
    expect(container.querySelector('[data-wall-root]')?.getAttribute('data-theme')).toBe('night');
    const light = wallFeed();
    light.settings.theme = 'light';
    rerender(<WallBoard feed={light} frame="embedded" />);
    expect(container.querySelector('[data-wall-root]')?.getAttribute('data-theme')).toBe('daylight');
  });

  it('collapses very long opening lists into "+N more"', () => {
    const openings = Array.from({ length: 40 }, () => opening('open'));
    render(<WallBoard feed={wallFeed([wallOrder({ openings, toFill: 40 })])} frame="embedded" />);
    expect(screen.getByText('+17 more')).toBeTruthy();
    expect(screen.getByText('40 openings: 40 open')).toBeTruthy();
  });

  it('says so calmly when there is nothing to show', () => {
    render(<WallBoard feed={wallFeed([])} frame="embedded" />);
    expect(screen.getByText('No open positions right now')).toBeTruthy();
  });
});

describe('WallBoard paging', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** jsdom has no layout: give the board a 1080p root, an 800px-tall stage and 300px tiles. */
  function mockLayout() {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-wall-root')) return 1920;
      if (this.hasAttribute('data-wall-stage')) return 1872;
      return 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-wall-root')) return 1080;
      if (this.hasAttribute('data-wall-stage')) return 800;
      return 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-wall-measure') ? 300 : 0;
    });
  }

  it('splits tiles into pages that fit and rotates every pageSeconds', async () => {
    vi.useFakeTimers();
    mockLayout();
    // 4 columns at 1080p, 2 rows of 300px fit in 800px → 8 tiles per page.
    const orders = Array.from({ length: 10 }, (_, i) => wallOrder({ key: `k_${i}`, role: `Role ${i}` }));
    const feed = wallFeed(orders, { settings: { ...wallFeed().settings, pageSeconds: 10 } });
    render(<WallBoard feed={feed} frame="embedded" />);

    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    expect(within(jobs()).getAllByRole('article')).toHaveLength(8);
    expect(within(jobs()).getByText('Role 0')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    expect(within(jobs()).getAllByRole('article')).toHaveLength(2);
    expect(within(jobs()).getByText('Role 9')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
  });

  it('does not rotate or show a pager when everything fits', async () => {
    vi.useFakeTimers();
    mockLayout();
    render(<WallBoard feed={wallFeed([wallOrder(), wallOrder({ key: 'k_2' })])} frame="embedded" />);
    expect(screen.queryByText(/Page \d of/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(within(jobs()).getAllByRole('article')).toHaveLength(2);
  });
});
