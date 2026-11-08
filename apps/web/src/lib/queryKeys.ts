/**
 * Central TanStack Query key factory. Every cache entry in the app is addressed through here so
 * invalidation (mutations, realtime) and reads agree.
 *
 * Shape rule: the first element is the entity root, the second (when present) is the branch or
 * scope id. Branch-id lists are sorted and de-duplicated so ['b','a'] and ['a','b'] share a cache.
 */
export type TaskView = 'branch' | 'personal' | 'combined';
export type CandidateStatus = 'active' | 'archived';

const ids = (list: readonly string[]): string[] => [...new Set(list)].sort();

export const keys = {
  me: () => ['me'] as const,
  meMail: () => ['me', 'mail'] as const,
  branches: () => ['branches'] as const,

  usersRoot: () => ['users'] as const,
  users: (branchId?: string) => ['users', branchId ?? 'all'] as const,

  boardRoot: () => ['board'] as const,
  board: (branchIds: readonly string[]) => ['board', ids(branchIds)] as const,

  ordersRoot: (branchId: string) => ['orders', branchId] as const,
  closedOrders: (branchId: string, since?: string) => ['orders', branchId, 'closed', since ?? null] as const,
  orderHistory: (branchId: string, orderId: string) => ['orders', branchId, 'history', orderId] as const,

  accounts: (branchId: string) => ['accounts', branchId] as const,

  candidatesRoot: (branchId: string) => ['candidates', branchId] as const,
  candidates: (branchId: string, status: CandidateStatus = 'active') => ['candidates', branchId, status] as const,

  tasksRoot: () => ['tasks'] as const,
  tasks: (view: TaskView, branchIds: readonly string[], date?: string) => ['tasks', view, ids(branchIds), date ?? 'today'] as const,
  taskMessages: (scopeId: string, taskId: string) => ['taskMessages', scopeId, taskId] as const,

  mailboxes: () => ['mailboxes'] as const,
  filtered: (branchId: string) => ['filtered', branchId] as const,

  displays: (branchId: string) => ['displays', branchId] as const,

  wallRoot: () => ['wall'] as const,
  wallLegend: (branchId: string) => ['wall', branchId, 'legend'] as const,
  wallPreview: (branchId: string) => ['wall', branchId, 'preview'] as const,
  /** Device-side feed; one display token per device, so no branch id in the key. */
  wallFeed: () => ['wallDevice', 'feed'] as const,
  wallPairPoll: (pairingId: string) => ['wallDevice', 'pair', pairingId] as const,

  devUsers: () => ['devUsers'] as const,
};

/** True when `key` is a board key whose branch list includes `branchId`. */
export function boardKeyIncludes(key: readonly unknown[], branchId: string): boolean {
  return key[0] === 'board' && Array.isArray(key[1]) && (key[1] as string[]).includes(branchId);
}
