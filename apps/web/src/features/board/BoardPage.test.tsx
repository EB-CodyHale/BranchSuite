import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { branch, jsonResponse, meResponse } from '../../test/fixtures.js';
import { toolbarStorageKey } from './boardModel.js';
import { boardOf, line, order, renderBoardPage } from './testHarness.js';

const singleBranch = (role: 'manager' | 'member' = 'manager') =>
  meResponse({ user: { role, branchIds: ['br_north'] }, branches: [branch('br_north', 'Northfield')] });

/** Account headings of the cards, in visual order. */
const cardTitles = () => screen.getAllByRole('article').map((a) => within(a).getByRole('heading', { level: 3 }).firstChild?.textContent);

const ORDERS = [
  // 1 to fill, oldest
  order({ id: 'o_maple', accountId: 'acc_maple', role: 'Loader', createdAt: '2026-02-01T10:00:00.000Z', openings: [line('m1'), line('m2', { state: 'committed', initials: 'TS', writtenBy: 'usr_blake' })] }),
  // 3 to fill, newest
  order({ id: 'o_lake', accountId: 'acc_lakeside', role: 'Forklift operator', createdAt: '2026-03-01T10:00:00.000Z', openings: [line('l1'), line('l2'), line('l3')] }),
  // 2 to fill, middle
  order({ id: 'o_lake2', accountId: 'acc_lakeside', role: 'Picker', unitId: 'unit_dock', createdAt: '2026-02-15T10:00:00.000Z', openings: [line('p1'), line('p2')] }),
];

describe('BoardPage', () => {
  it('shows the header rail with scope totals and metric chips', async () => {
    renderBoardPage({ me: singleBranch(), board: boardOf(ORDERS) });
    expect(screen.getByRole('heading', { level: 1, name: 'Job order board' })).toBeTruthy();
    await screen.findAllByRole('article');
    expect(screen.getByText(/Northfield/).textContent).toBe('Northfield · 6 to fill of 7');
    const totals = screen.getByRole('group', { name: /Board totals/ });
    expect(within(totals).getByRole('button', { name: /6\s*To fill/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Wall preview' }).getAttribute('href')).toBe('/board/wall-preview');
  });

  it('sorts by most to fill by default and re-sorts from the toolbar', async () => {
    renderBoardPage({ me: singleBranch(), board: boardOf(ORDERS) });
    await screen.findAllByRole('article');
    expect(cardTitles()).toEqual(['Lakeside Foods', 'Lakeside Foods', 'Maple Freight']);
    expect(screen.getAllByRole('article').map((a) => a.dataset.orderId)).toEqual(['o_lake', 'o_lake2', 'o_maple']);

    fireEvent.click(screen.getByRole('radio', { name: 'Open longest' }));
    expect(screen.getAllByRole('article').map((a) => a.dataset.orderId)).toEqual(['o_maple', 'o_lake2', 'o_lake']);

    // Account sort groups consecutive orders under an account heading.
    fireEvent.click(screen.getByRole('radio', { name: 'Account' }));
    const groups = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(groups[0]).toMatch(/Lakeside Foods2 orders · 5 to fill$/);
    expect(groups[1]).toMatch(/Maple Freight1 order · 1 to fill$/);

    // Choice is remembered per user.
    expect(JSON.parse(localStorage.getItem(toolbarStorageKey('usr_avery'))!).sort).toBe('account');
  });

  it('restores the saved toolbar state', async () => {
    localStorage.setItem(toolbarStorageKey('usr_avery'), JSON.stringify({ sort: 'age', view: 'list' }));
    renderBoardPage({ me: singleBranch(), board: boardOf(ORDERS) });
    const table = await screen.findByRole('table');
    expect((screen.getByRole('radio', { name: 'Open longest' }) as HTMLElement).getAttribute('aria-checked')).toBe('true');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[3]!.textContent)).toEqual(['Loader', 'Picker', 'Forklift operator']);
  });

  it('filters with search, quick metric chips and the owner filter', async () => {
    renderBoardPage({ me: singleBranch(), board: boardOf(ORDERS) });
    await screen.findAllByRole('article');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search orders' }), { target: { value: 'dock' } });
    await waitFor(() => expect(screen.getAllByRole('article').map((a) => a.dataset.orderId)).toEqual(['o_lake2']));
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3));

    // Owner: Lakeside is owned by Blake; Maple has no owner.
    fireEvent.click(screen.getByRole('button', { name: 'Owner: All owners' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Unowned/ }));
    expect(screen.getAllByRole('article').map((a) => a.dataset.orderId)).toEqual(['o_maple']);
    fireEvent.click(screen.getByRole('button', { name: 'Owner: Unowned' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Blake Ortiz/ }));
    expect(screen.getAllByRole('article').map((a) => a.dataset.orderId)).toEqual(['o_lake', 'o_lake2']);

    // A metric that matches nothing shows the "nothing matches" state with a reset.
    fireEvent.click(screen.getByRole('button', { name: /Pencils/ }));
    expect(screen.getByRole('heading', { name: 'Nothing matches these filters' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('hides paused orders until "Show paused" is on', async () => {
    const paused = order({ id: 'o_paused', accountId: 'acc_maple', status: 'paused', pause: { reason: 'Client freeze', at: '2026-03-01T00:00:00.000Z', by: 'usr_avery', resumeOn: null } });
    renderBoardPage({ me: singleBranch(), board: boardOf([...ORDERS, paused]) });
    await screen.findAllByRole('article');
    expect(screen.queryByText(/Paused · Client freeze/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show paused' }));
    expect(screen.getByText(/Paused · Client freeze/)).toBeTruthy();
  });

  it('gives managers the drafts tray, New order and the full card menu', async () => {
    const draft = order({ id: 'o_draft', status: 'draft', source: 'email', accountId: 'acc_maple', role: 'Sorter' });
    const { calls } = renderBoardPage({
      me: singleBranch('manager'),
      board: boardOf([...ORDERS, draft]),
      handlers: { 'POST /api/branches/br_north/orders/o_draft/publish': () => jsonResponse({ ...draft, status: 'active' }) },
    });
    await screen.findAllByRole('article');
    const tray = screen.getByRole('region', { name: /Needs review/ });
    expect(within(tray).getByText(/Sorter/)).toBeTruthy();
    // Drafts never appear as board cards.
    expect(screen.getAllByRole('article').map((a) => a.dataset.orderId)).not.toContain('o_draft');
    expect(screen.getByRole('button', { name: 'New order' })).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /^Order actions/ })[0]!);
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit order', 'Add openings', 'Pause', 'Close order', 'History']);
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(within(tray).getByRole('button', { name: /^Publish/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/o_draft/publish'))).toBe(true));
    expect(await screen.findByText('Order published')).toBeTruthy();
  });

  it('hides drafts and manager-only controls from members', async () => {
    const draft = order({ id: 'o_draft', status: 'draft', source: 'email', accountId: 'acc_maple', role: 'Sorter' });
    renderBoardPage({ me: singleBranch('member'), board: boardOf([...ORDERS, draft]) });
    await screen.findAllByRole('article');
    expect(screen.queryByRole('region', { name: /Needs review/ })).toBeNull();
    expect(screen.queryByText(/Sorter/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'New order' })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: /^Order actions/ })[0]!);
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['History']);
    fireEvent.keyDown(document, { key: 'Escape' });

    // Members still write on lines, but cannot remove them.
    fireEvent.click(screen.getAllByRole('button', { name: /^Line 1: open/ })[0]!);
    const pop = screen.getByRole('dialog', { name: 'Line 1' });
    expect(within(pop).queryByRole('button', { name: 'Remove this line' })).toBeNull();
  });

  it('shows branch chips and a branch badge per card when several branches are in scope', async () => {
    const south = order({ id: 'o_south', branchId: 'br_south', accountId: 'acc_orbit', role: 'Clerk', roleCategory: 'clerical' });
    renderBoardPage({ board: boardOf([...ORDERS, south]) });
    await screen.findAllByRole('article');
    expect(screen.getByText(/All branches/)).toBeTruthy();
    const chips = screen.getByRole('group', { name: 'Branches' });
    fireEvent.click(within(chips).getByRole('button', { name: 'Southport' }));
    const cards = screen.getAllByRole('article');
    expect(cards.map((a) => a.dataset.orderId)).toEqual(['o_south']);
    expect(within(cards[0]!).getByText('Southport')).toBeTruthy();
  });

  it('shows an empty state when the branch has no orders', async () => {
    renderBoardPage({ me: singleBranch(), board: boardOf([]) });
    expect(await screen.findByRole('heading', { name: 'No open orders' })).toBeTruthy();
  });

  it('shows an error state and retries', async () => {
    let fail = true;
    renderBoardPage({
      me: singleBranch(),
      board: () => (fail ? jsonResponse({ error: { code: 'internal', message: 'Database unavailable' } }, 500) : jsonResponse(boardOf(ORDERS))),
    });
    expect(await screen.findByText('Database unavailable')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByRole('article')).toHaveLength(3);
  });

  it('switches to the list view and expands a row to show its lines', async () => {
    renderBoardPage({ me: singleBranch(), board: boardOf(ORDERS) });
    await screen.findAllByRole('article');
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    const table = screen.getByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'To fill' }));
    expect(within(table).getByRole('columnheader', { name: /To fill/ }).getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(within(table).getByRole('button', { name: 'Show lines for Maple Freight Loader' }));
    const lines = within(table).getByRole('list', { name: 'Lines for Maple Freight Loader' });
    expect(within(lines).getAllByRole('listitem')).toHaveLength(2);
  });

  it('only re-renders the card whose order changed', async () => {
    const { client } = renderBoardPage({ me: singleBranch(), board: boardOf(ORDERS) });
    await screen.findAllByRole('article');
    const before = screen.getAllByRole('article');
    const untouched = before.find((a) => a.dataset.orderId === 'o_maple')!;
    const untouchedHtml = untouched.innerHTML;
    // Simulate an optimistic write to another order.
    const key = client.getQueryCache().findAll({ queryKey: ['board'] })[0]!.queryKey;
    client.setQueryData(key, (b: ReturnType<typeof boardOf>) => ({
      ...b,
      orders: b.orders.map((o) =>
        o.id === 'o_lake' ? { ...o, updatedAt: '2026-03-02T18:00:00.000Z', openings: o.openings.map((l, i) => (i === 0 ? { ...l, state: 'committed' as const, initials: 'ZZ', writtenBy: 'usr_casey' } : l)) } : o,
      ),
    }));
    await screen.findByText('ZZ');
    expect(untouched.isConnected).toBe(true);
    expect(untouched.innerHTML).toBe(untouchedHtml);
  });
});

describe('order form', () => {
  it('validates pay rate and creates an order with the chosen account and unit', async () => {
    const created = order({ id: 'o_new', accountId: 'acc_lakeside', unitId: 'unit_dock', role: 'Packer' });
    const { calls } = renderBoardPage({
      me: singleBranch(),
      board: boardOf(ORDERS),
      handlers: { 'POST /api/branches/br_north/orders': () => jsonResponse(created, 201) },
    });
    await screen.findAllByRole('article');
    fireEvent.click(screen.getByRole('button', { name: 'New order' }));
    const dialog = screen.getByRole('dialog', { name: 'New order' });

    fireEvent.change(within(dialog).getByRole('combobox', { name: /Account/ }), { target: { value: 'acc_lakeside' } });
    const unit = within(dialog).getByRole('combobox', { name: 'Unit' }) as HTMLSelectElement;
    expect(Array.from(unit.options).map((o) => o.textContent)).toEqual(['Whole account', 'Lakeside Foods › Dock B']);
    fireEvent.change(unit, { target: { value: 'unit_dock' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Role/ }), { target: { value: 'Packer' } });
    fireEvent.change(within(dialog).getByLabelText('Pay rate ($/hr)'), { target: { value: '0' } });
    fireEvent.change(within(dialog).getByLabelText(/Openings/), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create order' }));
    expect(within(dialog).getByText('Pay rate must be greater than $0.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(within(dialog).getByLabelText('Pay rate ($/hr)'), { target: { value: '18.5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create order' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      accountId: 'acc_lakeside',
      unitId: 'unit_dock',
      role: 'Packer',
      payRate: 18.5,
      openingCount: 3,
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New order' })).toBeNull());
  });

  it('focuses one order from an inbox deep link (?order=) and clears back to the whole board', async () => {
    renderBoardPage({ me: singleBranch(), board: boardOf(ORDERS), path: '/?order=o_maple' });
    await screen.findAllByRole('article');
    expect(screen.getAllByRole('article').map((a) => a.dataset.orderId)).toEqual(['o_maple']);
    expect(screen.getByText('Showing one order: Maple Freight · Loader.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole board' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3));
  });

  it('points a deep-linked draft at Needs review for managers', async () => {
    const draft = order({ id: 'o_draft', accountId: 'acc_maple', role: 'Sorter', status: 'draft', openings: [line('d1')] });
    renderBoardPage({ me: singleBranch(), board: boardOf([...ORDERS, draft]), path: '/?order=o_draft' });
    expect(await screen.findByText(/Maple Freight · Sorter is a draft from email/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Needs review' })).toBeTruthy();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('explains an order that is not on the board', async () => {
    renderBoardPage({ me: singleBranch('member'), board: boardOf(ORDERS), path: '/?order=o_missing' });
    expect(await screen.findByText(/That order is not on the board in this branch scope/)).toBeTruthy();
    expect(screen.queryByText('Nothing matches these filters')).toBeNull();
  });

  it('shows one account from a pipeline deep link (?account=), ignoring saved filters', async () => {
    renderBoardPage({ me: singleBranch(), board: boardOf(ORDERS), path: '/?account=acc_lakeside' });
    await screen.findAllByRole('article');
    expect(screen.getAllByRole('article').map((a) => a.dataset.orderId).sort()).toEqual(['o_lake', 'o_lake2']);
    expect(screen.getByText('Showing Lakeside Foods only: 2 orders.')).toBeTruthy();
  });
});
