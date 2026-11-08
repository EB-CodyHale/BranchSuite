/**
 * In-memory document store for tests and local development. Simulates Cosmos semantics that the
 * application relies on: per-partition ids, ETags that change on every write, atomic batches,
 * TTL expiry and system properties. Optional JSON persistence keeps dev data across restarts.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DocumentRepo } from './documentRepo.js';
import {
  AlreadyExistsError,
  PARTITION_FIELD,
  PreconditionFailedError,
  partitionOf,
  type ContainerName,
  type Doc,
  type DocStore,
  type Filter,
  type QuerySpec,
  type Versioned,
  type WriteOp,
} from './store.js';

interface Entry {
  doc: Doc;
  etag: string;
}

type Snapshot = Record<ContainerName, Entry[]>;

const CONTAINERS: ContainerName[] = ['directory', 'board', 'mail'];

export interface MemoryStoreOptions {
  /** JSON file for persistence (dev only). */
  file?: string | null;
  now?: () => Date;
}

export class MemoryStore implements DocStore {
  private readonly data = new Map<ContainerName, Map<string, Entry>>(CONTAINERS.map((c) => [c, new Map()]));
  private etagSeq = 0;
  private readonly file: string | null;
  private readonly now: () => Date;

  constructor(options: MemoryStoreOptions = {}) {
    this.file = options.file ?? null;
    this.now = options.now ?? (() => new Date());
    if (this.file && existsSync(this.file)) this.load(this.file);
  }

  /** True when no document exists in any container (used to decide whether to seed). */
  isEmpty(): boolean {
    return CONTAINERS.every((c) => this.bucket(c).size === 0);
  }

  async read(container: ContainerName, partition: string, id: string): Promise<Versioned | null> {
    const entry = this.live(container, key(partition, id));
    return entry ? { doc: structuredClone(entry.doc), etag: entry.etag } : null;
  }

  async query(container: ContainerName, spec: QuerySpec): Promise<Doc[]> {
    const field = PARTITION_FIELD[container];
    let docs = [...this.bucket(container).keys()]
      .map((k) => this.live(container, k))
      .filter((e): e is Entry => e !== null)
      .map((e) => e.doc)
      .filter((d) => d.type === spec.type && (spec.partition === undefined || d[field] === spec.partition))
      .filter((d) => (spec.filters ?? []).every((f) => matches(d, f)));
    if (spec.orderBy) {
      const { field: by, desc } = spec.orderBy;
      docs.sort((a, b) => compare(getPath(a, by), getPath(b, by)) * (desc ? -1 : 1));
    }
    if (spec.limit !== undefined) docs = docs.slice(0, spec.limit);
    return docs.map((d) => structuredClone(d));
  }

  async count(container: ContainerName, spec: QuerySpec): Promise<number> {
    return (await this.query(container, { ...spec, limit: undefined, orderBy: undefined })).length;
  }

  async create(container: ContainerName, doc: Doc): Promise<Versioned> {
    const partition = partitionOf(container, doc);
    await this.commit(container, partition, [{ kind: 'create', doc }]);
    return (await this.read(container, partition, doc.id)) as Versioned;
  }

  async commit(container: ContainerName, partition: string, ops: WriteOp[]): Promise<void> {
    if (ops.length > 1 && ops.some((op) => op.kind === 'delete')) {
      // Same restriction as Cosmos: batches cannot carry a delete precondition.
      throw new Error('A conditional delete cannot be part of a multi-document batch');
    }
    // Validate every precondition first so the batch is all-or-nothing.
    for (const op of ops) {
      if (op.kind === 'delete') {
        const current = this.live(container, key(partition, op.id));
        if (!current || current.etag !== op.etag) throw new PreconditionFailedError();
        continue;
      }
      if (partitionOf(container, op.doc) !== partition) throw new Error('Batch spans partitions');
      const current = this.live(container, key(partition, op.doc.id));
      if (op.kind === 'create' && current) throw new AlreadyExistsError();
      if (op.kind === 'replace' && (!current || current.etag !== op.etag)) throw new PreconditionFailedError();
    }
    const ts = Math.floor(this.now().getTime() / 1000);
    for (const op of ops) {
      if (op.kind === 'delete') {
        this.bucket(container).delete(key(partition, op.id));
        continue;
      }
      const etag = `"m${++this.etagSeq}"`;
      const doc = { ...structuredClone(op.doc), _ts: ts, _etag: etag };
      this.bucket(container).set(key(partition, op.doc.id), { doc, etag });
    }
    this.persist();
  }

  private bucket(container: ContainerName): Map<string, Entry> {
    return this.data.get(container) as Map<string, Entry>;
  }

  /** Entry unless expired by TTL (expired entries are removed lazily, like Cosmos). */
  private live(container: ContainerName, k: string): Entry | null {
    const entry = this.bucket(container).get(k);
    if (!entry) return null;
    const ttl = entry.doc.ttl;
    const ts = entry.doc._ts;
    if (typeof ttl === 'number' && ttl > 0 && typeof ts === 'number' && ts + ttl <= this.now().getTime() / 1000) {
      this.bucket(container).delete(k);
      return null;
    }
    return entry;
  }

  private load(file: string): void {
    const snapshot = JSON.parse(readFileSync(file, 'utf8')) as Partial<Snapshot> & { etagSeq?: number };
    for (const c of CONTAINERS) {
      for (const entry of snapshot[c] ?? []) {
        this.bucket(c).set(key(partitionOf(c, entry.doc), entry.doc.id), entry);
      }
    }
    this.etagSeq = snapshot.etagSeq ?? 0;
  }

  private persist(): void {
    if (!this.file) return;
    const snapshot: Snapshot & { etagSeq: number } = {
      directory: [...this.bucket('directory').values()],
      board: [...this.bucket('board').values()],
      mail: [...this.bucket('mail').values()],
      etagSeq: this.etagSeq,
    };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot));
    renameSync(tmp, this.file);
  }
}

/** Repository over MemoryStore: identical behavior to CosmosRepo, minus the network. */
export class MemoryRepo extends DocumentRepo {
  constructor(readonly memory: MemoryStore = new MemoryStore()) {
    super(memory);
  }
}

function key(partition: string, id: string): string {
  return `${partition}\u0000${id}`;
}

function getPath(doc: unknown, path: string): unknown {
  let value: unknown = doc;
  for (const part of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function matches(doc: Doc, f: Filter): boolean {
  const v = getPath(doc, f.field);
  switch (f.op) {
    case '=':
      return v === f.value;
    case '!=':
      return v !== f.value;
    case '<':
      return v !== undefined && v !== null && compare(v, f.value) < 0;
    case '<=':
      return v !== undefined && v !== null && compare(v, f.value) <= 0;
    case '>':
      return v !== undefined && v !== null && compare(v, f.value) > 0;
    case '>=':
      return v !== undefined && v !== null && compare(v, f.value) >= 0;
    case 'contains':
      return Array.isArray(v) && v.includes(f.value);
    case 'in':
      return Array.isArray(f.value) && f.value.includes(v);
    case 'defined':
      return v !== undefined && v !== null;
  }
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return (a as string | number) < (b as string | number) ? -1 : 1;
}
