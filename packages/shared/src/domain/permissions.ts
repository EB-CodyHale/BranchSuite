/**
 * Authorization model (authoritative in the API; mirrored in the web UI to hide controls).
 * admin   : everything, every branch (no membership needed).
 * manager : read + manage the branches in user.branchIds.
 * member  : read branches in user.branchIds; fill/clear lines; create/claim/complete tasks; manage pipeline candidates.
 * Inactive users: nothing.
 */
import type { Permissions } from '../api.js';
import type { Branch, User } from '../schemas.js';

/** Only active branches are ever readable or manageable. Membership in an inactive branch grants nothing. */
export function computePermissions(user: Pick<User, 'role' | 'branchIds' | 'active'>, branches: Pick<Branch, 'id' | 'active'>[]): Permissions {
  if (!user.active) return { branchIds: [], manageBranchIds: [], isAdmin: false };
  const activeIds = branches.filter((b) => b.active).map((b) => b.id);
  if (user.role === 'admin') return { branchIds: activeIds, manageBranchIds: [...activeIds], isAdmin: true };
  const member = new Set(user.branchIds);
  const readable = activeIds.filter((id) => member.has(id));
  return { branchIds: readable, manageBranchIds: user.role === 'manager' ? [...readable] : [], isAdmin: false };
}

export function canRead(perms: Permissions, branchId: string): boolean {
  return perms.branchIds.includes(branchId);
}

export function canManage(perms: Permissions, branchId: string): boolean {
  return perms.manageBranchIds.includes(branchId);
}

type EditResult = { ok: true } | { ok: false; reason: string };
const deny = (reason: string): EditResult => ({ ok: false, reason });

/**
 * Can `actor` create/update `target` user with the proposed role/branches?
 * admin: yes. manager: only role member|manager, only branches within actor's manageBranchIds,
 * and (for updates) only targets whose existing branchIds intersect actor's managed branches and who are not admin.
 * Managers may not remove branches they don't manage from a target. Nobody may change their own role.
 * `target` null means create; a manager must then name at least one branch.
 */
export function canEditUser(actor: Pick<User, 'id' | 'role'> & { perms: Permissions }, target: Pick<User, 'id' | 'role' | 'branchIds'> | null, next: { role?: User['role']; branchIds?: string[] }): EditResult {
  if (target !== null && target.id === actor.id && next.role !== undefined && next.role !== target.role) {
    return deny('You cannot change your own role.');
  }
  if (actor.role === 'admin' && actor.perms.isAdmin) return { ok: true };
  if (actor.role !== 'manager') return deny('Only managers and admins can manage people.');

  const managed = new Set(actor.perms.manageBranchIds);
  if (managed.size === 0) return deny('You do not manage any branch.');
  if (next.role === 'admin') return deny('Only an admin can grant the admin role.');

  if (target === null) {
    if (!next.branchIds || next.branchIds.length === 0) return deny('Choose at least one branch.');
    if (next.branchIds.some((id) => !managed.has(id))) return deny('You can only assign branches you manage.');
    return { ok: true };
  }

  if (target.role === 'admin') return deny('Only an admin can change an admin.');
  if (!target.branchIds.some((id) => managed.has(id))) return deny('This person is not in a branch you manage.');
  // The role is global: promoting (or demoting) someone who also works in a branch the actor does not
  // manage would grant (or strip) manager powers there. Only an admin may do that.
  if (next.role !== undefined && next.role !== target.role) {
    const branchesAfter = next.branchIds ?? target.branchIds;
    if (branchesAfter.some((id) => !managed.has(id))) {
      return deny('Only an admin can change the role of someone who also works in a branch you do not manage.');
    }
  }
  if (next.branchIds) {
    const before = new Set(target.branchIds);
    const after = new Set(next.branchIds);
    if (next.branchIds.some((id) => !before.has(id) && !managed.has(id))) return deny('You can only assign branches you manage.');
    if (target.branchIds.some((id) => !after.has(id) && !managed.has(id))) {
      return deny('You cannot remove a branch you do not manage.');
    }
  }
  return { ok: true };
}
