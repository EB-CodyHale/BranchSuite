import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from '../lib/api.js';
import { keys } from '../lib/queryKeys.js';

const MAX_RETRIES = 2;

/**
 * App-wide query client. Client errors (4xx) are final and never retried. A 401 from any request
 * means the session ended, so `me` is re-checked and the auth gate takes over.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isApiError(error, 'unauthenticated') && query.queryKey[0] !== keys.me()[0]) void client.invalidateQueries({ queryKey: keys.me(), exact: true });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isApiError(error, 'unauthenticated')) void client.invalidateQueries({ queryKey: keys.me(), exact: true });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (failureCount, error) => failureCount < MAX_RETRIES && (!isApiError(error) || error.retryable),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
