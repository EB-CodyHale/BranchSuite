import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { board, branch, jsonResponse, order } from '../../test/fixtures.js';
import { DisplaysSection, displayStatus, PairingCodeInput } from './DisplaysSection.js';
import { formatPairingCode, isCompletePairingCode } from './pairingCode.js';
import { fullAccount, managerMe, renderSetup } from './testHarness.js';
import { CompactWallPreview, previewFeed } from './WallPreviewPanel.js';
import { payBandErrors, WallSettingsForm } from './WallSettingsSection.js';

// The wall feature's TV renderer is exercised by its own tests; here a stub keeps jsdom simple.
vi.mock('../wall/WallBoard.js', () => ({ WallBoard: ({ feed }: { feed: { orders: unknown[] } }) => <div data-testid="tv-board">{feed.orders.length} tv orders</div> }));
vi.mock('../wall/ScaledFrame.js', () => ({ ScaledFrame: ({ children }: { children: React.ReactNode }) => <figure>{children}</figure> }));

describe('pairing code', () => {
  it('uppercases, strips and inserts the dash', () => {
    expect(formatPairingCode('k7q29m')).toBe('K7Q-29M');
    expect(formatPairingCode('k7')).toBe('K7');
    expect(formatPairingCode('k7q')).toBe('K7Q');
    expect(formatPairingCode('k7q2')).toBe('K7Q-2');
    expect(formatPairingCode(' K7Q - 29M 88 ')).toBe('K7Q-29M');
    expect(isCompletePairingCode('K7Q-29M')).toBe(true);
    expect(isCompletePairingCode('K7Q-29')).toBe(false);
  });

  it('formats as the user types', () => {
    let value = '';
    const { rerender } = renderSetup(<PairingCodeInput value={value} onChange={(v) => (value = v)} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Code on the TV' }), { target: { value: 'k7q2' } });
    expect(value).toBe('K7Q-2');
    rerender(<PairingCodeInput value={value} onChange={(v) => (value = v)} />);
    expect((screen.getByRole('textbox', { name: 'Code on the TV' }) as HTMLInputElement).value).toBe('K7Q-2');
  });

  it('pairs a display and shows the success state', async () => {
    const { calls } = renderSetup(<DisplaysSection />, {
      me: managerMe(),
      handlers: {
        'GET /api/branches/br_north/displays': () => jsonResponse([]),
        'POST /api/branches/br_north/displays/claim': (body) =>
          jsonResponse({ id: 'dsp_1', branchId: 'br_north', name: (body as { name: string }).name, tokenPrefix: 'a1b2c3', lastSeenAt: null, revokedAt: null, createdAt: '2026-03-02T15:00:00.000Z', updatedAt: '2026-03-02T15:00:00.000Z', createdBy: null, updatedBy: null }, 201),
      },
    });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Pair a display' }))[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Pair a display' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pair display' }));
    expect(within(dialog).getByText('Enter all six characters.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Code on the TV' }), { target: { value: 'k7q29m' } });
    expect((within(dialog).getByRole('textbox', { name: 'Code on the TV' }) as HTMLInputElement).value).toBe('K7Q-29M');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pair display' }));
    expect(await screen.findByRole('dialog', { name: 'Display paired' })).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ code: 'K7Q-29M', name: 'Lobby TV' });
  });

  it('describes display status in words', () => {
    const base = { id: 'd', branchId: 'b', name: 'TV', tokenPrefix: 'x', createdAt: '', updatedAt: '', createdBy: null, updatedBy: null };
    const now = new Date('2026-03-02T15:00:00.000Z');
    expect(displayStatus({ ...base, lastSeenAt: null, revokedAt: '2026-03-01T00:00:00.000Z' }, now).label).toBe('Revoked');
    expect(displayStatus({ ...base, lastSeenAt: null, revokedAt: null }, now).label).toBe('Never connected');
    expect(displayStatus({ ...base, lastSeenAt: '2026-03-02T14:58:00.000Z', revokedAt: null }, now).label).toBe('Online');
    expect(displayStatus({ ...base, lastSeenAt: '2026-03-02T10:00:00.000Z', revokedAt: null }, now).label).toBe('Offline');
  });
});

describe('wall settings', () => {
  const north = branch('br_north', 'Northfield');
  const lake = fullAccount('acc_lakeside', 'Lakeside Foods', { wall: { code: 'K7', color: 'w1', glyph: 'diamond' } });
  const boardData = { ...board([order({ payRate: 21.5 })]), accounts: [lake] };

  it('warns strongly when client names would be public, and the live preview shows the unsaved choice', async () => {
    renderSetup(<WallSettingsForm branch={north} />, { me: managerMe(), handlers: { 'GET /api/board?branches=br_north': () => jsonResponse(boardData) } });
    expect(screen.queryByText('Client names will be public')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    const previewList = await screen.findByRole('list', { name: 'Orders the public would see' });
    expect(within(previewList).queryByText(/Lakeside Foods/)).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Name' }));
    const warning = screen.getByText('Client names will be public').closest('[role="alert"]');
    expect(warning?.textContent).toMatch(/who you staff for/);
    expect(within(screen.getByRole('list', { name: 'Orders the public would see' })).getByText(/Lakeside Foods/)).toBeTruthy();
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
  });

  it('edits pay bands, blocks invalid bands and saves the full settings', async () => {
    const { calls } = renderSetup(<WallSettingsForm branch={north} />, {
      me: managerMe(),
      handlers: {
        'GET /api/board?branches=br_north': () => jsonResponse(boardData),
        'PATCH /api/branches/br_north': (body) => jsonResponse({ ...north, wall: { ...north.wall, ...(body as { wall: object }).wall } }),
      },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Band' }));
    expect(screen.getAllByRole('spinbutton', { name: /From/ })).toHaveLength(3);
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Label' })[1]!, { target: { value: '' } });
    expect(screen.getByText('Every band needs a label, like $ or $$.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save wall settings' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Label' })[1]!, { target: { value: '$$' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save wall settings' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const wall = (calls.find((c) => c.method === 'PATCH')!.body as { wall: Record<string, unknown> }).wall;
    expect(wall.payDisplay).toBe('band');
    expect(wall.payBands).toEqual([
      { min: 0, label: '$' },
      { min: 18, label: '$$' },
      { min: 22, label: '$$$' },
    ]);
    expect(wall.clientDisplay).toBe('code');
  });

  it('band rules', () => {
    expect(payBandErrors([{ min: 0, label: '$' }, { min: 0, label: '$$' }])).toEqual(['Each band must start above the one before it.']);
    expect(payBandErrors([])).toEqual(['Add at least one band.']);
  });

  it('preview feed uses the shared privacy rules', () => {
    const feed = previewFeed(north, { ...north.wall, payDisplay: 'exact' }, boardData, new Date('2026-03-02T15:00:00.000Z'));
    expect(feed.orders[0]?.pay).toBe('$21.50/hr');
    expect(feed.orders[0]?.clientName).toBeNull();
    expect(feed.orders[0]?.key).toBe('ord_1'.slice(-6));
    renderSetup(<CompactWallPreview feed={feed} />);
    expect(screen.getByText(/\$21\.50\/hr/)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'blue diamond K7' })).toBeTruthy();
  });

  it('renders the wall TV board in the default view', async () => {
    renderSetup(<WallSettingsForm branch={north} />, { me: managerMe(), handlers: { 'GET /api/board?branches=br_north': () => jsonResponse(boardData) } });
    expect((await screen.findByTestId('tv-board')).textContent).toBe('1 tv orders');
  });
});
