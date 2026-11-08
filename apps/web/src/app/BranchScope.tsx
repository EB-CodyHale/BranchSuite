import type { Branch } from '@branchsuite/shared';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useUpdatePreferences } from '../lib/queries.js';
import { readStorage, writeStorage } from '../lib/storage.js';
import { useMeContext } from './MeContext.js';

export const ALL_BRANCHES = 'all';
const SCOPE_KEY = 'bs.branchScope';

export interface BranchScopeValue {
  /** 'all' or a single branch id. */
  scope: string;
  /** Branch ids currently selected (every readable branch when scope is 'all'). */
  branchIds: string[];
  /** Every branch the caller can read, in display order. */
  allBranchIds: string[];
  branchesById: Map<string, Branch>;
  selectBranch: (scope: string) => void;
}

const BranchScopeContext = createContext<BranchScopeValue | null>(null);

function resolveScope(candidate: string | null | undefined, allIds: string[]): string | null {
  if (!candidate) return null;
  if (candidate === ALL_BRANCHES) return allIds.length > 1 ? ALL_BRANCHES : null;
  return allIds.includes(candidate) ? candidate : null;
}

export function BranchScopeProvider({ children }: { children: ReactNode }) {
  const { me } = useMeContext();
  const updatePreferences = useUpdatePreferences();

  const { allBranchIds, branchesById } = useMemo(() => {
    const readable = new Set(me.permissions.branchIds);
    const branches = me.branches.filter((b) => readable.has(b.id)).sort((a, b) => a.name.localeCompare(b.name));
    return { allBranchIds: branches.map((b) => b.id), branchesById: new Map(branches.map((b) => [b.id, b])) };
  }, [me]);

  const [chosen, setChosen] = useState<string | null>(() => resolveScope(me.user.preferences.branchScope, allBranchIds) ?? resolveScope(readStorage(SCOPE_KEY), allBranchIds));

  // Re-validate on every render: permissions can change underneath a stored choice.
  const scope = resolveScope(chosen, allBranchIds) ?? (allBranchIds.length === 1 ? allBranchIds[0]! : ALL_BRANCHES);

  const { mutate: savePreferences } = updatePreferences;
  const selectBranch = useCallback(
    (next: string) => {
      setChosen(next);
      writeStorage(SCOPE_KEY, next);
      savePreferences({ branchScope: next });
    },
    [savePreferences],
  );

  const value = useMemo<BranchScopeValue>(
    () => ({ scope, branchIds: scope === ALL_BRANCHES ? allBranchIds : [scope], allBranchIds, branchesById, selectBranch }),
    [scope, allBranchIds, branchesById, selectBranch],
  );
  return <BranchScopeContext.Provider value={value}>{children}</BranchScopeContext.Provider>;
}

export function useBranchScope(): BranchScopeValue {
  const ctx = useContext(BranchScopeContext);
  if (!ctx) throw new Error('useBranchScope must be used inside <BranchScopeProvider>.');
  return ctx;
}
