import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { branch, jsonResponse } from '../../test/fixtures.js';
import { FilteredMailSection } from './FilteredMailSection.js';
import { MailboxesSection } from './MailboxesSection.js';
import { SetupPage } from './SetupPage.js';
import { adminMe, managerMe, renderSetup } from './testHarness.js';

const T = '2026-03-02T15:00:00.000Z';
const audited = { createdAt: T, updatedAt: T, createdBy: null, updatedBy: null };

describe('SetupPage', () => {
  it('shows the sub-nav and hides admin-only sections from managers', async () => {
    renderSetup(<SetupPage />, { me: managerMe(), path: '/setup/branches', routePath: '/setup/*' });
    const nav = screen.getByRole('navigation', { name: 'Setup sections' });
    const links = within(nav).getAllByRole('link').map((a) => a.textContent);
    expect(links).toContain('People');
    expect(links).toContain('Wall settings');
    expect(links.some((l) => l?.includes('Import accounts'))).toBe(false);
    // The phone select lists the same sections.
    const select = screen.getByRole('combobox', { name: 'Section' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).not.toContain('import');
    expect(await screen.findByRole('heading', { level: 2, name: 'Branches' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: /Branches/ }).getAttribute('aria-current')).toBe('page');
  });

  it('lets admins reach the import section and navigates from the phone select', async () => {
    renderSetup(<SetupPage />, { me: adminMe(), path: '/setup/branches', routePath: '/setup/*' });
    expect(within(screen.getByRole('navigation', { name: 'Setup sections' })).getByRole('link', { name: /Import accounts/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Section' }), { target: { value: 'import' } });
    expect(await screen.findByRole('heading', { level: 2, name: 'Import accounts' })).toBeTruthy();
  });

  it('a manager edits only branch settings, with the email-order explanation', async () => {
    const { calls } = renderSetup(<SetupPage />, {
      me: managerMe(),
      path: '/setup/branches',
      routePath: '/setup/*',
      handlers: { 'PATCH /api/branches/br_north': (body) => jsonResponse({ ...branch('br_north', 'Northfield'), ...(body as object) }) },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Northfield' }));
    expect(screen.queryByRole('button', { name: 'New branch' })).toBeNull();
    expect((screen.getByRole('textbox', { name: /^Name/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/lands as a draft/)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: /Publish email orders automatically/ }));
    expect(screen.getByText(/goes live on the board/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ settings: { autoPublishEmailOrders: true, internalDomains: [], shiftOptions: [] } });
  });
});

describe('MailboxesSection', () => {
  const mailbox = { ...audited, id: 'mbx_1', address: 'branch0412@company.example', kind: 'branch', branchIds: ['br_north'], userId: null, brand: '', enabled: true, status: 'no_access', lastSyncAt: null, lastError: 'Access denied by Exchange RBAC' };

  it('is read-only for managers and explains access problems', async () => {
    renderSetup(<MailboxesSection />, { me: managerMe(), handlers: { 'GET /api/mailboxes': () => jsonResponse([mailbox]) } });
    expect(await screen.findByText('branch0412@company.example')).toBeTruthy();
    expect(screen.getByText('No access')).toBeTruthy();
    expect(screen.getByText('Access denied by Exchange RBAC')).toBeTruthy();
    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add mailbox' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(screen.getByText('BranchSuite-Mailboxes')).toBeTruthy();
  });

  it('lets admins queue a sync', async () => {
    const { calls } = renderSetup(<MailboxesSection />, {
      me: adminMe(),
      handlers: { 'GET /api/mailboxes': () => jsonResponse([mailbox]), 'POST /api/mailboxes/mbx_1/sync': () => jsonResponse({ queued: true }) },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/mailboxes/mbx_1/sync')).toBe(true));
    expect(await screen.findByText('Sync queued')).toBeTruthy();
  });
});

describe('FilteredMailSection', () => {
  it('promotes a filtered message to a task', async () => {
    const item = { id: 'flt_1', scopeId: 'br_north', mailboxId: 'mbx_1', fromAddress: 'pat@client.example', fromName: 'Pat Lee', subject: 'Re: need 2 more pickers', excerpt: 'Can you send two more?', receivedAt: T, reason: 'Looked like an auto-reply', stage: 'model', promotedTaskId: null };
    const { calls } = renderSetup(<FilteredMailSection />, {
      me: managerMe(),
      handlers: {
        'GET /api/branches/br_north/mail/filtered': () => jsonResponse([item]),
        'POST /api/mail/filtered/br_north/flt_1/promote': () => jsonResponse({ id: 'tsk_1', title: 'Need 2 more pickers' }),
      },
    });
    expect(await screen.findByText('Looked like an auto-reply')).toBeTruthy();
    expect(screen.getByText('AI triage')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Promote to task: Re: need 2 more pickers' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(await screen.findByText('Task created')).toBeTruthy();
  });
});
