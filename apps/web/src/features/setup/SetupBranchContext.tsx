/**
 * Setup works on one branch at a time. The selected branch is shared by every branch-scoped
 * section (people, accounts, displays, wall settings, filtered mail) so switching sections keeps
 * the manager's place. It starts from the board's branch scope when that is a single branch.
 */
import type { Branch } from '@branchsuite/shared';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ALL_BRANCHES, useBranchScope } from '../../app/BranchScope.js';
import { useMeContext } from '../../app/MeContext.js';
import { useBranches } from '../../lib/queries.js';

export interface SetupBranchValue {
  /** Selected branch id ('' when the caller manages no active branch). */
  branchId: string;
  branch: Branch | undefined;
  /** Active branches the caller manages, by name. */
  branches: Branch[];
  setBranchId: (id: string) => void;
}

const SetupBranchContext = createContext<SetupBranchValue | null>(null);

export function SetupBranchProvider({ children }: { children: ReactNode }) {
  const { me, permissions } = useMeContext();
  const { scope } = useBranchScope();
  // Fresh branch records (wall settings change here); me.branches is the fallback while loading.
  const { data: fetched } = useBranches();

  const branches = useMemo(() => {
    const managed = new Set(permissions.manageBranchIds);
    const source = fetched ?? me.branches;
    return source.filter((b) => b.active && managed.has(b.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [fetched, me.branches, permissions.manageBranchIds]);

  const [chosen, setChosen] = useState<string | null>(() => (scope !== ALL_BRANCHES ? scope : null));
  const branchId = branches.some((b) => b.id === chosen) ? (chosen as string) : (branches[0]?.id ?? '');

  const value = useMemo<SetupBranchValue>(
    () => ({ branchId, branch: branches.find((b) => b.id === branchId), branches, setBranchId: setChosen }),
    [branchId, branches],
  );
  return <SetupBranchContext.Provider value={value}>{children}</SetupBranchContext.Provider>;
}

export function useSetupBranch(): SetupBranchValue {
  const ctx = useContext(SetupBranchContext);
  if (!ctx) throw new Error('useSetupBranch must be used inside <SetupBranchProvider>.');
  return ctx;
}
