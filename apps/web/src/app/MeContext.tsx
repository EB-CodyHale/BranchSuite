import type { MeResponse, Permissions } from '@branchsuite/shared';
import { canManage as canManageBranch } from '@branchsuite/shared';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

export interface MeContextValue {
  me: MeResponse;
  permissions: Permissions;
  isAdmin: boolean;
  /** True when the caller manages at least one branch (managers and admins). */
  canManageAny: boolean;
  canManage: (branchId: string) => boolean;
}

const MeContext = createContext<MeContextValue | null>(null);

export function MeProvider({ me, children }: { me: MeResponse; children: ReactNode }) {
  const value = useMemo<MeContextValue>(
    () => ({
      me,
      permissions: me.permissions,
      isAdmin: me.permissions.isAdmin,
      canManageAny: me.permissions.isAdmin || me.permissions.manageBranchIds.length > 0,
      canManage: (branchId) => canManageBranch(me.permissions, branchId),
    }),
    [me],
  );
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

/** Signed-in user, permissions and feature flags. Only available inside the authenticated shell. */
export function useMeContext(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMeContext must be used inside the authenticated app (MeProvider).');
  return ctx;
}
