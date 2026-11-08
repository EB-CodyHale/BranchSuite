/**
 * Mail intake entry points used by the HTTP routes and the mailSync timer (ARCHITECTURE §7-§8).
 *
 * Wiring:
 * - Graph: HttpGraphClient (managed identity) when DATA_MODE=cosmos; none in memory mode unless a
 *   GraphClient is injected (tests, dev scripts). Without Graph, syncAll logs and returns zeros.
 * - Classifier: MockClassifier when AI_MODE=mock; Azure OpenAI (managed identity) otherwise.
 *   config.azureOpenAiApiVersion (AZURE_OPENAI_API_VERSION) overrides the default API version.
 * SDK clients are created on first use so cold starts stay cheap.
 */
import type { Config } from '../config.js';
import { DocumentRepo } from '../data/documentRepo.js';
import type { Repo } from '../data/repo.js';
import type { Logger } from '../log.js';
import type { Publisher } from '../realtime/publisher.js';
import { AzureOpenAiCaller, MockClassifier, ModelClassifier, type Classifier } from './classify.js';
import { HttpGraphClient, type GraphClient, type GraphMessage, type MailFolder } from './graph.js';
import { ingestMessage, type IngestDeps, type IngestResult } from './ingest.js';
import { MailStore } from './mailStore.js';
import { MailSync, type SyncOptions } from './sync.js';

export interface MailService {
  /** One timer run over every enabled mailbox. */
  syncAll(): Promise<{ mailboxes: number; processed: number }>;
  /** Ask for a sync of one mailbox as soon as possible (admin "Sync now"). */
  requestSync(mailboxId: string): Promise<void>;
}

/** Messages a manual "Sync now" processes inside the request before leaving the rest to the timer. */
export const MANUAL_SYNC_MAX_MESSAGES = 25;

export interface MailServiceDeps {
  config: Config;
  repo: Repo;
  publisher: Publisher;
  log: Logger;
  now: () => Date;
  /** Inject a Graph client (tests/dev). `null` disables Graph. Default: real client in cosmos mode. */
  graph?: GraphClient | null;
  /** Inject a classifier (tests). Default: from config.aiMode. */
  classifier?: Classifier;
  sync?: SyncOptions;
}

function defaultClassifier(deps: MailServiceDeps): Classifier {
  if (deps.config.aiMode === 'mock') return new MockClassifier();
  // loadConfig guarantees endpoint and deployment for AI_MODE=azure.
  const caller = new AzureOpenAiCaller({
    endpoint: deps.config.azureOpenAiEndpoint as string,
    deployment: deps.config.azureOpenAiDeployment as string,
    ...(deps.config.azureOpenAiApiVersion ? { apiVersion: deps.config.azureOpenAiApiVersion } : {}),
  });
  return new ModelClassifier(caller, deps.log);
}

/** Build the ingest dependencies. Throws when the repository does not expose a DocStore. */
export function createIngestDeps(deps: MailServiceDeps): IngestDeps {
  if (!(deps.repo instanceof DocumentRepo)) throw new Error('Mail intake requires a DocumentRepo-backed repository');
  const store = deps.repo.store;
  let classifier = deps.classifier ?? null;
  const lazyClassifier: Classifier = {
    triage: (input) => (classifier ??= defaultClassifier(deps)).triage(input),
    followup: (input) => (classifier ??= defaultClassifier(deps)).followup(input),
    reply: (input) => (classifier ??= defaultClassifier(deps)).reply(input),
  };
  return {
    config: deps.config,
    repo: deps.repo,
    store,
    mailStore: new MailStore(store),
    classifier: lazyClassifier,
    publisher: deps.publisher,
    log: deps.log,
    now: deps.now,
  };
}

export function createMailService(deps: MailServiceDeps): MailService {
  let sync: MailSync | null | undefined;
  const getSync = (): MailSync | null => {
    if (sync !== undefined) return sync;
    const graph = deps.graph !== undefined ? deps.graph : deps.config.dataMode === 'cosmos' ? new HttpGraphClient() : null;
    if (!graph || !(deps.repo instanceof DocumentRepo)) {
      sync = null;
      return sync;
    }
    sync = new MailSync(createIngestDeps(deps), graph, deps.sync);
    return sync;
  };

  return {
    async syncAll() {
      const s = getSync();
      if (!s) {
        deps.log.info('Mail sync skipped: Microsoft Graph is not configured in this environment');
        return { mailboxes: 0, processed: 0 };
      }
      const { mailboxes, processed } = await s.syncAll();
      return { mailboxes, processed };
    },
    async requestSync(mailboxId) {
      const s = getSync();
      if (!s) {
        deps.log.info('Mail sync skipped: Microsoft Graph is not configured in this environment', { mailboxId });
        return;
      }
      // Bounded: this runs inside the admin's HTTP request. The 2-minute timer continues any backlog.
      await s.syncOne(mailboxId, MANUAL_SYNC_MAX_MESSAGES);
    },
  };
}

export interface TestMessageInput {
  mailboxId: string;
  folder?: MailFolder;
  /** Graph message fields; id, dates and conversation default to fresh values. */
  message: Partial<GraphMessage> & { from: { address: string; name?: string }; subject: string; body: string };
  processAfter?: string;
}

/**
 * Push one synthetic message through the full pipeline (tests and `dev-ingest.ts`).
 * Never used by the production timer path.
 */
export async function ingestTestMessage(deps: MailServiceDeps | IngestDeps, input: TestMessageInput): Promise<IngestResult> {
  const ingest = 'mailStore' in deps ? deps : createIngestDeps(deps);
  const mailbox = await ingest.repo.getMailbox(input.mailboxId);
  if (!mailbox) throw new Error(`No mailbox ${input.mailboxId}`);
  const nowIso = ingest.now().toISOString();
  const { from, body, ...rest } = input.message;
  const id = rest.id ?? `test-${Math.random().toString(36).slice(2)}`;
  const message: GraphMessage = {
    internetMessageId: `<${id}@test.example.com>`,
    conversationId: `conv-${id}`,
    receivedDateTime: nowIso,
    toRecipients: [{ emailAddress: { address: mailbox.address } }],
    ccRecipients: [],
    webLink: null,
    internetMessageHeaders: [],
    isDraft: false,
    uniqueBody: { contentType: 'text', content: body },
    body: { contentType: 'text', content: body },
    ...rest,
    id,
    from: { emailAddress: { address: from.address, name: from.name ?? '' } },
  };
  return ingestMessage(ingest, mailbox, input.folder ?? 'inbox', message, input.processAfter ? { processAfter: input.processAfter } : {});
}
