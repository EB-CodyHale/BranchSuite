/**
 * Pipeline-facing names for the shared candidate mutations. Both PATCH and archive return a
 * CandidateMutationResult, and the shared hooks write the candidate and any changed order into the caches.
 */
import type { Candidate } from '@branchsuite/shared';
import { useArchiveCandidate, useUpdateCandidate } from '../../lib/queries.js';

export const useSaveCandidate = useUpdateCandidate;

/** Archive; the server releases a held line and the result updates the board cache. */
export function useArchive() {
  const archive = useArchiveCandidate();
  return {
    ...archive,
    run: async (candidate: Candidate) => (await archive.mutateAsync({ branchId: candidate.branchId, candidateId: candidate.id })).candidate,
  };
}
