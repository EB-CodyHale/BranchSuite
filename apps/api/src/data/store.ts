/**
 * Low-level document store. MemoryStore and CosmosStore implement it; DocumentRepo builds every
 * intent-level repository method on top of it, so both backends share one set of semantics
 * (partitioning, ETag preconditions, retries, TTL, field stripping).
 */

export type ContainerName = 'directory' | 'board' | 'mail';

/** Partition key path per container (ARCHITECTURE §3). */
export const PARTITION_FIELD: Record<ContainerName, 'pk' | 'scopeId'> = {
  directory: 'pk',
  board: 'scopeId',
  mail: 'scopeId',
};

/** A stored JSON document. `type` discriminates entities sharing a container. */
export interface Doc {
  id: string;
  type: string;
  ttl?: number;
  [key: string]: unknown;
}

export interface Versioned {
  doc: Doc;
  etag: string;
}

export type FilterOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'contains' | 'in' | 'defined';

/**
 * One condition on a document field. `field` is always a code constant (never user input);
 * `value` is always passed as a query parameter.
 * - contains: array field contains value.  in: field value is one of the value array.
 * - defined: field exists and is not null (value ignored).
 */
export interface Filter {
  field: string;
  op: FilterOp;
  value?: unknown;
}

export interface QuerySpec {
  /** Single-partition query when set; cross-partition otherwise. */
  partition?: string;
  type: string;
  filters?: Filter[];
  orderBy?: { field: string; desc?: boolean };
  limit?: number;
}

export type WriteOp = { kind: 'create'; doc: Doc } | { kind: 'replace'; doc: Doc; etag: string } | { kind: 'delete'; id: string; etag: string };

/** An ETag precondition failed (another writer won). */
export class PreconditionFailedError extends Error {
  constructor(message = 'Precondition failed') {
    super(message);
    this.name = 'PreconditionFailedError';
  }
}

/** A create collided with an existing id. */
export class AlreadyExistsError extends Error {
  constructor(message = 'Document already exists') {
    super(message);
    this.name = 'AlreadyExistsError';
  }
}

export interface DocStore {
  read(container: ContainerName, partition: string, id: string): Promise<Versioned | null>;
  query(container: ContainerName, spec: QuerySpec): Promise<Doc[]>;
  count(container: ContainerName, spec: QuerySpec): Promise<number>;
  /** Throws AlreadyExistsError when the id exists in the partition. */
  create(container: ContainerName, doc: Doc): Promise<Versioned>;
  /**
   * Atomic multi-document write inside one partition. Throws PreconditionFailedError when any
   * replace/delete ETag is stale, AlreadyExistsError when a create collides. Nothing is applied on failure.
   * A delete must be the only operation (Cosmos batches cannot carry a delete precondition).
   */
  commit(container: ContainerName, partition: string, ops: WriteOp[]): Promise<void>;
}

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** Field paths come from code; this guard keeps them from ever becoming an injection vector. */
export function assertFieldPath(field: string): string {
  if (!FIELD_RE.test(field)) throw new Error(`Invalid field path: ${field}`);
  return field;
}

export function partitionOf(container: ContainerName, doc: Doc): string {
  const value = doc[PARTITION_FIELD[container]];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Document ${doc.id} has no ${PARTITION_FIELD[container]} for container ${container}`);
  }
  return value;
}
