/**
 * Delta sync over every enabled mailbox (ARCHITECTURE §7 "Sync").
 *
 * - One run at a time: a Cosmos lease (`lock` document, ETag + expiry) is taken first; when another
 *   run holds it, this run is skipped.
 * - Folders: Inbox for every mailbox, SentItems for branch mailboxes (team replies).
 * - First sync of a folder never backfills history: the round starts filtered to the last hour and
 *   only messages received after the mailbox was enabled (processAfter) are processed.
 * - Bounded: a few mailboxes at a time, and a per-run message budget. When the budget runs out the
 *   folder's nextLink is saved and the next run continues from there.
 * - Mailbox status: ok / no_access (Graph 403/404) / error, with lastSyncAt and lastError.
 * - Logs carry ids and counts only, never addresses, subjects or bodies.
 */
import type { Mailbox } from '@branchsuite/shared';
import { randomToken } from '../security/crypto.js';
import { GraphAccessError, GraphDeltaResetError, type DeltaStart, type GraphClient, type MailFolder } from './graph.js';
import { IngestCache, ingestMessage, type IngestDeps } from './ingest.js';
import { acquireLease, type Lease, type MailboxFolderState } from './mailStore.js';

export interface SyncOptions {
  /** Lease lifetime (default 5 minutes). */
  leaseTtlMs?: number;
  /** Mailboxes synced in parallel (default 4). */
  concurrency?: number;
  /** Messages processed per run across all mailboxes (default 400). */
  maxMessagesPerRun?: number;
  /** How far back a fresh delta round looks (default 1 hour). */
  initialWindowMs?: number;
}

export interface SyncResult {
  mailboxes: number;
  processed: number;
  /** True when another run held the lease. */
  skipped?: boolean;
}

const HOUR = 3_600_000;

interface Budget {
  remaining: number;
}

export class MailSync {
  private readonly leaseTtlMs: number;
  private readonly concurrency: number;
  private readonly maxMessagesPerRun: number;
  private readonly initialWindowMs: number;

  constructor(
    private readonly deps: IngestDeps,
    private readonly graph: GraphClient,
    options: SyncOptions = {},
  ) {
    this.leaseTtlMs = options.leaseTtlMs ?? 5 * 60_000;
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.maxMessagesPerRun = Math.max(1, options.maxMessagesPerRun ?? 400);
    this.initialWindowMs = options.initialWindowMs ?? HOUR;
  }

  /** Mailboxes the timer syncs: enabled, and personal ones only while the feature is on. */
  private eligible(m: Mailbox): boolean {
    if (!m.enabled) return false;
    if (m.kind === 'personal') return this.deps.config.features.personalMail && m.userId !== null;
    return m.branchIds.length > 0;
  }

  async syncAll(): Promise<SyncResult> {
    return this.withLease(async (lease) => {
      const mailboxes = (await this.deps.repo.listMailboxes()).filter((m) => this.eligible(m));
      const budget: Budget = { remaining: this.maxMessagesPerRun };
      const cache = new IngestCache(this.deps.repo);
      let processed = 0;
      let next = 0;
      const worker = async () => {
        while (next < mailboxes.length) {
          const mailbox = mailboxes[next++] as Mailbox;
          if (budget.remaining <= 0) return;
          processed += await this.syncMailbox(mailbox, budget, cache);
          if (!(await lease.renew())) throw new Error('Mail sync lease was lost');
        }
      };
      await Promise.all(Array.from({ length: Math.min(this.concurrency, mailboxes.length) }, worker));
      if (budget.remaining <= 0) this.deps.log.info('Mail sync message budget reached; continuing next run', { max: this.maxMessagesPerRun });
      return { mailboxes: mailboxes.length, processed };
    });
  }

  /** Sync one mailbox now (admin "Sync now"), respecting the lease. */
  async syncOne(mailboxId: string): Promise<SyncResult> {
    return this.withLease(async () => {
      const mailbox = await this.deps.repo.getMailbox(mailboxId);
      if (!mailbox || !this.eligible(mailbox)) return { mailboxes: 0, processed: 0 };
      const processed = await this.syncMailbox(mailbox, { remaining: this.maxMessagesPerRun }, new IngestCache(this.deps.repo));
      return { mailboxes: 1, processed };
    });
  }

  private async withLease(fn: (lease: Lease) => Promise<SyncResult>): Promise<SyncResult> {
    const lease = await acquireLease(this.deps.store, `sync_${randomToken(9)}`, this.deps.now, this.leaseTtlMs);
    if (!lease) {
      this.deps.log.info('Mail sync skipped: another run holds the lease');
      return { mailboxes: 0, processed: 0, skipped: true };
    }
    try {
      return await fn(lease);
    } finally {
      await lease.release().catch((err: unknown) => this.deps.log.warn('Mail sync lease release failed', { error: String(err) }));
    }
  }

  private async syncMailbox(mailbox: Mailbox, budget: Budget, cache: IngestCache): Promise<number> {
    const folders: MailFolder[] = mailbox.kind === 'branch' ? ['inbox', 'sentitems'] : ['inbox'];
    let processed = 0;
    let status: Mailbox['status'] = 'ok';
    let lastError: string | null = null;
    try {
      for (const folder of folders) processed += await this.syncFolder(mailbox, folder, budget, cache);
    } catch (err) {
      if (err instanceof GraphAccessError) {
        status = 'no_access';
        lastError = `Microsoft Graph denied access (${err.status}). Add the mailbox to the BranchSuite mailbox group and allow up to 2 hours.`;
      } else {
        status = 'error';
        lastError = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 500);
      }
      this.deps.log.warn('Mailbox sync failed', { mailboxId: mailbox.id, status, error: err instanceof Error ? err.name : 'unknown' });
    }
    const nowIso = this.deps.now().toISOString();
    try {
      await this.deps.repo.updateMailbox(mailbox.id, (m) => ({
        ...m,
        // An admin may have disabled the mailbox meanwhile: keep 'disabled'. updatedAt is left alone
        // because it records the admin's last change (used as the enable time).
        status: m.enabled ? status : m.status,
        lastSyncAt: nowIso,
        lastError,
      }));
    } catch (err) {
      this.deps.log.warn('Mailbox status update failed', { mailboxId: mailbox.id, error: String(err) });
    }
    return processed;
  }

  private async syncFolder(mailbox: Mailbox, folder: MailFolder, budget: Budget, cache: IngestCache): Promise<number> {
    const { mailStore } = this.deps;
    const now = this.deps.now();
    const loaded = await mailStore.getState(mailbox.id, folder);
    let etag: string | null = loaded?.etag ?? null;
    let state: MailboxFolderState;
    if (loaded) {
      state = loaded.state;
    } else {
      // First sync: never earlier than the mailbox's enable time (its last admin change) or the window.
      const windowStart = now.getTime() - this.initialWindowMs;
      const enabledAt = Date.parse(mailbox.updatedAt);
      state = {
        id: `state_${folder}`,
        mailboxId: mailbox.id,
        folder,
        link: null,
        linkKind: null,
        processAfter: new Date(Math.max(windowStart, Number.isNaN(enabledAt) ? windowStart : enabledAt)).toISOString(),
        initializedAt: now.toISOString(),
        lastSyncAt: null,
        resets: 0,
      };
    }
    const save = async () => {
      etag = await mailStore.putState(state, etag);
    };
    const freshStart = (): DeltaStart => {
      // After a reset, look back from the last successful sync (receipts make replays harmless).
      const since = Math.max(Date.parse(state.processAfter), state.lastSyncAt ? Date.parse(state.lastSyncAt) - this.initialWindowMs : now.getTime() - this.initialWindowMs);
      return { address: mailbox.address, folder, receivedSince: new Date(since).toISOString() };
    };

    let start: DeltaStart = state.link ? { link: state.link } : freshStart();
    let processed = 0;
    let resetDone = false;
    for (;;) {
      if (budget.remaining <= 0) break;
      let page;
      try {
        page = await this.graph.deltaPage(start);
      } catch (err) {
        if (err instanceof GraphDeltaResetError && !resetDone) {
          resetDone = true;
          state = { ...state, link: null, linkKind: null, resets: state.resets + 1 };
          this.deps.log.warn('Mail delta state reset', { mailboxId: mailbox.id, folder });
          start = freshStart();
          continue;
        }
        throw err;
      }
      for (const message of page.messages) {
        const result = await ingestMessage(this.deps, mailbox, folder, message, { processAfter: state.processAfter, cache });
        if (result.outcome !== 'ignored' && result.outcome !== 'duplicate' && result.outcome !== 'before_enable') {
          processed += 1;
          budget.remaining -= 1;
        }
      }
      if (page.nextLink) {
        state = { ...state, link: page.nextLink, linkKind: 'next' };
        await save();
        start = { link: page.nextLink };
        continue;
      }
      if (page.deltaLink) state = { ...state, link: page.deltaLink, linkKind: 'delta' };
      break;
    }
    state = { ...state, lastSyncAt: this.deps.now().toISOString() };
    await save();
    return processed;
  }
}
