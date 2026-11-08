import { describe, expect, it } from 'vitest';
import type { Permissions } from '../api.js';
import type { User } from '../schemas.js';
import { canEditUser, canManage, canRead, computePermissions } from './permissions.js';

const branches = [
  { id: 'br_1', active: true },
  { id: 'br_2', active: true },
  { id: 'br_3', active: true },
  { id: 'br_off', active: false },
];

describe('computePermissions', () => {
  it('admin: every active branch, read and manage, no membership needed', () => {
    expect(computePermissions({ role: 'admin', branchIds: [], active: true }, branches)).toEqual({
      branchIds: ['br_1', 'br_2', 'br_3'],
      manageBranchIds: ['br_1', 'br_2', 'br_3'],
      isAdmin: true,
    });
  });
  it('manager: reads and manages own active branches', () => {
    expect(computePermissions({ role: 'manager', branchIds: ['br_2', 'br_off', 'br_ghost'], active: true }, branches)).toEqual({
      branchIds: ['br_2'],
      manageBranchIds: ['br_2'],
      isAdmin: false,
    });
  });
  it('member: reads own active branches, manages none', () => {
    expect(computePermissions({ role: 'member', branchIds: ['br_1', 'br_3'], active: true }, branches)).toEqual({
      branchIds: ['br_1', 'br_3'],
      manageBranchIds: [],
      isAdmin: false,
    });
  });
  it.each(['admin', 'manager', 'member'] as const)('inactive %s gets nothing', (role) => {
    expect(computePermissions({ role, branchIds: ['br_1'], active: false }, branches)).toEqual({ branchIds: [], manageBranchIds: [], isAdmin: false });
  });
});

describe('canRead / canManage matrix', () => {
  const cases: Array<[User['role'], boolean, string, boolean, boolean]> = [
    ['admin', true, 'br_3', true, true],
    ['admin', true, 'br_off', false, false],
    ['manager', true, 'br_1', true, true],
    ['manager', true, 'br_2', false, false],
    ['member', true, 'br_1', true, false],
    ['member', true, 'br_2', false, false],
    ['admin', false, 'br_1', false, false],
    ['manager', false, 'br_1', false, false],
    ['member', false, 'br_1', false, false],
  ];
  it.each(cases)('%s (active=%s) on %s: read=%s manage=%s', (role, active, branchId, read, manage) => {
    const perms = computePermissions({ role, branchIds: ['br_1'], active }, branches);
    expect(canRead(perms, branchId)).toBe(read);
    expect(canManage(perms, branchId)).toBe(manage);
  });
});

describe('canEditUser', () => {
  const adminPerms = computePermissions({ role: 'admin', branchIds: [], active: true }, branches);
  const mgrPerms: Permissions = computePermissions({ role: 'manager', branchIds: ['br_1', 'br_2'], active: true }, branches);
  const memberPerms = computePermissions({ role: 'member', branchIds: ['br_1'], active: true }, branches);
  const admin = { id: 'usr_admin', role: 'admin' as const, perms: adminPerms };
  const mgr = { id: 'usr_mgr', role: 'manager' as const, perms: mgrPerms };
  const member = { id: 'usr_mem', role: 'member' as const, perms: memberPerms };
  const target = (over: Partial<Pick<User, 'id' | 'role' | 'branchIds'>> = {}) => ({ id: 'usr_t', role: 'member' as const, branchIds: ['br_1'], ...over });

  it('admins can do anything to others', () => {
    expect(canEditUser(admin, null, { role: 'admin', branchIds: ['br_3'] })).toEqual({ ok: true });
    expect(canEditUser(admin, target({ role: 'admin', branchIds: ['br_3'] }), { role: 'member' })).toEqual({ ok: true });
  });

  it('nobody may change their own role', () => {
    expect(canEditUser(admin, { id: 'usr_admin', role: 'admin', branchIds: [] }, { role: 'manager' }).ok).toBe(false);
    expect(canEditUser(mgr, { id: 'usr_mgr', role: 'manager', branchIds: ['br_1'] }, { role: 'member' }).ok).toBe(false);
    // Same role is not a change.
    expect(canEditUser(mgr, { id: 'usr_mgr', role: 'manager', branchIds: ['br_1'] }, { role: 'manager' }).ok).toBe(true);
  });

  it('members cannot manage people', () => {
    expect(canEditUser(member, null, { role: 'member', branchIds: ['br_1'] }).ok).toBe(false);
    expect(canEditUser(member, target(), {}).ok).toBe(false);
  });

  it('a manager without managed branches cannot manage people', () => {
    const lonely = { id: 'usr_l', role: 'manager' as const, perms: { branchIds: [], manageBranchIds: [], isAdmin: false } };
    expect(canEditUser(lonely, target(), {}).ok).toBe(false);
  });

  describe('manager creating users', () => {
    it('can create members and managers in managed branches', () => {
      expect(canEditUser(mgr, null, { role: 'member', branchIds: ['br_1'] })).toEqual({ ok: true });
      expect(canEditUser(mgr, null, { role: 'manager', branchIds: ['br_1', 'br_2'] })).toEqual({ ok: true });
    });
    it('cannot create admins, users in other branches, or users without a branch', () => {
      expect(canEditUser(mgr, null, { role: 'admin', branchIds: ['br_1'] }).ok).toBe(false);
      expect(canEditUser(mgr, null, { role: 'member', branchIds: ['br_1', 'br_3'] }).ok).toBe(false);
      expect(canEditUser(mgr, null, { role: 'member', branchIds: [] }).ok).toBe(false);
      expect(canEditUser(mgr, null, { role: 'member' }).ok).toBe(false);
    });
  });

  describe('manager updating users', () => {
    it('can update people in a managed branch, including promoting to manager', () => {
      expect(canEditUser(mgr, target(), { role: 'manager' })).toEqual({ ok: true });
      expect(canEditUser(mgr, target(), { branchIds: ['br_1', 'br_2'] })).toEqual({ ok: true });
    });
    it('cannot grant admin', () => {
      expect(canEditUser(mgr, target(), { role: 'admin' }).ok).toBe(false);
    });
    it('cannot touch admins', () => {
      expect(canEditUser(mgr, target({ role: 'admin' }), {}).ok).toBe(false);
    });
    it('cannot touch people outside managed branches', () => {
      expect(canEditUser(mgr, target({ branchIds: ['br_3'] }), { role: 'member' }).ok).toBe(false);
    });
    it('cannot add an unmanaged branch', () => {
      expect(canEditUser(mgr, target(), { branchIds: ['br_1', 'br_3'] }).ok).toBe(false);
    });
    it('keeps unmanaged branches the person already has, but cannot remove them', () => {
      const shared = target({ branchIds: ['br_1', 'br_3'] });
      expect(canEditUser(mgr, shared, { branchIds: ['br_1', 'br_2', 'br_3'] })).toEqual({ ok: true });
      expect(canEditUser(mgr, shared, { branchIds: ['br_1'] }).ok).toBe(false);
      expect(canEditUser(mgr, shared, { branchIds: ['br_3'] })).toEqual({ ok: true });
    });
    it('returns a reason when denied', () => {
      const res = canEditUser(mgr, target(), { role: 'admin' });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason.length).toBeGreaterThan(0);
    });
  });
});
