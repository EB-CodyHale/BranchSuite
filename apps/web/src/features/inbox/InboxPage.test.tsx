import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { jsonResponse, order } from '../../test/fixtures.js';
import { boardData, dataTransfer, mailStatus, renderInbox, singleBranchMe, task, tasksOf } from './testHarness.js';

const column = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).closest('section')!;
const cardIds = (section: HTMLElement) => Array.from(section.querySelectorAll('article')).map((a) => a.getAttribute('data-task-id'));

const QUEUE = [
  task({ id: 't_client', title: 'Rate question', category: 'client' }),
  task({ id: 't_assoc', title: 'Timecard fix', category: 'associate', assigneeId: 'usr_blake' }),
  task({ id: 't_ops', title: 'Safety walk', category: 'operations', priority: 'hot', categorySource: 'manual' }),
];

describe('InboxPage queue', () => {
  it('groups open tasks into category columns with counts and card details', async () => {
    renderInbox({ tasks: tasksOf(QUEUE) });
    await screen.findByText('Rate question');
    expect(cardIds(column(/Client communication/))).toEqual(['t_client']);
    expect(cardIds(column(/Associate management/))).toEqual(['t_assoc']);
    expect(cardIds(column(/Branch operations/))).toEqual(['t_ops']);

    const totals = screen.getByRole('group', { name: 'Today’s totals' });
    expect(within(totals).getByText('Open').previousSibling?.textContent).toBe('3');
    expect(within(totals).getByText('Hot').previousSibling?.textContent).toBe('1');
    expect(within(totals).getByText('Unassigned').previousSibling?.textContent).toBe('2');

    const ops = column(/Branch operations/);
    expect(within(ops).getByText('Hot')).toBeTruthy();
    // Manual category: no Auto badge. Auto category on the others.
    expect(within(ops).queryByText('Auto')).toBeNull();
    expect(within(column(/Client communication/)).getByText('Auto')).toBeTruthy();
    // Assignee shows marker initials; unassigned shows Unclaimed.
    expect(within(column(/Associate management/)).getByText('Assigned to Blake Ortiz')).toBeTruthy();
    expect(within(column(/Client communication/)).getByText('Unclaimed')).toBeTruthy();
    expect(within(column(/Client communication/)).getByText('today')).toBeTruthy();
  });

  it('recategorizes a task when it is dropped on another column', async () => {
    const { calls } = renderInbox({
      tasks: tasksOf(QUEUE),
      handlers: { 'PATCH /api/tasks/br_north/t_client': () => jsonResponse({ ...QUEUE[0], category: 'associate', categorySource: 'manual' }) },
    });
    await screen.findByText('Rate question');
    const card = column(/Client communication/).querySelector('article')!;
    expect(card.getAttribute('draggable')).toBe('true');
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    const target = column(/Associate management/);
    fireEvent.dragEnter(target, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    // Lands in the new column at once (optimistic), then the server confirms.
    expect(cardIds(column(/Associate management/))).toContain('t_client');
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeTruthy());
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe('/api/tasks/br_north/t_client');
    expect(patch.body).toEqual({ category: 'associate' });
    await screen.findByText(/Moved “Rate question” to Associate management/);
  });

  it('moves a task from the card menu (keyboard alternative)', async () => {
    const { calls } = renderInbox({
      tasks: tasksOf(QUEUE),
      handlers: { 'PATCH /api/tasks/br_north/t_ops': () => jsonResponse({ ...QUEUE[2], category: 'client' }) },
    });
    await screen.findByText('Safety walk');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Safety walk' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Client communication' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ category: 'client' }));
  });

  it('claims an unclaimed task with one click', async () => {
    let claimed = false;
    const after = () => [{ ...QUEUE[0]!, assigneeId: 'usr_avery' }, ...QUEUE.slice(1)];
    const { calls } = renderInbox({
      tasks: () => tasksOf(claimed ? after() : QUEUE),
      handlers: {
        'POST /api/tasks/br_north/t_client/claim': () => {
          claimed = true;
          return jsonResponse(after()[0]);
        },
      },
    });
    await screen.findByText('Rate question');
    fireEvent.click(screen.getByRole('button', { name: 'Claim Rate question' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/tasks/br_north/t_client/claim')).toBe(true));
    expect(await screen.findByText('Task assigned to you')).toBeTruthy();
    expect(within(column(/Client communication/)).getByText('Assigned to Avery Quinn')).toBeTruthy();
  });

  it('shows past days as a read-only record with no actions', async () => {
    const PAST = '2026-03-01';
    const pastTasks = [task({ id: 'p1', title: 'Old request', boardDate: PAST }), task({ id: 'p2', title: 'Done thing', boardDate: PAST, status: 'done', completedAt: '2026-03-01T18:00:00.000Z', completedBy: 'usr_blake' })];
    const { calls } = renderInbox({
      tasks: (url) => (url.includes(`date=${PAST}`) ? tasksOf(pastTasks, { date: PAST, isToday: false }) : tasksOf(QUEUE)),
    });
    await screen.findByText('Rate question');
    expect(screen.queryByRole('button', { name: 'Return to today' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Next day' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await screen.findByText('Old request');
    expect(calls.some((c) => c.url.includes(`date=${PAST}`))).toBe(true);
    expect(screen.getByText(/Saved day · Yesterday/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Return to today' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Claim/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reassign/ })).toBeNull();
    expect(column(/Client communication/).querySelector('article')!.hasAttribute('draggable')).toBe(false);

    // Menu offers details only: no moving, completing or reopening.
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Old request' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open details']);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    // Cleared tray: no Reopen on a saved day.
    fireEvent.click(screen.getByRole('button', { name: /Cleared/ }));
    expect(screen.getByText('Done thing')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reopen Done thing' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Return to today' }));
    await screen.findByText('Rate question');
  });

  it('shows the cleared tray with reply-closed notes and Reopen on today', async () => {
    const closed = task({
      id: 'c1',
      title: 'Confirm Monday starts',
      status: 'reply_closed',
      closedByReply: { at: '2026-03-02T16:00:00.000Z', fromAddress: 'team@northfield.example.test', excerpt: 'All set for Monday.', reason: 'Team confirmed' },
    });
    const { calls } = renderInbox({
      tasks: tasksOf([...QUEUE, closed]),
      handlers: { 'POST /api/tasks/br_north/c1/reopen': () => jsonResponse({ ...closed, status: 'open', closedByReply: null }) },
    });
    await screen.findByText('Rate question');
    const toggle = screen.getByRole('button', { name: /Cleared/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByText('Completed by reply')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Confirm Monday starts' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/tasks/br_north/c1/reopen')).toBe(true));
  });

  it('switches to the dense list view', async () => {
    renderInbox({ tasks: tasksOf(QUEUE) });
    await screen.findByText('Rate question');
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getAllByRole('row')[1]!.textContent).toContain('Safety walk');
  });

  it('marks routing and staffing state on cards', async () => {
    renderInbox({
      tasks: tasksOf([
        task({ id: 'r1', title: 'Who is this for', routing: { status: 'ambiguous', candidates: [] } }),
        task({ id: 'r2', title: 'Has an order', accountId: 'acc_lakeside', orderId: 'ord_d' }),
      ]),
      board: boardData({ orders: [order({ id: 'ord_d', status: 'draft' })] }),
    });
    await screen.findByText('Who is this for');
    expect(screen.getByText('Needs routing')).toBeTruthy();
    expect(screen.getByText('Lakeside Foods')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Draft order created/ }).getAttribute('href')).toBe('/?order=ord_d');
  });
});

describe('InboxPage drawer', () => {
  const staffing = task({
    id: 's1',
    title: 'Need 4 forklift drivers',
    accountId: 'acc_lakeside',
    unitId: 'unit_dock',
    staffingRequest: {
      role: 'Forklift driver',
      roleCategory: 'forklift',
      headcount: 4,
      headcountText: '4',
      shift: '2nd',
      days: 'M-F',
      hours: '2p-10:30p',
      payRate: 19.5,
      startDate: '2026-03-09',
      site: '',
      notes: 'Steel-toe boots.',
      blockedReason: 'Draft orders need a manager to review pay.',
    },
  });

  it('prefills the create-order dialog from the staffing request and links to the board', async () => {
    const { calls } = renderInbox({
      tasks: tasksOf([staffing]),
      handlers: {
        'POST /api/tasks/br_north/s1/create-order': () => jsonResponse({ task: { ...staffing, orderId: 'ord_new' }, order: order({ id: 'ord_new', role: 'Forklift driver' }) }, 201),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Need 4 forklift drivers' }));
    expect(screen.getByText(/Draft orders need a manager to review pay/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }));

    const dialog = screen.getByRole('dialog', { name: 'Create order from email' });
    const value = (label: string) => (within(dialog).getByLabelText(new RegExp(`^${label}\\*?$`)) as HTMLInputElement).value;
    expect(value('Account')).toBe('acc_lakeside');
    expect(value('Unit')).toBe('unit_dock');
    expect(value('Role')).toBe('Forklift driver');
    expect(value('Role category')).toBe('forklift');
    expect(value('Shift')).toBe('2nd');
    expect(value('Days')).toBe('M-F');
    expect(value('Hours')).toBe('2p-10:30p');
    expect(value('Pay rate \\(\\$/hr\\)')).toBe('19.5');
    expect(value('Openings')).toBe('4');
    expect(value('Note')).toBe('Steel-toe boots.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create order' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/tasks/br_north/s1/create-order')).toBe(true));
    expect(calls.find((c) => c.url === '/api/tasks/br_north/s1/create-order')!.body).toEqual({
      accountId: 'acc_lakeside',
      unitId: 'unit_dock',
      role: 'Forklift driver',
      roleCategory: 'forklift',
      shift: '2nd',
      days: 'M-F',
      hours: '2p-10:30p',
      payRate: 19.5,
      openingCount: 4,
      note: 'Steel-toe boots.',
    });
    expect(await screen.findByText('Order created')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View on board' })).toBeTruthy();
  });

  it('hides manager-only order and routing controls from members', async () => {
    renderInbox({ me: singleBranchMe('member'), tasks: tasksOf([staffing, task({ id: 'amb', title: 'Ambiguous one', routing: { status: 'ambiguous', candidates: [{ accountId: 'acc_maple', unitId: null, reason: 'Alias match' }] } })]) });
    fireEvent.click(await screen.findByRole('button', { name: 'Need 4 forklift drivers' }));
    expect(screen.queryByRole('button', { name: 'Create order' })).toBeNull();
    expect(screen.getByText('A manager turns this request into an order.')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Account' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reassign/ })).toBeNull();
  });

  it('resolves ambiguous routing with a quick pick (managers)', async () => {
    const amb = task({ id: 'amb', title: 'Ambiguous one', routing: { status: 'ambiguous', candidates: [{ accountId: 'acc_maple', unitId: null, reason: 'Alias match' }] } });
    const { calls } = renderInbox({ tasks: tasksOf([amb]), handlers: { 'PATCH /api/tasks/br_north/amb': () => jsonResponse({ ...amb, accountId: 'acc_maple' }) } });
    fireEvent.click(await screen.findByRole('button', { name: 'Ambiguous one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use Maple Freight' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ accountId: 'acc_maple', unitId: null }));
  });

  it('loads the message thread on demand and offers Outlook in a new tab', async () => {
    const { calls } = renderInbox({
      tasks: tasksOf([staffing]),
      handlers: {
        'GET /api/tasks/br_north/s1/messages': () =>
          jsonResponse([
            { id: 'm1', scopeId: 'br_north', taskId: 's1', mailboxId: 'mbx', conversationId: 'c', internetMessageId: 'i1', direction: 'inbound', fromAddress: 'pat@lakeside.example.com', fromName: 'Pat Rivers', to: [], cc: [], subject: 's', bodyText: 'Can you send four drivers?', receivedAt: '2026-03-02T14:00:00.000Z', webLink: null, decision: 'New staffing request' },
            { id: 'm2', scopeId: 'br_north', taskId: 's1', mailboxId: 'mbx', conversationId: 'c', internetMessageId: 'i2', direction: 'outbound', fromAddress: 'team@northfield.example.test', fromName: 'Northfield team', to: [], cc: [], subject: 's', bodyText: 'On it.', receivedAt: '2026-03-02T15:00:00.000Z', webLink: null, decision: '' },
          ]),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Need 4 forklift drivers' }));
    const outlook = screen.getByRole('link', { name: /Open in Outlook/ });
    expect(outlook.getAttribute('target')).toBe('_blank');
    expect(outlook.getAttribute('rel')).toContain('noopener');
    expect(calls.some((c) => c.url.endsWith('/messages'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show messages (2)' }));
    expect(await screen.findByText('Can you send four drivers?')).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Team reply from Northfield team' })).toBeTruthy();
    expect(screen.getByText('New staffing request')).toBeTruthy();
  });
});

describe('InboxPage personal mail', () => {
  it('marks personal tasks as Private in the combined view', async () => {
    renderInbox({
      me: singleBranchMe('member', true, 'combined'),
      mail: mailStatus({ connected: true, status: 'ok', address: 'avery.quinn@example.test', lastSyncAt: '2026-03-02T14:55:00.000Z' }),
      tasks: tasksOf([
        task({ id: 'b1', title: 'Branch thing' }),
        task({ id: 'pv1', title: 'My private follow-up', scope: 'personal', scopeId: 'personal:usr_avery', branchId: null, ownerUserId: 'usr_avery', assigneeId: 'usr_avery' }),
      ]),
    });
    const title = await screen.findByText('My private follow-up');
    const card = title.closest('article')!;
    expect(within(card).getByText('Private')).toBeTruthy();
    const branchCard = screen.getByText('Branch thing').closest('article')!;
    expect(within(branchCard).queryByText('Private')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Combined' }).getAttribute('aria-checked')).toBe('true');
  });

  it('explains personal mail and connects, then shows the pending state', async () => {
    const { calls } = renderInbox({
      me: singleBranchMe('member', true, 'personal'),
      mail: mailStatus(),
      tasks: tasksOf([]),
      handlers: { 'POST /api/me/mail/connect': () => jsonResponse(mailStatus({ connected: true, status: 'pending', address: 'avery.quinn@example.test' })) },
    });
    expect(await screen.findByRole('heading', { name: 'Personal mail' })).toBeTruthy();
    expect(screen.getByText(/not visible to coworkers or managers/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect my mailbox' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/me/mail/connect')).toBe(true));
    expect(await screen.findByText('Waiting for access')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('shows admin help for no_access and the error text for error', async () => {
    renderInbox({
      me: singleBranchMe('member', true, 'personal'),
      mail: mailStatus({ connected: true, status: 'no_access', address: 'avery.quinn@example.test', help: 'Ask an admin to add you to BranchSuite-Mailboxes.' }),
      tasks: tasksOf([]),
    });
    expect(await screen.findByText('Needs admin approval')).toBeTruthy();
    expect(screen.getByText('Ask an admin to add you to BranchSuite-Mailboxes.')).toBeTruthy();
  });

  it('disconnects after confirming', async () => {
    const { calls } = renderInbox({
      me: singleBranchMe('member', true, 'personal'),
      mail: mailStatus({ connected: true, status: 'ok', address: 'avery.quinn@example.test' }),
      tasks: tasksOf([]),
      handlers: { 'POST /api/me/mail/disconnect': () => jsonResponse(mailStatus({ status: 'disabled', address: 'avery.quinn@example.test' })) },
    });
    expect(await screen.findByText('Connected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = screen.getByRole('dialog', { name: 'Disconnect your mailbox?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/me/mail/disconnect')).toBe(true));
    expect(await screen.findByRole('heading', { name: 'Personal mail' })).toBeTruthy();
  });

  it('hides the view switch without the personal mail feature', async () => {
    renderInbox({ tasks: tasksOf([]) });
    await screen.findByText('No tasks for today');
    expect(screen.queryByRole('radiogroup', { name: 'Inbox view' })).toBeNull();
  });

  it('saves the chosen view to preferences', async () => {
    const { calls } = renderInbox({ me: singleBranchMe('member', true, 'branch'), tasks: tasksOf([]) });
    fireEvent.click(screen.getByRole('radio', { name: 'Combined' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url === '/api/me/preferences')?.body).toEqual({ inboxView: 'combined' }));
    expect(await screen.findByText(/Connect your own mailbox/)).toBeTruthy();
  });
});

describe('InboxPage manager tools', () => {
  it('adds a task for the branch', async () => {
    const { calls } = renderInbox({
      tasks: tasksOf([]),
      handlers: { 'POST /api/branches/br_north/tasks': () => jsonResponse(task({ id: 'new', title: 'Call Lakeside back' }), 201) },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'Add task' });
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Call Lakeside back' } });
    fireEvent.change(within(dialog).getByLabelText('Priority'), { target: { value: 'hot' } });
    fireEvent.change(within(dialog).getByLabelText('Account'), { target: { value: 'acc_lakeside' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add task' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/branches/br_north/tasks')?.body).toEqual({ title: 'Call Lakeside back', priority: 'hot', assigneeId: null, accountId: 'acc_lakeside' }));
  });

  it('reassigns all open tasks from someone who is out', async () => {
    const { calls } = renderInbox({
      tasks: tasksOf(QUEUE),
      handlers: { 'POST /api/branches/br_north/tasks/reassign': () => jsonResponse({ moved: 1 }) },
    });
    await screen.findByText('Rate question');
    fireEvent.click(screen.getByRole('button', { name: 'Reassign tasks from…' }));
    const dialog = screen.getByRole('dialog', { name: 'Reassign open tasks' });
    fireEvent.change(within(dialog).getByLabelText('Reassign all open tasks from'), { target: { value: 'usr_blake' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: 'usr_casey' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Reassign/ }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/tasks/reassign'))?.body).toEqual({ fromUserId: 'usr_blake', toUserId: 'usr_casey' }));
    expect(await screen.findByText('Moved 1 task')).toBeTruthy();
  });
});
