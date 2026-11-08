/**
 * Board-wide context. Two separate contexts so cards stay memoized:
 * - BoardEnv changes only when the roster, accounts or permissions change.
 * - BoardActions is stable for the life of the page (dialog openers, quick mutations).
 */
import type { AccountLite, Branch, Order, PersonLite } from '@branchsuite/shared';
import { createContext, useContext } from 'react';

export interface BoardEnv {
  accountsById: Map<string, AccountLite>;
  peopleById: Map<string, PersonLite>;
  branchesById: Map<string, Branch>;
  /** More than one branch in scope: cards show a branch chip. */
  multiBranch: boolean;
  canManage: (branchId: string) => boolean;
  pipelineEnabled: boolean;
  viewerId: string;
  /** Branch-local today per branch id (from the board response). */
  today: Record<string, string>;
}

export type OrderDialogKind = 'edit' | 'addOpenings' | 'pause' | 'close' | 'history';

export interface BoardActions {
  /** Open a dialog or drawer for an order. */
  open: (kind: OrderDialogKind, order: Order) => void;
  /** Start a new order (optionally in a given branch). */
  create: (branchId?: string) => void;
  publish: (order: Order) => void;
  resume: (order: Order) => void;
}

export const BoardEnvContext = createContext<BoardEnv | null>(null);
export const BoardActionsContext = createContext<BoardActions | null>(null);

export function useBoardEnv(): BoardEnv {
  const ctx = useContext(BoardEnvContext);
  if (!ctx) throw new Error('useBoardEnv must be used inside the board page.');
  return ctx;
}

export function useBoardActions(): BoardActions {
  const ctx = useContext(BoardActionsContext);
  if (!ctx) throw new Error('useBoardActions must be used inside the board page.');
  return ctx;
}
