/**
 * Whiteboard image bytes. Metadata lives in the board container (type 'media'); bytes live here.
 * - BlobMediaStore: private Azure Blob container, managed identity (DefaultAzureCredential). Blob name
 *   `<branchId>/<mediaId>`. No public access, no SAS: bytes are only ever served through the API.
 * - MemoryMediaStore: tests and local dev, optional persistence directory (apps/api/.data/media).
 * - UnconfiguredMediaStore: Azure deployment without MEDIA_BLOB_ENDPOINT; uploads fail with a clear error.
 */
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from '../http/errors.js';

export interface MediaStore {
  readonly kind: 'memory' | 'blob' | 'none';
  put(branchId: string, mediaId: string, bytes: Buffer, contentType: string): Promise<void>;
  /** null when the object does not exist. */
  get(branchId: string, mediaId: string): Promise<Buffer | null>;
}

/** Ids come from newId (validated by zId), but never let one escape its branch folder. */
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]{1,128}$/;
export function mediaObjectName(branchId: string, mediaId: string): string {
  if (!SAFE_SEGMENT.test(branchId) || !SAFE_SEGMENT.test(mediaId) || branchId.startsWith('.') || mediaId.startsWith('.')) {
    throw new HttpError(404, 'not_found', 'No such image.');
  }
  return `${branchId}/${mediaId}`;
}

export class MemoryMediaStore implements MediaStore {
  readonly kind = 'memory' as const;
  private readonly objects = new Map<string, Buffer>();

  /** `dir`: optional persistence directory (dev only). */
  constructor(private readonly dir: string | null = null) {}

  async put(branchId: string, mediaId: string, bytes: Buffer, _contentType: string): Promise<void> {
    const name = mediaObjectName(branchId, mediaId);
    this.objects.set(name, Buffer.from(bytes));
    if (this.dir) {
      const folder = join(this.dir, branchId);
      mkdirSync(folder, { recursive: true });
      const file = join(folder, mediaId);
      writeFileSync(`${file}.tmp`, bytes);
      renameSync(`${file}.tmp`, file);
    }
  }

  async get(branchId: string, mediaId: string): Promise<Buffer | null> {
    const name = mediaObjectName(branchId, mediaId);
    const hit = this.objects.get(name);
    if (hit) return Buffer.from(hit);
    if (this.dir) {
      const file = join(this.dir, branchId, mediaId);
      if (existsSync(file)) {
        const bytes = readFileSync(file);
        this.objects.set(name, bytes);
        return Buffer.from(bytes);
      }
    }
    return null;
  }
}

export class BlobMediaStore implements MediaStore {
  readonly kind = 'blob' as const;
  private container: ContainerClient | null = null;

  constructor(
    private readonly endpoint: string,
    private readonly containerName: string,
  ) {}

  /** Built on first use so cold starts that never touch media construct no SDK client. */
  private client(): ContainerClient {
    this.container ??= new BlobServiceClient(this.endpoint, new DefaultAzureCredential()).getContainerClient(this.containerName);
    return this.container;
  }

  async put(branchId: string, mediaId: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client()
      .getBlockBlobClient(mediaObjectName(branchId, mediaId))
      .uploadData(bytes, {
        blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: 'private, no-store' },
        // Never overwrite an existing object: media ids are unique.
        conditions: { ifNoneMatch: '*' },
      });
  }

  async get(branchId: string, mediaId: string): Promise<Buffer | null> {
    try {
      return await this.client().getBlockBlobClient(mediaObjectName(branchId, mediaId)).downloadToBuffer();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }
}

export class UnconfiguredMediaStore implements MediaStore {
  readonly kind = 'none' as const;
  async put(): Promise<void> {
    throw new HttpError(502, 'upstream_error', 'Image uploads are not configured for this deployment (MEDIA_BLOB_ENDPOINT).');
  }
  async get(): Promise<Buffer | null> {
    return null;
  }
}
