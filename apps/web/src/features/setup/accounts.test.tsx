import type { AccountUnit } from '@branchsuite/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { jsonResponse } from '../../test/fixtures.js';
import { AccountEditor } from './AccountEditor.js';
import { AccountsSection } from './AccountsSection.js';
import { parseCsv, parseImport, parseJson, splitCsvLine } from './importModel.js';
import { RoutingTesterSection } from './RoutingTesterSection.js';
import { fullAccount, managerMe, renderSetup, rosterUser } from './testHarness.js';
import { unitTreeErrors, UnitsEditor } from './UnitsEditor.js';
import { hardToReadChars, wallCodeErrors } from './WallCodeCard.js';

const unit = (id: string, name: string, parentId: string | null = null, extra: Partial<AccountUnit> = {}): AccountUnit => ({ id, name, parentId, ownerId: null, aliases: [], active: true, ...extra });

const PEOPLE = [rosterUser('usr_blake', 'Blake Ortiz', 'BO', { marker: 'red' })];

describe('units tree', () => {
  it('reports shared validateUnits errors plus blank names', () => {
    const cycle = [unit('a', 'Plant A', 'b'), unit('b', 'Plant B', 'a')];
    expect(unitTreeErrors(cycle).join(' ')).toMatch(/cycle/);
    const deep = [unit('u1', 'L1'), unit('u2', 'L2', 'u1'), unit('u3', 'L3', 'u2'), unit('u4', 'L4', 'u3'), unit('u5', 'L5', 'u4'), unit('u6', 'L6', 'u5')];
    expect(unitTreeErrors(deep).join(' ')).toMatch(/maximum is 5/);
    expect(unitTreeErrors([unit('x', '  ')])).toContain('1 unit has no name.');
    expect(unitTreeErrors([unit('x', 'Dock'), unit('y', 'dock')]).join(' ')).toMatch(/both named/);
  });

  it('surfaces errors in the editor when a parent change creates a cycle, and disables Add child at max depth', () => {
    let units = [unit('a', 'Plant A'), unit('b', 'Dock B', 'a')];
    const { rerender } = renderSetup(<UnitsEditor units={units} onChange={(u) => (units = u)} people={PEOPLE} savedIds={new Set(['a', 'b'])} />);
    expect(screen.queryByText('Fix the unit tree before saving')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Parent of Plant A' }), { target: { value: 'b' } });
    expect(units.find((u) => u.id === 'a')?.parentId).toBe('b');
    rerender(<UnitsEditor units={units} onChange={(u) => (units = u)} people={PEOPLE} savedIds={new Set(['a', 'b'])} />);
    const alert = screen.getByText('Fix the unit tree before saving').closest('[role="alert"]')!;
    expect(alert.textContent).toMatch(/Fix the unit tree before saving/);
    expect(alert.textContent).toMatch(/cycle/);
    expect(screen.getByText('Not reachable from the top level')).toBeTruthy();

    const deep = [unit('u1', 'L1'), unit('u2', 'L2', 'u1'), unit('u3', 'L3', 'u2'), unit('u4', 'L4', 'u3'), unit('u5', 'L5', 'u4')];
    rerender(<UnitsEditor units={deep} onChange={() => undefined} people={PEOPLE} savedIds={new Set()} />);
    const addChild = screen.getAllByRole('button', { name: 'Add child' });
    expect(addChild.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false, false, false, true]);
  });

  it('blocks saving an account whose unit tree is invalid and jumps to the Units tab', async () => {
    const account = fullAccount('acc_lake', 'Lakeside Foods', { units: [unit('a', 'Plant A')] });
    const { calls } = renderSetup(<AccountEditor account={account} accounts={[account]} people={PEOPLE} onClose={() => undefined} />, { me: managerMe() });
    fireEvent.click(screen.getByRole('tab', { name: /Units/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Unit name' }), { target: { value: '' } });
    expect(screen.getByRole('tab', { name: /Units \(needs fixing\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save account' }));
    expect(screen.getByRole('tab', { name: /Units/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('1 unit has no name.')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('saves only changed fields, including a new child unit', async () => {
    const account = fullAccount('acc_lake', 'Lakeside Foods', { units: [unit('a', 'Plant A')] });
    const { calls } = renderSetup(<AccountEditor account={account} accounts={[account]} people={PEOPLE} onClose={() => undefined} />, {
      me: managerMe(),
      handlers: { 'PATCH /api/branches/br_north/accounts/acc_lake': (body) => jsonResponse({ ...account, ...(body as object) }) },
    });
    fireEvent.click(screen.getByRole('tab', { name: /Units/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }));
    const names = screen.getAllByRole('textbox', { name: 'Unit name' });
    fireEvent.change(names[1]!, { target: { value: 'Dock B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save account' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const body = calls.find((c) => c.method === 'PATCH')!.body as { units: AccountUnit[] };
    expect(Object.keys(body)).toEqual(['units']);
    expect(body.units).toHaveLength(2);
    expect(body.units[1]).toMatchObject({ name: 'Dock B', parentId: 'a', active: true });
  });
});

describe('wall code', () => {
  it('rejects bad formats and codes used by another account', () => {
    expect(wallCodeErrors({ code: 'K7', color: 'w1', glyph: 'circle' }, [{ name: 'Maple Freight', wall: { code: 'K7', color: 'w2', glyph: 'star' } }])[0]).toMatch(/already used by Maple Freight/);
    expect(wallCodeErrors({ code: '7K', color: 'w1', glyph: 'circle' }, [])).toHaveLength(1);
    expect(wallCodeErrors({ code: 'KM7', color: 'w1', glyph: 'circle' }, [])).toEqual([]);
    expect(hardToReadChars('O1')).toEqual(['O', '1']);
  });

  it('checks uniqueness in the editor before saving', () => {
    const lake = fullAccount('acc_lake', 'Lakeside Foods', { wall: { code: 'K7', color: 'w1', glyph: 'diamond' } });
    const maple = fullAccount('acc_maple', 'Maple Freight', { wall: { code: 'M3', color: 'w2', glyph: 'circle' } });
    renderSetup(<AccountEditor account={lake} accounts={[lake, maple]} people={PEOPLE} onClose={() => undefined} initialTab="wall" />, { me: managerMe() });
    fireEvent.change(screen.getByRole('textbox', { name: 'Code' }), { target: { value: 'm3' } });
    expect(screen.getByText(/M3 is already used by Maple Freight/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'blue' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'star' }));
    expect(screen.getByRole('radio', { name: 'star' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('AccountsSection', () => {
  it('searches and toggles priority with an accessible star', async () => {
    const accounts = [fullAccount('acc_lake', 'Lakeside Foods', { aliases: ['LSF'] }), fullAccount('acc_maple', 'Maple Freight', { wall: { code: 'M3', color: 'w2', glyph: 'circle' } })];
    const { calls } = renderSetup(<AccountsSection />, {
      me: managerMe(),
      handlers: {
        'GET /api/branches/br_north/accounts': () => jsonResponse(accounts),
        'GET /api/users?branchId=br_north': () => jsonResponse(PEOPLE),
        'PATCH /api/branches/br_north/accounts/acc_maple': (body) => jsonResponse({ ...accounts[1], ...(body as object) }),
      },
    });
    const list = await screen.findByRole('list', { name: 'Accounts in Northfield' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search accounts' }), { target: { value: 'lsf' } });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    const star = await screen.findByRole('button', { name: 'Priority account: Maple Freight' });
    expect(star.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(star);
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ isPriority: true }));
  });

  it('requires an explicit acknowledgement before rotating every wall code', async () => {
    const accounts = [fullAccount('acc_lake', 'Lakeside Foods')];
    const { calls } = renderSetup(<AccountsSection />, {
      me: managerMe(),
      handlers: {
        'GET /api/branches/br_north/accounts': () => jsonResponse(accounts),
        'GET /api/users?branchId=br_north': () => jsonResponse(PEOPLE),
        'POST /api/branches/br_north/accounts/rotate-wall-codes': () => jsonResponse(accounts),
      },
    });
    await screen.findByRole('list', { name: 'Accounts in Northfield' });
    fireEvent.click(screen.getByRole('button', { name: 'Rotate all wall codes' }));
    expect(screen.getByText(/Staff must re-learn every code/)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Rotate all codes' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand staff must re-learn/ }));
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/rotate-wall-codes'))).toBe(true));
  });
});

describe('RoutingTesterSection', () => {
  it('shows the status, candidate labels and each explanation step', async () => {
    const account = fullAccount('acc_lake', 'Lakeside Foods', { units: [unit('u_dock', 'Dock B')] });
    const { calls } = renderSetup(<RoutingTesterSection />, {
      me: managerMe(),
      handlers: {
        'GET /api/branches/br_north/accounts': () => jsonResponse([account]),
        'POST /api/branches/br_north/routing/test': () =>
          jsonResponse({
            routing: { status: 'matched', candidates: [{ accountId: 'acc_lake', unitId: 'u_dock', reason: 'Sender domain lakeside.example; unit named in message' }] },
            explanation: ['No active contact matches pat@lakeside.example.', 'Sender domain "lakeside.example" belongs to "Lakeside Foods".', 'Unit "Dock B" is named in the message; selected it.'],
          }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test routing' }));
    expect(await screen.findByText(/Enter the sender address/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: /^From/ }), { target: { value: 'pat@lakeside.example' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Subject' }), { target: { value: 'Need 3 for Dock B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test routing' }));
    const steps = await screen.findByRole('list', { name: 'Routing steps' });
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1No active contact matches pat@lakeside.example.',
      '2Sender domain "lakeside.example" belongs to "Lakeside Foods".',
      '3Unit "Dock B" is named in the message; selected it.',
    ]);
    expect(screen.getByText('Matched')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Lakeside Foods › Dock B')).toBeTruthy());
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ fromAddress: 'pat@lakeside.example', subject: 'Need 3 for Dock B', body: '' });
  });
});

describe('importModel', () => {
  it('splits quoted CSV fields', () => {
    expect(splitCsvLine('"Orbit Plastics, Plant 2",10518,"SRC ""9"""')).toEqual(['Orbit Plastics, Plant 2', '10518', 'SRC "9"']);
  });

  it('parses CSV with or without a header, and reports empty names by line', () => {
    expect(parseCsv('name,accountNumber,sourceId\nLakeside Foods,10442,SRC-1').rows).toEqual([{ name: 'Lakeside Foods', accountNumber: '10442', sourceId: 'SRC-1' }]);
    expect(parseCsv('Maple Freight,,SRC-2').rows).toEqual([{ name: 'Maple Freight', sourceId: 'SRC-2' }]);
    expect(parseCsv('sourceId,name\nS1,Orbit').rows).toEqual([{ name: 'Orbit', sourceId: 'S1' }]);
    expect(parseCsv('Lakeside,1\n,2').errors).toEqual(['Line 2: the name is empty.']);
  });

  it('parses JSON arrays and rejects malformed input', () => {
    expect(parseJson('[{"name":"Lakeside","accountNumber":10442}]').rows).toEqual([{ name: 'Lakeside', accountNumber: '10442' }]);
    expect(parseJson('{"accounts":[{"name":"Maple"}]}').rows).toEqual([{ name: 'Maple' }]);
    expect(parseJson('{oops').errors[0]).toMatch(/not valid JSON/);
    expect(parseJson('{"x":1}').errors[0]).toMatch(/array/);
    expect(parseImport('', 'csv').errors).toEqual(['Paste at least one line.']);
    expect(parseImport('[]', 'json').errors).toEqual(['Nothing to import.']);
  });
});
