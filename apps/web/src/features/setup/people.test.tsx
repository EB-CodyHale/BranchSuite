import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { jsonResponse } from '../../test/fixtures.js';
import { MarkerPicker } from './MarkerPicker.js';
import { PeopleSection } from './PeopleSection.js';
import { assignableRoles, duplicateInitials, suggestInitials, validatePerson } from './peopleModel.js';
import { PersonDialog } from './PersonDialog.js';
import { adminMe, managerMe, renderSetup, rosterUser } from './testHarness.js';

const ROSTER = [
  rosterUser('usr_avery', 'Avery Quinn', 'AQ', { role: 'manager', marker: 'teal' }),
  rosterUser('usr_blake', 'Blake Ortiz', 'BO', { marker: 'red' }),
  rosterUser('usr_rio', 'Rio Sato', 'RS', { branchIds: ['br_south'], marker: 'green' }),
];

describe('peopleModel', () => {
  it('suggests initials from first and last name and avoids taken ones', () => {
    expect(suggestInitials('Avery Quinn')).toBe('AQ');
    expect(suggestInitials('  josé  de la cruz ')).toBe('JC');
    expect(suggestInitials('Avery Quinn', new Set(['AQ']))).toBe('AVQ');
    expect(suggestInitials('Madonna')).toBe('MA');
    expect(suggestInitials('')).toBe('');
  });

  it('finds duplicate initials only among active people sharing a branch', () => {
    expect(duplicateInitials(ROSTER, 'bo', ['br_north']).map((p) => p.id)).toEqual(['usr_blake']);
    expect(duplicateInitials(ROSTER, 'RS', ['br_north'])).toEqual([]);
    expect(duplicateInitials(ROSTER, 'BO', ['br_north'], 'usr_blake')).toEqual([]);
  });

  it('never lets a manager grant admin', () => {
    expect(assignableRoles(false)).toEqual(['member', 'manager']);
    const manager = { id: 'usr_avery', role: 'manager' as const, perms: { branchIds: ['br_north'], manageBranchIds: ['br_north'], isAdmin: false } };
    const errors = validatePerson({ email: 'new.person@example.test', name: 'New Person', initials: 'NP', role: 'admin', branchIds: ['br_north'], marker: 'blue' }, manager, null);
    expect(errors.role).toMatch(/admin/i);
    const outside = validatePerson({ email: 'new.person@example.test', name: 'New Person', initials: 'NP', role: 'member', branchIds: ['br_south'], marker: 'blue' }, manager, null);
    expect(outside.branchIds).toMatch(/branches you manage/);
  });
});

describe('MarkerPicker', () => {
  it('names every swatch and supports arrow keys', () => {
    let value: string = 'blue';
    renderSetup(<MarkerPicker value="blue" onChange={(m) => (value = m)} usage={{ red: ['BO'] }} />);
    const group = screen.getByRole('radiogroup', { name: 'Marker color' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(10);
    expect(screen.getByRole('radio', { name: 'Blue marker' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Red marker, also used by BO' }).getAttribute('aria-checked')).toBe('false');
    // Visible text, not only color.
    expect(within(group).getByText('Navy')).toBeTruthy();
    // Roving tab stop on the checked swatch.
    expect(screen.getByRole('radio', { name: 'Blue marker' }).tabIndex).toBe(0);
    expect(screen.getByRole('radio', { name: 'Green marker' }).tabIndex).toBe(-1);

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Blue marker' }), { key: 'ArrowRight' });
    expect(value).toBe('red');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Blue marker' }), { key: 'ArrowDown' });
    expect(value).toBe('teal');
  });
});

describe('PersonDialog', () => {
  it('does not offer the admin role to a manager and limits branches to managed ones', async () => {
    renderSetup(<PersonDialog person={null} roster={ROSTER} branchId="br_north" onClose={() => undefined} />, { me: managerMe() });
    const role = screen.getByRole('combobox', { name: 'Role' });
    const options = within(role).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Team member', 'Branch manager']);
    const branches = screen.getByRole('group', { name: 'Branches' });
    expect(within(branches).getAllByRole('checkbox')).toHaveLength(1);
    expect(within(branches).getByText('Northfield')).toBeTruthy();
  });

  it('offers admin to an admin', () => {
    renderSetup(<PersonDialog person={null} roster={ROSTER} branchId="br_north" onClose={() => undefined} />, { me: adminMe() });
    const options = within(screen.getByRole('combobox', { name: 'Role' })).getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Admin');
  });

  it('validates fields, suggests initials and warns about duplicates in the branch', async () => {
    const { calls } = renderSetup(<PersonDialog person={null} roster={ROSTER} branchId="br_north" onClose={() => undefined} />, {
      me: managerMe(),
      handlers: { 'POST /api/users': (body) => jsonResponse({ ...rosterUser('usr_new', 'Bea Olsen', 'BO'), ...(body as object) }, 201) },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    expect(await screen.findByText('Enter a valid work email address.')).toBeTruthy();
    expect(screen.getByText('Enter the person’s name.')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    fireEvent.change(screen.getByRole('textbox', { name: /Work email/ }), { target: { value: 'bea.olsen@example.test' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: 'Bea Olsen' } });
    // BO is taken in Northfield, so the suggestion adds a letter.
    expect((screen.getByRole('textbox', { name: /^Initials/ }) as HTMLInputElement).value).toBe('BEO');

    fireEvent.change(screen.getByRole('textbox', { name: /^Initials/ }), { target: { value: 'bo' } });
    expect(screen.getByText('BO is already used in this branch')).toBeTruthy();
    expect(screen.getByText(/Blake Ortiz has the same initials/)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Purple marker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      email: 'bea.olsen@example.test',
      name: 'Bea Olsen',
      initials: 'BO',
      role: 'member',
      branchIds: ['br_north'],
      marker: 'purple',
    });
  });

  it('shows API errors inline', async () => {
    renderSetup(<PersonDialog person={null} roster={[]} branchId="br_north" onClose={() => undefined} />, {
      me: managerMe(),
      handlers: { 'POST /api/users': () => jsonResponse({ error: { code: 'conflict', message: 'Someone with that email is already on the roster.' } }, 409) },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Work email/ }), { target: { value: 'dup@example.test' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: 'Dee Upton' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    const note = await screen.findByText('Someone with that email is already on the roster.');
    expect(note.closest('[role="alert"]')).toBeTruthy();
  });

  it('edits out dates with the "Out today" switch', async () => {
    const blake = ROSTER[1]!;
    const { calls } = renderSetup(<PersonDialog person={blake} roster={ROSTER} branchId="br_north" onClose={() => undefined} />, {
      me: managerMe(),
      handlers: { 'PATCH /api/users/usr_blake': (body) => jsonResponse({ ...blake, ...(body as object) }) },
    });
    fireEvent.click(screen.getByRole('switch', { name: /Out today/ }));
    expect(within(screen.getByRole('list', { name: 'Days out' })).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const body = calls.find((c) => c.method === 'PATCH')?.body as { outDates: string[] };
    expect(Object.keys(body)).toEqual(['outDates']);
    expect(body.outDates).toHaveLength(1);
  });
});

describe('PeopleSection', () => {
  it('lists the branch roster with marker, role and status', async () => {
    renderSetup(<PeopleSection />, { me: managerMe(), handlers: { 'GET /api/users': () => jsonResponse(ROSTER) } });
    const table = await screen.findByRole('table', { name: 'People in Northfield' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['Avery Quinnavery@example.test', 'Blake Ortizblake@example.test']);
    expect(within(rows[1]!).getByText('Red')).toBeTruthy();
    expect(within(rows[1]!).getByText('Team member')).toBeTruthy();
    expect(within(rows[1]!).getByRole('button', { name: 'Edit Blake Ortiz' })).toBeTruthy();
  });
});
