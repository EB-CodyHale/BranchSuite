import type { AccountLite, Candidate, Order, PersonLite, PipelineStage } from '@branchsuite/shared';
import { createContext, useContext } from 'react';

export interface PipelineEnv {
  branchId: string;
  /** Branch-local today day key. */
  today: string | undefined;
  viewerId: string;
  accountsById: Map<string, AccountLite>;
  peopleById: Map<string, PersonLite>;
  ordersById: Map<string, Order>;
  /** Board orders of this branch (active/paused/draft). */
  orders: Order[];
  recruiters: PersonLite[];
  accounts: AccountLite[];
}

export interface PipelineActions {
  openCandidate: (candidateId: string) => void;
  /** Move a candidate; asks for a drop reason / start date first when the stage needs one. */
  requestMove: (candidate: Candidate, stage: PipelineStage) => void;
  /** Candidate ids with a stage write in flight. */
  movingIds: ReadonlySet<string>;
}

export const PipelineEnvContext = createContext<PipelineEnv | null>(null);
export const PipelineActionsContext = createContext<PipelineActions | null>(null);

export function usePipelineEnv(): PipelineEnv {
  const ctx = useContext(PipelineEnvContext);
  if (!ctx) throw new Error('usePipelineEnv must be used inside the pipeline page.');
  return ctx;
}

export function usePipelineActions(): PipelineActions {
  const ctx = useContext(PipelineActionsContext);
  if (!ctx) throw new Error('usePipelineActions must be used inside the pipeline page.');
  return ctx;
}
