/**
 * Azure Cosmos DB for NoSQL backend. Entra ID only (managed identity via DefaultAzureCredential);
 * account keys are disabled on the resource. Every query is parameterized.
 */
import { BulkOperationType, CosmosClient, ErrorResponse, type Container, type JSONObject, type OperationInput, type SqlParameter } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { DocumentRepo } from './documentRepo.js';
import {
  AlreadyExistsError,
  PreconditionFailedError,
  assertFieldPath,
  partitionOf,
  type ContainerName,
  type Doc,
  type DocStore,
  type QuerySpec,
  type Versioned,
  type WriteOp,
} from './store.js';

export class CosmosStore implements DocStore {
  private readonly containers: Record<ContainerName, Container>;

  constructor(endpoint: string, databaseId: string) {
    const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
    const db = client.database(databaseId);
    this.containers = {
      directory: db.container('directory'),
      board: db.container('board'),
      mail: db.container('mail'),
    };
  }

  async read(container: ContainerName, partition: string, id: string): Promise<Versioned | null> {
    try {
      const res = await this.containers[container].item(id, partition).read<Doc>();
      if (!res.resource || res.statusCode === 404) return null;
      return { doc: res.resource, etag: res.etag };
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  }

  async query(container: ContainerName, spec: QuerySpec): Promise<Doc[]> {
    const { where, parameters } = compileWhere(spec);
    const top = spec.limit !== undefined ? `TOP ${Math.max(1, Math.floor(spec.limit))} ` : '';
    const order = spec.orderBy ? ` ORDER BY c.${assertFieldPath(spec.orderBy.field)} ${spec.orderBy.desc ? 'DESC' : 'ASC'}` : '';
    const query = { query: `SELECT ${top}* FROM c WHERE ${where}${order}`, parameters };
    const options = spec.partition !== undefined ? { partitionKey: spec.partition } : {};
    const { resources } = await this.containers[container].items.query<Doc>(query, options).fetchAll();
    return resources;
  }

  async count(container: ContainerName, spec: QuerySpec): Promise<number> {
    const { where, parameters } = compileWhere(spec);
    const options = spec.partition !== undefined ? { partitionKey: spec.partition } : {};
    const { resources } = await this.containers[container].items
      .query<number>({ query: `SELECT VALUE COUNT(1) FROM c WHERE ${where}`, parameters }, options)
      .fetchAll();
    return resources[0] ?? 0;
  }

  async create(container: ContainerName, doc: Doc): Promise<Versioned> {
    try {
      const res = await this.containers[container].items.create<Doc>(doc);
      return { doc: res.resource as Doc, etag: res.etag };
    } catch (err) {
      if (statusOf(err) === 409) throw new AlreadyExistsError();
      throw err;
    }
  }

  async commit(container: ContainerName, partition: string, ops: WriteOp[]): Promise<void> {
    const c = this.containers[container];
    // Single-document writes use point operations (cheaper than a batch, same guarantees).
    if (ops.length === 1) {
      const op = ops[0] as WriteOp;
      try {
        if (op.kind === 'create') await c.items.create(op.doc);
        else if (op.kind === 'replace') await c.item(op.doc.id, partition).replace(op.doc, { accessCondition: { type: 'IfMatch', condition: op.etag } });
        else await c.item(op.id, partition).delete({ accessCondition: { type: 'IfMatch', condition: op.etag } });
      } catch (err) {
        throw mapWriteError(err);
      }
      return;
    }
    const operations = ops.map((op): OperationInput => {
      // Cosmos batches carry no ETag precondition for deletes, so a conditional delete must stand alone.
      if (op.kind === 'delete') throw new Error('A conditional delete cannot be part of a multi-document batch');
      if (partitionOf(container, op.doc) !== partition) throw new Error('Batch spans partitions');
      // Documents are plain JSON by construction (validated entities).
      const resourceBody = op.doc as unknown as JSONObject;
      return op.kind === 'create'
        ? { operationType: BulkOperationType.Create, resourceBody }
        : { operationType: BulkOperationType.Replace, id: op.doc.id, resourceBody, ifMatch: op.etag };
    });
    let results;
    try {
      results = (await c.items.batch(operations, partition)).result ?? [];
    } catch (err) {
      throw mapWriteError(err);
    }
    const failed = results.find((r) => r.statusCode >= 400 && r.statusCode !== 424);
    if (failed) throw mapWriteError(failed.statusCode);
  }
}

/** Repository over Cosmos DB. */
export class CosmosRepo extends DocumentRepo {
  constructor(endpoint: string, databaseId: string) {
    super(new CosmosStore(endpoint, databaseId));
  }
}

function compileWhere(spec: QuerySpec): { where: string; parameters: SqlParameter[] } {
  const parameters: SqlParameter[] = [{ name: '@type', value: spec.type }];
  const clauses = ['c.type = @type'];
  (spec.filters ?? []).forEach((f, i) => {
    const field = `c.${assertFieldPath(f.field)}`;
    const p = `@p${i}`;
    switch (f.op) {
      case 'contains':
        clauses.push(`ARRAY_CONTAINS(${field}, ${p})`);
        break;
      case 'in':
        clauses.push(`ARRAY_CONTAINS(${p}, ${field})`);
        break;
      case 'defined':
        clauses.push(`(IS_DEFINED(${field}) AND NOT IS_NULL(${field}))`);
        return;
      default:
        clauses.push(`${field} ${f.op} ${p}`);
    }
    parameters.push({ name: p, value: f.value as SqlParameter['value'] });
  });
  return { where: clauses.join(' AND '), parameters };
}

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'number') return err;
  if (err instanceof ErrorResponse || (typeof err === 'object' && err !== null && 'code' in err)) {
    const code = (err as { code?: unknown; statusCode?: unknown }).code ?? (err as { statusCode?: unknown }).statusCode;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

function mapWriteError(err: unknown): unknown {
  const status = statusOf(err);
  if (status === 412 || status === 404) return new PreconditionFailedError();
  if (status === 409) return new AlreadyExistsError();
  return typeof err === 'number' ? new Error(`Cosmos batch failed with status ${err}`) : err;
}
