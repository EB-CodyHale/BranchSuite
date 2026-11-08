import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { jsonResponse, meResponse } from '../../test/fixtures.js';
import { boardOf, candidate, line, order, renderPipeline, stageResult } from './testHarness.js';

const STAGE_URL = '/api/branches/br_north/candidates/cand_jamie/stage';

async function openMoveMenu(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Move ${name} to…` }));
  return screen.findByRole('menu', { name: `Move ${name} to` });
}

function columnOf(stageLabel: string) {
  return screen.getByRole('region', { name: new RegExp(`^${stageLabel},`) });
}

describe('pipeline board', () => {
  it('keeps the stage scroller a positioned containing block so sr-only column labels cannot widen the page', async () => {
    renderPipeline({ board: boardOf([order()]), candidates: { br_north: [candidate()] } });
    const scroller = await screen.findByRole('region', { name: 'Pipeline stages' });
    // jsdom has no layout: assert the class that makes the absolutely positioned sr-only spans
    // inside each column anchor to (and be clipped by) this overflow-x scroller instead of <body>.
    expect(scroller.className.split(/\s+/)).toContain('relative');
    expect(scroller.className).toContain('overflow-x-auto');
    expect(scroller.querySelector('.sr-only')).toBeTruthy();
  });

  it('renders stage columns with counts and a candidate card with its linked order and line status', async () => {
    const jamie = candidate({ stage: 'screened', accountId: 'acc_lakeside', orderId: 'ord_1', openingId: 'op_1', startDate: '2026-03-03' });
    const held = order({ openings: [line('op_1', { state: 'tentative', initials: 'JL', candidateId: 'cand_jamie' }), line('op_2')] });
    renderPipeline({ board: boardOf([held]), candidates: { br_north: [jamie, candidate({ id: 'cand_dev', firstName: 'Dev', lastName: 'Ramsey', initials: 'DR' })] } });

    const card = (await screen.findByRole('heading', { name: 'Jamie Lowell' })).closest('article')!;
    expect(within(card).getByText('Lakeside Foods')).toBeTruthy();
    expect(within(card).getByText('Forklift operator · 2nd')).toBeTruthy();
    expect(within(card).getByText('Pencil')).toBeTruthy();
    expect(within(card).getByText('Starts 3/3')).toBeTruthy();
    expect(within(card).getByText('AQ')).toBeTruthy();

    expect(within(columnOf('Screened')).getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Screened, 1 candidate' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Sourced, 1 candidate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Show Dropped column, 0 candidates/ })).toBeTruthy();
  });

  it("defaults to the viewer's candidates and can show everyone", async () => {
    renderPipeline({
      candidates: { br_north: [candidate(), candidate({ id: 'cand_ivy', firstName: 'Ivy', lastName: 'Kowal', initials: 'IK', recruiterId: 'usr_blake' })] },
    });
    await screen.findByRole('heading', { name: 'Jamie Lowell' });
    expect(screen.queryByRole('heading', { name: 'Ivy Kowal' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Recruiter' }), { target: { value: 'all' } });
    expect(await screen.findByRole('heading', { name: 'Ivy Kowal' })).toBeTruthy();
  });

  it('moves a candidate through the Move to… menu', async () => {
    const jamie = candidate();
    const { calls } = renderPipeline({ candidates: { br_north: [jamie] }, handlers: { [`POST ${STAGE_URL}`]: stageResult(jamie) } });
    const menu = await openMoveMenu('Jamie Lowell');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Submitted' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === STAGE_URL)).toBe(true));
    expect(calls.find((c) => c.url === STAGE_URL)!.body).toEqual({ stage: 'submitted' });
    await waitFor(() => expect(within(columnOf('Submitted')).getByRole('heading', { name: 'Jamie Lowell' })).toBeTruthy());
    expect(await screen.findByText('Jamie Lowell moved to Submitted')).toBeTruthy();
  });

  it('requires a drop reason before dropping', async () => {
    const jamie = candidate();
    const { calls } = renderPipeline({ candidates: { br_north: [jamie] }, handlers: { [`POST ${STAGE_URL}`]: stageResult(jamie) } });
    const menu = await openMoveMenu('Jamie Lowell');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Dropped…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Drop Jamie Lowell' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Drop candidate' }));
    expect(await within(dialog).findByText('Choose why the candidate dropped.')).toBeTruthy();
    expect(calls.some((c) => c.url === STAGE_URL)).toBe(false);

    fireEvent.change(within(dialog).getByRole('combobox', { name: /Reason/ }), { target: { value: 'no_show' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note' }), { target: { value: 'Missed two calls' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Drop candidate' }));
    await waitFor(() => expect(calls.find((c) => c.url === STAGE_URL)?.body).toEqual({ stage: 'dropped', dropReason: 'no_show', note: 'Missed two calls' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Drop Jamie Lowell' })).toBeNull());
  });

  it('asks for an optional start date when moving to Offer accepted', async () => {
    const jamie = candidate({ stage: 'interviewing' });
    const { calls } = renderPipeline({ candidates: { br_north: [jamie] }, handlers: { [`POST ${STAGE_URL}`]: stageResult(jamie) } });
    const menu = await openMoveMenu('Jamie Lowell');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Offer accepted' }));

    const dialog = await screen.findByRole('dialog', { name: 'Move to Offer accepted' });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-03-09' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(calls.find((c) => c.url === STAGE_URL)?.body).toEqual({ stage: 'accepted', startDate: '2026-03-09' }));
  });

  it('moves a candidate by drag and drop between columns', async () => {
    const jamie = candidate();
    const { calls } = renderPipeline({ candidates: { br_north: [jamie] }, handlers: { [`POST ${STAGE_URL}`]: stageResult(jamie) } });
    const card = (await screen.findByRole('heading', { name: 'Jamie Lowell' })).closest('article')!;
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(card, { dataTransfer });
    const target = columnOf('Screened');
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(calls.find((c) => c.url === STAGE_URL)?.body).toEqual({ stage: 'screened' }));
  });

  it('shows a branch picker when every branch is in scope', async () => {
    renderPipeline({ candidates: { br_north: [candidate()], br_south: [candidate({ id: 'cand_omar', branchId: 'br_south', firstName: 'Omar', lastName: 'Farouk', initials: 'OF' })] } });
    await screen.findByRole('heading', { name: 'Jamie Lowell' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Pipeline branch' }), { target: { value: 'br_south' } });
    expect(await screen.findByRole('heading', { name: 'Omar Farouk' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Jamie Lowell' })).toBeNull();
  });

  it('filters the board from Openings at a glance', async () => {
    const orders = [order({ id: 'ord_1', accountId: 'acc_lakeside' }), order({ id: 'ord_2', accountId: 'acc_maple', openings: [line('m1')] })];
    renderPipeline({
      board: boardOf(orders),
      candidates: { br_north: [candidate({ accountId: 'acc_lakeside' }), candidate({ id: 'cand_dev', firstName: 'Dev', lastName: 'Ramsey', initials: 'DR', accountId: 'acc_maple' })] },
    });
    const panel = await screen.findByRole('complementary', { name: 'Openings at a glance' });
    await screen.findByRole('heading', { name: 'Jamie Lowell' });
    const lakeside = within(panel).getByRole('button', { name: /^Lakeside Foods: 2 to fill, 1 in process, source 1 more/ });
    fireEvent.click(lakeside);
    expect(lakeside.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('combobox', { name: 'Account' }) as HTMLSelectElement).value).toBe('acc_lakeside');
    expect(screen.getByRole('heading', { name: 'Jamie Lowell' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Dev Ramsey' })).toBeNull();
    // Each account also links to the board, filtered to that account.
    expect(within(panel).getByRole('link', { name: 'Open Lakeside Foods orders on the board' }).getAttribute('href')).toBe('/?account=acc_lakeside');
  });

  it('shows the list view as a table', async () => {
    renderPipeline({ candidates: { br_north: [candidate({ stage: 'onboarding', startDate: '2026-03-10' })] } });
    await screen.findByRole('heading', { name: 'Jamie Lowell' });
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    const table = screen.getByRole('table');
    const row = within(table).getByRole('row', { name: /Jamie Lowell/ });
    expect(within(row).getByText('Starts 3/10')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Stage: Onboarding. Move Jamie Lowell to…' })).toBeTruthy();
  });

  it('adds a candidate with the viewer as default recruiter', async () => {
    const created = candidate({ id: 'cand_new', firstName: 'Rae', lastName: 'Sun', initials: 'RS' });
    const { calls } = renderPipeline({ candidates: { br_north: [] }, handlers: { 'POST /api/branches/br_north/candidates': () => jsonResponse(created, 201) } });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add candidate' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add candidate' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /First name/ }), { target: { value: 'Rae' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Last name/ }), { target: { value: 'Sun' } });
    expect(within(dialog).getByText('Board initials: RS')).toBeTruthy();
    expect((within(dialog).getByRole('combobox', { name: 'Recruiter' }) as HTMLSelectElement).value).toBe('usr_avery');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add candidate' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.url === '/api/branches/br_north/candidates')?.body).toEqual({
        firstName: 'Rae',
        lastName: 'Sun',
        recruiterId: 'usr_avery',
        accountId: null,
        stage: 'sourced',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Rae Sun' })).toBeTruthy();
  });
});

describe('candidate drawer', () => {
  it('opens from a deep link, in the branch that holds the line', async () => {
    const omar = candidate({ id: 'cand_omar', branchId: 'br_south', firstName: 'Omar', lastName: 'Farouk', initials: 'OF', orderId: 'ord_s', openingId: 's1', stage: 'screened' });
    const southOrder = order({ id: 'ord_s', branchId: 'br_south', accountId: 'acc_orbit', role: 'Packer', shift: '1st', openings: [line('s1', { state: 'tentative', initials: 'OF', candidateId: 'cand_omar' })] });
    renderPipeline({ path: '/pipeline?candidate=cand_omar', board: boardOf([southOrder]), candidates: { br_north: [candidate()], br_south: [omar] } });

    const drawer = await screen.findByRole('dialog', { name: 'Omar Farouk' });
    expect(within(drawer).getByText('Packer · 1st')).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Unlink' })).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Pipeline branch' }) as HTMLSelectElement).value).toBe('br_south');
  });

  it('opens an archived candidate from a deep link', async () => {
    renderPipeline({ path: '/pipeline?candidate=cand_gone', candidates: { br_north: [] }, archived: { br_north: [candidate({ id: 'cand_gone', firstName: 'Lee', lastName: 'Gone', initials: 'LG', status: 'archived' })] } });
    const drawer = await screen.findByRole('dialog', { name: 'Lee Gone' });
    expect(within(drawer).getByText(/Archived ·/)).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('opens when a card name is clicked and closes back to the board', async () => {
    const { router } = renderPipeline({ candidates: { br_north: [candidate()] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Jamie Lowell' }));
    expect(await screen.findByRole('dialog', { name: 'Jamie Lowell' })).toBeTruthy();
    expect(router.state.location.search).toBe('?candidate=cand_jamie');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Jamie Lowell' })).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Jamie Lowell' })).toBeNull());
    expect(router.state.location.search).toBe('');
  });

  it('fill an opening lists only open lines of matching orders and links the chosen line', async () => {
    const jamie = candidate({ accountId: 'acc_lakeside' });
    const orders = [
      order({ id: 'ord_1', openings: [line('op_1'), line('op_2', { state: 'tentative', initials: 'DR', candidateId: 'cand_dev' }), line('op_3'), line('op_4', { state: 'committed', initials: 'AB' })] }),
      order({ id: 'ord_full', role: 'Sanitation', openings: [line('f1', { state: 'committed', initials: 'CD' })] }),
      order({ id: 'ord_maple', accountId: 'acc_maple', role: 'Loader', openings: [line('m1')] }),
      order({ id: 'ord_draft', role: 'Picker', status: 'draft', openings: [line('d1')] }),
    ];
    const linked = { ...jamie, orderId: 'ord_1', openingId: 'op_3', updatedAt: '2026-03-02T16:00:00.000Z' };
    const linkedOrder = { ...orders[0]!, openings: orders[0]!.openings.map((l) => (l.id === 'op_3' ? { ...l, state: 'tentative' as const, initials: 'JL', candidateId: 'cand_jamie' } : l)) };
    const { calls } = renderPipeline({
      path: '/pipeline?candidate=cand_jamie',
      board: boardOf(orders),
      candidates: { br_north: [jamie] },
      handlers: { 'POST /api/branches/br_north/candidates/cand_jamie/link': () => jsonResponse({ candidate: linked, orders: [linkedOrder] }) },
    });
    const drawer = await screen.findByRole('dialog', { name: 'Jamie Lowell' });
    const list = within(drawer).getByRole('list', { name: 'Orders with open lines' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(list).queryByText(/Sanitation/)).toBeNull();
    expect(within(list).queryByText(/Loader/)).toBeNull();
    expect(within(list).queryByText(/Picker/)).toBeNull();

    fireEvent.click(within(items[0]!).getByRole('button', { expanded: false }));
    const lineButtons = within(items[0]!).getAllByRole('button', { name: /^Pencil Jamie Lowell onto line/ });
    expect(lineButtons.map((b) => b.textContent)).toEqual(['Line 1', 'Line 3']);

    // Other accounts appear once the account restriction is lifted.
    fireEvent.click(within(drawer).getByRole('checkbox', { name: 'Only Lakeside Foods orders' }));
    expect(within(drawer).getByText(/Loader/)).toBeTruthy();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Pencil Jamie Lowell onto line 3 of Forklift operator · 2nd' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/link'))?.body).toEqual({ orderId: 'ord_1', openingId: 'op_3' }));
    expect(await within(drawer).findByRole('button', { name: 'Unlink' })).toBeTruthy();
    expect(within(drawer).getByText('Line 3 of 4')).toBeTruthy();
  });

  it('derives initials from the name until they are edited by hand, and saves only changes', async () => {
    const jamie = candidate();
    const { calls } = renderPipeline({
      path: '/pipeline?candidate=cand_jamie',
      candidates: { br_north: [jamie] },
      handlers: {
        // The API answers PATCH with a CandidateMutationResult.
        'PATCH /api/branches/br_north/candidates/cand_jamie': (body) => jsonResponse({ candidate: { ...jamie, ...(body as object) }, orders: [] }),
      },
    });
    const drawer = await screen.findByRole('dialog', { name: 'Jamie Lowell' });
    const first = within(drawer).getByRole('textbox', { name: /First name/ });
    const last = within(drawer).getByRole('textbox', { name: 'Last name' });
    const initials = within(drawer).getByRole('textbox', { name: 'Initials' }) as HTMLInputElement;

    fireEvent.change(first, { target: { value: 'Élodie' } });
    expect(initials.value).toBe('EL');
    fireEvent.change(initials, { target: { value: 'ex' } });
    expect(initials.value).toBe('EX');
    fireEvent.change(last, { target: { value: 'Martin' } });
    expect(initials.value).toBe('EX');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Derive initials from the name' }));
    expect(initials.value).toBe('EM');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ firstName: 'Élodie', lastName: 'Martin', initials: 'EM' }));
    expect(await screen.findByText('Candidate saved')).toBeTruthy();
    expect(await screen.findByRole('dialog', { name: 'Élodie Martin' })).toBeTruthy();
  });

  it('shows the stage history with who, note and drop reason', async () => {
    const jamie = candidate({
      stage: 'dropped',
      history: [
        { stage: 'sourced', at: '2026-02-20T15:00:00.000Z', by: 'usr_blake', note: '', dropReason: null },
        { stage: 'dropped', at: '2026-02-25T15:00:00.000Z', by: 'usr_avery', note: 'Took another job', dropReason: 'candidate_withdrew' },
      ],
    });
    renderPipeline({ path: '/pipeline?candidate=cand_jamie', me: meResponse({ pipeline: true, user: { role: 'member' } }), candidates: { br_north: [jamie] } });
    const drawer = await screen.findByRole('dialog', { name: 'Jamie Lowell' });
    const history = within(drawer).getByRole('region', { name: 'Stage history' });
    const items = within(history).getAllByRole('listitem');
    expect(items[0]!.textContent).toContain('Dropped');
    expect(items[0]!.textContent).toContain('Candidate withdrew');
    expect(items[0]!.textContent).toContain('Took another job');
    expect(items[0]!.textContent).toContain('Avery Quinn');
    expect(items[1]!.textContent).toContain('Blake Ortiz');
    expect(within(drawer).getByText(/Move them back to an active stage/)).toBeTruthy();
  });

  it('archives a linked candidate after confirming and refreshes the board', async () => {
    const jamie = candidate({ orderId: 'ord_1', openingId: 'op_1', accountId: 'acc_lakeside' });
    const held = order({ openings: [line('op_1', { state: 'tentative', initials: 'JL', candidateId: 'cand_jamie' })] });
    const released = order({ openings: [line('op_1')] });
    const { calls, client } = renderPipeline({
      path: '/pipeline?candidate=cand_jamie',
      board: boardOf([held]),
      candidates: { br_north: [jamie] },
      handlers: {
        // Archive answers with a CandidateMutationResult that includes the order whose line it released.
        'POST /api/branches/br_north/candidates/cand_jamie/archive': () =>
          jsonResponse({ candidate: { ...jamie, orderId: null, openingId: null, status: 'archived' }, orders: [released] }),
      },
    });
    const drawer = await screen.findByRole('dialog', { name: 'Jamie Lowell' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Archive' }));
    const confirm = await screen.findByRole('dialog', { name: 'Archive Jamie Lowell?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Jamie Lowell' })).toBeNull());
    expect(calls.some((c) => c.url.endsWith('/archive'))).toBe(true);
    // The released line lands in the board cache straight from the response (no refetch needed).
    const boards = client.getQueriesData<{ orders: Array<{ id: string; openings: Array<{ candidateId: string | null }> }> }>({ queryKey: ['board'] });
    const cached = boards.flatMap(([, b]) => b?.orders ?? []).find((o) => o.id === held.id);
    expect(cached?.openings.some((o) => o.candidateId === 'cand_jamie')).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Jamie Lowell' })).toBeNull();
  });
});
