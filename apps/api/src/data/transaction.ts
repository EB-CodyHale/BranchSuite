/**
 * Optimistic concurrency, shared by every backend: read → mutate (pure) → write with ifMatch.
 * A stale ETag (another writer won) re-runs the whole read/mutate cycle, up to MAX_RETRIES times,
 * then the request fails with 409 conflict.
 */
import { HttpError } from '../http/errors.js';
import { AlreadyExistsError, PreconditionFailedError, type ContainerName, type Doc, type DocStore, type WriteOp } from './store.js';

export const MAX_RETRIES = 5;

export interface Tx {
  /** Read a document in the transaction's partition; its ETag becomes the write precondition. */
  get(id: string): Promise<Doc | null>;
}

export interface TxPlan<R> {
  /** Documents to write: replaced when read in this transaction, created otherwise. */
  writes: Doc[];
  /** Ids read in this transaction to delete (with their ETag precondition). */
  deletes?: string[];
  result: R;
}

export const conflictError = () =>
  new HttpError(409, 'conflict', 'Someone else changed this at the same time. Refresh and try again.');

/**
 * Run `fn` against a consistent snapshot of one partition and commit its writes atomically.
 * `fn` must be free of side effects other than its return value: it may run several times.
 */
export async function transact<R>(
  store: DocStore,
  container: ContainerName,
  partition: string,
  fn: (tx: Tx) => Promise<TxPlan<R>>,
): Promise<R> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const etags = new Map<string, string>();
    const tx: Tx = {
      async get(id) {
        const found = await store.read(container, partition, id);
        if (!found) return null;
        etags.set(id, found.etag);
        return structuredClone(found.doc);
      },
    };
    const plan = await fn(tx);
    const ops: WriteOp[] = plan.writes.map((doc) => {
      const etag = etags.get(doc.id);
      return etag === undefined ? { kind: 'create', doc } : { kind: 'replace', doc, etag };
    });
    for (const id of plan.deletes ?? []) {
      const etag = etags.get(id);
      if (etag === undefined) throw new Error(`Delete of ${id} without reading it first`);
      ops.push({ kind: 'delete', id, etag });
    }
    if (ops.length === 0) return plan.result;
    try {
      await store.commit(container, partition, ops);
      return plan.result;
    } catch (err) {
      // A create that collides means a concurrent writer created the same id: re-read and retry.
      if (err instanceof PreconditionFailedError || err instanceof AlreadyExistsError) continue;
      throw err;
    }
  }
  throw conflictError();
}

/**
 * Update one document. 404 when it does not exist. `fn` returns the full next document
 * (it may throw HttpError or a domain rule error to abort without writing).
 */
export async function mutate(
  store: DocStore,
  container: ContainerName,
  partition: string,
  id: string,
  fn: (doc: Doc) => Doc | Promise<Doc>,
  notFoundMessage = 'Not found.',
): Promise<Doc> {
  return transact(store, container, partition, async (tx) => {
    const current = await tx.get(id);
    if (!current) throw new HttpError(404, 'not_found', notFoundMessage);
    const next = await fn(current);
    if (next.id !== id) throw new Error('mutate must not change the document id');
    return { writes: [next], result: next };
  });
}
