import { describe, expect, it } from 'vitest';
import { LIMITS } from '../constants.js';
import type { Account } from '../schemas.js';
import { accountLabel, routeEmail, unitPath, validateUnits } from './accounts.js';
import { account, contact, unit } from './fixtures.test-util.js';

describe('unitPath', () => {
  const acct = account({
    units: [unit({ id: 'root', name: 'Campus' }), unit({ id: 'mid', name: 'Building B', parentId: 'root' }), unit({ id: 'leaf', name: 'Dock 4', parentId: 'mid' })],
  });

  it('returns the unit first, then its ancestors', () => {
    expect(unitPath(acct, 'leaf').map((u) => u.id)).toEqual(['leaf', 'mid', 'root']);
    expect(unitPath(acct, 'root').map((u) => u.id)).toEqual(['root']);
  });
  it('returns [] for null or unknown units', () => {
    expect(unitPath(acct, null)).toEqual([]);
    expect(unitPath(acct, 'nope')).toEqual([]);
  });
  it('stops on cycles', () => {
    const cyclic = account({ units: [unit({ id: 'a', parentId: 'b' }), unit({ id: 'b', parentId: 'c' }), unit({ id: 'c', parentId: 'a' })] });
    expect(unitPath(cyclic, 'a').map((u) => u.id)).toEqual(['a', 'b', 'c']);
  });
  it('caps the depth', () => {
    const units = Array.from({ length: 8 }, (_, i) => unit({ id: `u${i}`, parentId: i === 0 ? null : `u${i - 1}` }));
    expect(unitPath(account({ units }), 'u7')).toHaveLength(LIMITS.maxUnitDepth);
  });
  it('stops at a dangling parent', () => {
    expect(unitPath(account({ units: [unit({ id: 'x', parentId: 'gone' })] }), 'x').map((u) => u.id)).toEqual(['x']);
  });
});

describe('accountLabel', () => {
  it('joins account and unit chain from the top', () => {
    const acct = account({ name: 'Northwind Fabrication', units: [unit({ id: 'r', name: 'Campus' }), unit({ id: 'l', name: 'Dock 4', parentId: 'r' })] });
    expect(accountLabel(acct, 'l')).toBe('Northwind Fabrication › Campus › Dock 4');
    expect(accountLabel(acct, null)).toBe('Northwind Fabrication');
  });
});

describe('validateUnits', () => {
  it('accepts a valid tree', () => {
    expect(validateUnits([unit({ id: 'a' }), unit({ id: 'b', parentId: 'a' }), unit({ id: 'c', parentId: 'a' })])).toEqual([]);
    expect(validateUnits([])).toEqual([]);
  });
  it('reports duplicate ids', () => {
    const errors = validateUnits([unit({ id: 'a' }), unit({ id: 'a', name: 'Dup' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Duplicate');
  });
  it('reports unknown parents once, on the broken unit', () => {
    const errors = validateUnits([unit({ id: 'a', name: 'Orphan', parentId: 'ghost' }), unit({ id: 'b', parentId: 'a' })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Orphan');
  });
  it('reports each cycle once', () => {
    const errors = validateUnits([
      unit({ id: 'a', name: 'A', parentId: 'c' }),
      unit({ id: 'b', name: 'B', parentId: 'a' }),
      unit({ id: 'c', name: 'C', parentId: 'b' }),
      unit({ id: 'd', name: 'D', parentId: 'a' }), // hangs off the cycle; not itself part of it
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('cycle');
  });
  it('reports a self-parent as a cycle', () => {
    expect(validateUnits([unit({ id: 'a', parentId: 'a' })])[0]).toContain('cycle');
  });
  it('enforces the maximum depth', () => {
    const chain = (n: number) => Array.from({ length: n }, (_, i) => unit({ id: `u${i}`, name: `U${i}`, parentId: i === 0 ? null : `u${i - 1}` }));
    expect(validateUnits(chain(LIMITS.maxUnitDepth))).toEqual([]);
    const errors = validateUnits(chain(LIMITS.maxUnitDepth + 1));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`U${LIMITS.maxUnitDepth}`);
  });
});

describe('routeEmail', () => {
  const northwind = account({
    id: 'acc_nw',
    name: 'Northwind Fabrication',
    aliases: ['Northwind', 'NWF'],
    domains: ['northwind-example.com'],
    units: [
      unit({ id: 'nw_east', name: 'East Plant', aliases: ['Plant 2'] }),
      unit({ id: 'nw_west', name: 'West Plant' }),
      unit({ id: 'nw_old', name: 'Riverside Annex', active: false }),
    ],
    contacts: [contact({ id: 'c1', email: 'pat@northwind-example.com', unitId: 'nw_east' }), contact({ id: 'c2', email: 'gone@northwind-example.com', active: false })],
  });
  const bluebird = account({
    id: 'acc_bb',
    name: 'Bluebird Logistics',
    aliases: ['Bluebird'],
    domains: ['shared-parent-example.com'],
    contacts: [contact({ id: 'c3', email: 'lee@bluebird-example.com' })],
  });
  const cobalt = account({ id: 'acc_co', name: 'Cobalt Foods', aliases: ['Cobalt', 'CF'], domains: ['shared-parent-example.com'] });
  const dormant = account({ id: 'acc_dm', name: 'Dormant Mills', domains: ['dormant-example.com'], contacts: [contact({ id: 'c4', email: 'old@dormant-example.com' })], active: false });
  const internal = account({ id: 'acc_int', name: 'Internal', reserved: 'internal' });
  const payroll = account({ id: 'acc_pay', name: 'Payroll', reserved: 'payroll', contacts: [contact({ id: 'c5', email: 'payroll@paycorp-example.com' })] });
  const all: Account[] = [northwind, bluebird, cobalt, dormant, internal, payroll];
  const route = (fromAddress: string, subject = '', body = '', internalDomains: string[] = ['branch-example.com']) =>
    routeEmail({ fromAddress, subject, body, internalDomains }, all);

  it('routes internal senders to the reserved Internal account', () => {
    expect(route('teammate@branch-example.com', 'Northwind order').routing).toEqual({
      status: 'matched',
      candidates: [{ accountId: 'acc_int', unitId: null, reason: expect.any(String) }],
    });
    expect(route('Teammate <TEAMMATE@Branch-Example.com>').routing.candidates[0]?.accountId).toBe('acc_int');
  });

  it('continues past an internal domain when no Internal account exists', () => {
    const res = routeEmail({ fromAddress: 'x@branch-example.com', subject: '', body: '', internalDomains: ['branch-example.com'] }, [northwind]);
    expect(res.routing.status).toBe('unmatched');
  });

  it('matches an exact active contact and uses the contact unit', () => {
    const res = route('Pat Example <Pat@Northwind-Example.com>', 'Need 3 pickers');
    expect(res.routing).toEqual({ status: 'matched', candidates: [{ accountId: 'acc_nw', unitId: 'nw_east', reason: expect.any(String) }] });
    expect(res.explanation.length).toBeGreaterThan(0);
  });

  it('routes payroll contacts to the reserved Payroll account', () => {
    expect(route('payroll@paycorp-example.com').routing.candidates[0]?.accountId).toBe('acc_pay');
  });

  it('ignores inactive contacts and inactive accounts', () => {
    // Inactive contact falls through to the domain rule.
    expect(route('gone@northwind-example.com').routing).toEqual({ status: 'matched', candidates: [{ accountId: 'acc_nw', unitId: null, reason: expect.any(String) }] });
    expect(route('old@dormant-example.com', 'Dormant Mills order').routing.status).toBe('unmatched');
  });

  it('domain matches select the parent account only', () => {
    const res = route('someone@northwind-example.com', 'Coverage for next week');
    expect(res.routing).toEqual({ status: 'matched', candidates: [{ accountId: 'acc_nw', unitId: null, reason: expect.any(String) }] });
  });

  it('a unique unit name or alias narrows a domain match to that unit; inactive units never match', () => {
    expect(route('someone@northwind-example.com', 'Plant 2 needs forklift drivers').routing.candidates[0]?.unitId).toBe('nw_east');
    expect(route('someone@northwind-example.com', 'East Plant and West Plant').routing.candidates[0]?.unitId).toBeNull();
    expect(route('someone@northwind-example.com', 'Riverside Annex request').routing.candidates[0]?.unitId).toBeNull();
  });

  it('a shared domain is ambiguous unless a name in the message narrows it', () => {
    const amb = route('ops@shared-parent-example.com', 'Weekly request');
    expect(amb.routing.status).toBe('ambiguous');
    expect(amb.routing.candidates.map((c) => c.accountId).sort()).toEqual(['acc_bb', 'acc_co']);

    const narrowed = route('ops@shared-parent-example.com', 'Request', 'Please staff the cobalt line.');
    expect(narrowed.routing).toEqual({ status: 'matched', candidates: [{ accountId: 'acc_co', unitId: null, reason: expect.any(String) }] });

    const both = route('ops@shared-parent-example.com', 'Bluebird and Cobalt');
    expect(both.routing.status).toBe('ambiguous');
  });

  it('a contact on several accounts is ambiguous unless narrowed', () => {
    const twin = account({ id: 'acc_tw', name: 'Twinleaf Packaging', contacts: [contact({ id: 'c9', email: 'lee@bluebird-example.com' })] });
    const accounts = [bluebird, twin];
    const amb = routeEmail({ fromAddress: 'lee@bluebird-example.com', subject: 'Hello', body: '' }, accounts);
    expect(amb.routing.status).toBe('ambiguous');
    expect(amb.routing.candidates).toHaveLength(2);
    const narrowed = routeEmail({ fromAddress: 'lee@bluebird-example.com', subject: 'Twinleaf Packaging order', body: '' }, accounts);
    expect(narrowed.routing.candidates).toEqual([{ accountId: 'acc_tw', unitId: null, reason: expect.any(String) }]);
    expect(narrowed.routing.status).toBe('matched');
  });

  it('text-only: one account named in the subject matches; body-only is ambiguous; none is unmatched', () => {
    expect(route('stranger@unknown-example.org', 'Northwind second shift').routing).toEqual({
      status: 'matched',
      candidates: [{ accountId: 'acc_nw', unitId: null, reason: expect.any(String) }],
    });
    const bodyOnly = route('stranger@unknown-example.org', 'Quick question', 'This is about Northwind.');
    expect(bodyOnly.routing.status).toBe('ambiguous');
    expect(bodyOnly.routing.candidates.map((c) => c.accountId)).toEqual(['acc_nw']);
    expect(route('stranger@unknown-example.org', 'Hello', 'Nothing relevant').routing).toEqual({ status: 'unmatched', candidates: [] });
  });

  it('never guesses between several named accounts', () => {
    const res = route('stranger@unknown-example.org', 'Northwind vs Bluebird');
    expect(res.routing.status).toBe('ambiguous');
    expect(res.routing.candidates.map((c) => c.accountId).sort()).toEqual(['acc_bb', 'acc_nw']);
  });

  it('matches whole words only, case-insensitively, and ignores short aliases', () => {
    expect(route('x@unknown-example.org', 'NORTHWIND update').routing.status).toBe('matched');
    expect(route('x@unknown-example.org', 'Northwindy weather').routing.status).toBe('unmatched');
    // 'CF' is shorter than 3 characters and must not match.
    expect(route('x@unknown-example.org', 'CF order').routing.status).toBe('unmatched');
  });

  it('reserved accounts are never chosen by text or domain', () => {
    expect(route('x@unknown-example.org', 'Payroll question').routing.status).toBe('unmatched');
  });

  it('caps candidates at 10', () => {
    const many = Array.from({ length: 12 }, (_, i) => account({ id: `acc_${i}`, name: `Shared ${i}`, domains: ['many-example.com'] }));
    expect(routeEmail({ fromAddress: 'a@many-example.com', subject: '', body: '' }, many).routing.candidates).toHaveLength(10);
  });
});
