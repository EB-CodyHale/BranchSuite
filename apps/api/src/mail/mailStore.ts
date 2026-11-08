/**
 * Mail-owned documents (ARCHITECTURE §3) written directly on the DocStore, so the shared Repo
 * interface stays limited to what routes need:
 *
 * | type          | container | partition            | id                                  |
 * | ------------- | --------- | -------------------- | ----------------------------------- |
 * | receipt       | mail      | mailbox:<mailboxId>  | rcpt_<sha256(mailboxId|graphId)>    | TTL mailReceiptTtlSeconds
 * | mailboxState  | mail      | mailbox:<mailboxId>  | state_<folder>                      |
 * | thread        | mail      | <scopeId>            | thr_<sha256(conversationId)>        |
 * | lock          | directory | lock                 | mail-sync                           |
 *
 * Tasks, orders, messages and filtered mail use the DocumentRepo layout (DOC_KINDS + toDoc).
 */
import { LIMITS } from '@branchsuite/shared';
import { sha256Hex } from '../security/crypto.js';
import { AlreadyExistsError, PreconditionFailedError, type Doc, type DocStore } from '../data/store.js';
import type { MailFolder } from './graph.js';

export const mailboxPartition = (mailboxId: string) => `mailbox:${mailboxId}`;
export const receiptId = (mailboxId: string, graphId: string) => `rcpt_${sha256Hex(`${mailboxId}|${graphId}`)}`;
export const threadId = (conversationId: string) => `thr_${sha256Hex(conversationId)}`;

export interface Receipt {
  id: string;
  mailboxId: string;
  graphId: string;
  /** Hash of identifying fields; a different hash on replay is logged (changed payload, same id). */
  payloadHash: string;
  outcome: string;
  targetScopeId: string | null;
  taskId: string | null;
  at: string;
}

export interface MailboxFolderState {
  id: string;
  mailboxId: string;
  folder: MailFolder;
  /** Next request URL: a nextLink (round in progress) or a deltaLink (round complete). */
  link: string | null;
  linkKind: 'next' | 'delta' | null;
  /** Messages received before this instant are never processed (no history backfill). */
  processAfter: string;
  initializedAt: string;
  lastSyncAt: string | null;
  resets: number;
}

export interface ThreadLink {
  id: string;
  scopeId: string;
  conversationId: string;
  taskId: string;
  mailboxId: string;
  updatedAt: string;
}

function strip<T>(doc: Doc): T {
  const out: Record<string, unknown> = { ...doc };
  for (const f of ['_rid', '_self', '_ts', '_attachments', '_etag', 'type', 'ttl']) delete out[f];
  return out as T;
}

export class MailStore {
  constructor(readonly store: DocStore) {}

  // ----- receipts -----
  async getReceipt(mailboxId: string, graphId: string): Promise<Receipt | null> {
    const found = await this.store.read('mail', mailboxPartition(mailboxId), receiptId(mailboxId, graphId));
    return found && found.doc.type === 'receipt' ? strip<Receipt>(found.doc) : null;
  }

  /** Written LAST in the pipeline. A concurrent duplicate is harmless (same outcome). */
  async putReceipt(receipt: Omit<Receipt, 'id'>): Promise<void> {
    const doc: Doc = {
      ...receipt,
      id: receiptId(receipt.mailboxId, receipt.graphId),
      type: 'receipt',
      scopeId: mailboxPartition(receipt.mailboxId),
      ttl: LIMITS.mailReceiptTtlSeconds,
    };
    try {
      await this.store.create('mail', doc);
    } catch (err) {
      if (!(err instanceof AlreadyExistsError)) throw err;
    }
  }

  // ----- mailbox folder state -----
  async getState(mailboxId: string, folder: MailFolder): Promise<{ state: MailboxFolderState; etag: string } | null> {
    const found = await this.store.read('mail', mailboxPartition(mailboxId), `state_${folder}`);
    return found && found.doc.type === 'mailboxState' ? { state: strip<MailboxFolderState>(found.doc), etag: found.etag } : null;
  }

  /** Save state; `etag` null creates. Throws PreconditionFailedError / AlreadyExistsError on a race. */
  async putState(state: MailboxFolderState, etag: string | null): Promise<string> {
    const doc: Doc = { ...state, type: 'mailboxState', scopeId: mailboxPartition(state.mailboxId) };
    await this.store.commit('mail', doc.scopeId as string, [etag === null ? { kind: 'create', doc } : { kind: 'replace', doc, etag }]);
    const after = await this.store.read('mail', doc.scopeId as string, state.id);
    return after?.etag ?? '';
  }

  // ----- threads -----
  async getThread(scopeId: string, conversationId: string): Promise<ThreadLink | null> {
    if (!conversationId) return null;
    const found = await this.store.read('mail', scopeId, threadId(conversationId));
    return found && found.doc.type === 'thread' ? strip<ThreadLink>(found.doc) : null;
  }

  /** Upsert conversationId -> taskId (latest task wins). */
  async putThread(link: Omit<ThreadLink, 'id'>): Promise<void> {
    if (!link.conversationId) return;
    const id = threadId(link.conversationId);
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.store.read('mail', link.scopeId, id);
      const doc: Doc = { ...link, id, type: 'thread' };
      try {
        await this.store.commit('mail', link.scopeId, [current ? { kind: 'replace', doc, etag: current.etag } : { kind: 'create', doc }]);
        return;
      } catch (err) {
        if (!(err instanceof PreconditionFailedError || err instanceof AlreadyExistsError)) throw err;
      }
    }
  }
}

// ---------- sync lease ----------
export const LOCK_ID = 'mail-sync';
export const LOCK_PARTITION = 'lock';

export interface Lease {
  holder: string;
  /** Extend the lease; false when it was lost to another holder. */
  renew(): Promise<boolean>;
  release(): Promise<void>;
}

/**
 * Acquire the sync lease (directory container, pk 'lock') with an ETag precondition. Returns null
 * when another holder has an unexpired lease or wins the race.
 */
export async function acquireLease(store: DocStore, holder: string, now: () => Date, ttlMs: number): Promise<Lease | null> {
  const write = async (etag: string | null): Promise<boolean> => {
    const at = now();
    const doc: Doc = { id: LOCK_ID, type: 'lock', pk: LOCK_PARTITION, holder, acquiredAt: at.toISOString(), expiresAt: new Date(at.getTime() + ttlMs).toISOString() };
    try {
      await store.commit('directory', LOCK_PARTITION, [etag === null ? { kind: 'create', doc } : { kind: 'replace', doc, etag }]);
      return true;
    } catch (err) {
      if (err instanceof PreconditionFailedError || err instanceof AlreadyExistsError) return false;
      throw err;
    }
  };

  const current = await store.read('directory', LOCK_PARTITION, LOCK_ID);
  if (current) {
    const expiresAt = Date.parse(String(current.doc.expiresAt ?? ''));
    const held = current.doc.holder !== holder && Number.isFinite(expiresAt) && expiresAt > now().getTime();
    if (held) return null;
  }
  if (!(await write(current ? current.etag : null))) return null;

  return {
    holder,
    async renew() {
      // Parallel workers of one run may renew at once: losing that race to ourselves is fine.
      for (let attempt = 0; attempt < 5; attempt++) {
        const found = await store.read('directory', LOCK_PARTITION, LOCK_ID);
        if (!found || found.doc.holder !== holder) return false;
        if (await write(found.etag)) return true;
      }
      return false;
    },
    async release() {
      const found = await store.read('directory', LOCK_PARTITION, LOCK_ID);
      if (!found || found.doc.holder !== holder) return;
      const doc: Doc = { id: LOCK_ID, type: 'lock', pk: LOCK_PARTITION, holder, acquiredAt: found.doc.acquiredAt, expiresAt: now().toISOString() };
      try {
        await store.commit('directory', LOCK_PARTITION, [{ kind: 'replace', doc, etag: found.etag }]);
      } catch (err) {
        if (!(err instanceof PreconditionFailedError)) throw err;
      }
    },
  };
}
