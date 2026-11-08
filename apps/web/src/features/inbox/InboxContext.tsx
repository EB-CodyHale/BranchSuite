import type { Branch, Task, TaskCategory } from '@branchsuite/shared';
import { createContext, useContext } from 'react';
import type { InboxLookups } from './inboxModel.js';

export interface InboxEnv extends InboxLookups {
  branchesById: Map<string, Branch>;
  /** Several branches (or personal tasks alongside branch tasks) are on screen. */
  multiBranch: boolean;
  /** Viewing a past day: a read-only record. */
  readOnly: boolean;
  viewerId: string;
  /** Today's day key for a task's branch (personal tasks use the view's today). */
  todayFor: (task: Pick<Task, 'branchId'>) => string;
  canManage: (branchId: string) => boolean;
}

export interface InboxActions {
  open: (task: Task) => void;
  claim: (task: Task) => void;
  /** null restores the automatic category. */
  recategorize: (task: Task, category: TaskCategory | null) => void;
  complete: (task: Task) => void;
  reopen: (task: Task) => void;
  /** Task ids with a claim/complete/reopen request in flight. */
  busyIds: ReadonlySet<string>;
}

export const InboxEnvContext = createContext<InboxEnv | null>(null);
export const InboxActionsContext = createContext<InboxActions | null>(null);

export function useInboxEnv(): InboxEnv {
  const ctx = useContext(InboxEnvContext);
  if (!ctx) throw new Error('useInboxEnv must be used inside the inbox.');
  return ctx;
}

export function useInboxActions(): InboxActions {
  const ctx = useContext(InboxActionsContext);
  if (!ctx) throw new Error('useInboxActions must be used inside the inbox.');
  return ctx;
}
