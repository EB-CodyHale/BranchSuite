import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaLoaderContext } from './media.js';
import { fullView } from './testFixtures.js';
import { WhiteboardSlide } from './WhiteboardSlide.js';

describe('WhiteboardSlide', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:wb-test');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders every block kind with accessible text', async () => {
    const loader = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
    render(
      <MediaLoaderContext.Provider value={loader}>
        <WhiteboardSlide view={fullView()} branchName="Northfield" timeZone="America/Chicago" frame="embedded" />
      </MediaLoaderContext.Provider>,
    );

    const region = screen.getByRole('region', { name: 'Northfield morning whiteboard' });
    expect(within(region).getByRole('heading', { level: 1, name: 'Morning huddle' })).toBeTruthy();
    expect(screen.getByText('Huddle 7:30–8:15')).toBeTruthy();
    expect(screen.getByText('Monday, March 2')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();

    // talking points
    const tp = screen.getByRole('region', { name: 'Talking points' });
    expect(within(tp).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1Welcome back, Jordan', '2Badge photos at 10']);

    // assignments: person name + initials, done ticked, unassigned = Team
    const as = screen.getByRole('region', { name: 'Assignments' });
    expect(within(as).getByText('Blake Ortiz')).toBeTruthy();
    expect(within(as).getByText('BO')).toBeTruthy();
    expect(within(as).getByText('Done')).toBeTruthy();
    expect(within(as).getByText('Team')).toBeTruthy();

    // priority orders: glyph with spoken code, label, role · shift, to fill, starting soon
    const po = screen.getByRole('region', { name: 'Priority orders' });
    expect(within(po).getByRole('img', { name: 'blue diamond K7' })).toBeTruthy();
    expect(within(po).getByText('Lakeside Foods')).toBeTruthy();
    expect(within(po).getByText('Forklift operator · 2nd shift')).toBeTruthy();
    expect(within(po).getByText('4')).toBeTruthy();
    expect(within(po).getByText('to fill')).toBeTruthy();
    expect(within(po).getByText('2 starting soon')).toBeTruthy();
    expect(within(po).getByText('Client visit Thursday')).toBeTruthy();

    // image: fetched through the loader, shown via an object URL with alt text
    expect(loader).toHaveBeenCalledWith('/api/wall/media/med_1', expect.any(AbortSignal));
    const img = await screen.findByRole('img', { name: 'Fill rate by week' });
    expect(img.getAttribute('src')).toBe('blob:wb-test');
    expect(screen.getByText('Fill rate by week', { selector: 'figcaption' })).toBeTruthy();

    // note: tone has an icon and a label (never color only), bullets render as a list
    const note = screen.getByRole('region', { name: 'Safety' });
    expect(within(note).getByText('Wear high-vis on the dock')).toBeTruthy();
    expect(within(note).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Gloves on', 'Eyes up']);
    expect(note.querySelector('svg')).toBeTruthy();

    // metrics: label + big number pairs
    const m = screen.getByRole('region', { name: "Today's numbers" });
    const terms = within(m).getAllByRole('term').map((t) => t.textContent);
    const values = within(m).getAllByRole('definition').map((d) => d.textContent);
    expect(Object.fromEntries(terms.map((t, i) => [t, values[i]]))).toMatchObject({ 'To fill': '17', 'Open orders': '9', 'Starting soon': '5', 'Aging orders': '2' });
  });

  it('shows a friendly empty state', () => {
    render(<WhiteboardSlide view={{ ...fullView(), blocks: [], isLive: false }} branchName="Northfield" timeZone="America/Chicago" frame="embedded" />);
    expect(screen.getByText('Nothing on the whiteboard yet.')).toBeTruthy();
    expect(screen.queryByText('Live')).toBeNull();
  });

  it('revokes the object URL when the image goes away', async () => {
    const loader = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
    const view = fullView();
    const { rerender } = render(
      <MediaLoaderContext.Provider value={loader}>
        <WhiteboardSlide view={view} branchName="Northfield" timeZone="America/Chicago" frame="embedded" />
      </MediaLoaderContext.Provider>,
    );
    await screen.findByRole('img', { name: 'Fill rate by week' });
    rerender(
      <MediaLoaderContext.Provider value={loader}>
        <WhiteboardSlide view={{ ...view, blocks: view.blocks.filter((b) => b.kind !== 'image') }} branchName="Northfield" timeZone="America/Chicago" frame="embedded" />
      </MediaLoaderContext.Provider>,
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wb-test');
  });
});
