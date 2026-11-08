/**
 * Minimal Microsoft Graph client for mail delta sync (ARCHITECTURE §7).
 *
 * - Authenticates with the Function App's managed identity (DefaultAzureCredential, scope
 *   https://graph.microsoft.com/.default). Mailbox access is limited by Exchange RBAC for Applications.
 * - Retries 429/503/504 honoring Retry-After, with a bounded number of attempts.
 * - Maps 403/404 to GraphAccessError (mailbox status 'no_access') and 410 / syncStateNotFound to
 *   GraphDeltaResetError (the stored delta link is no longer valid).
 * - Follows only links on graph.microsoft.com so a tampered link can never send our token elsewhere.
 *
 * The rest of the mail module depends on the GraphClient interface only, so tests inject a fake.
 */
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
export const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

export type MailFolder = 'inbox' | 'sentitems';

export interface GraphRecipient {
  emailAddress?: { name?: string | null; address?: string | null } | null;
}

/** The subset of a Graph message the pipeline reads ($select in DELTA_SELECT). */
export interface GraphMessage {
  id: string;
  internetMessageId?: string | null;
  conversationId?: string | null;
  subject?: string | null;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[] | null;
  ccRecipients?: GraphRecipient[] | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  webLink?: string | null;
  uniqueBody?: { contentType?: string; content?: string | null } | null;
  body?: { contentType?: string; content?: string | null } | null;
  internetMessageHeaders?: Array<{ name: string; value: string }> | null;
  isDraft?: boolean | null;
  /** Present on delta entries for deleted/moved messages. */
  '@removed'?: { reason?: string } | null;
}

export interface DeltaPage {
  messages: GraphMessage[];
  /** More pages in this round. */
  nextLink: string | null;
  /** Round complete: store this and use it next run. */
  deltaLink: string | null;
}

/** Where a delta request starts: a stored link, or a fresh round filtered to recent mail. */
export type DeltaStart = { link: string } | { address: string; folder: MailFolder; receivedSince: string };

export interface GraphClient {
  deltaPage(start: DeltaStart): Promise<DeltaPage>;
}

export const DELTA_SELECT = [
  'id',
  'internetMessageId',
  'conversationId',
  'subject',
  'from',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'sentDateTime',
  'webLink',
  'uniqueBody',
  'body',
  'internetMessageHeaders',
  'isDraft',
].join(',');

/** Base class for Graph failures. `status` is the HTTP status (0 for network errors). */
export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

/** 403/404: the identity cannot read this mailbox (not in the RBAC scope, or no such mailbox). */
export class GraphAccessError extends GraphError {
  constructor(status: number, code: string) {
    super(`Mailbox is not readable by BranchSuite (${status} ${code})`, status, code);
    this.name = 'GraphAccessError';
  }
}

/** The stored delta link expired or is invalid: start a new round. */
export class GraphDeltaResetError extends GraphError {
  constructor(status: number, code: string) {
    super(`Delta state is no longer valid (${status} ${code})`, status, code);
    this.name = 'GraphDeltaResetError';
  }
}

export interface HttpGraphClientOptions {
  credential?: TokenCredential;
  fetch?: typeof fetch;
  /** Total attempts per request for retryable statuses (default 4). */
  maxAttempts?: number;
  /** Upper bound for one Retry-After wait (ms, default 30 s). */
  maxRetryWaitMs?: number;
  /** Page size hint (Prefer: odata.maxpagesize). */
  pageSize?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([429, 502, 503, 504]);

/** Build the URL for the first request of a fresh delta round. Exported for tests. */
export function initialDeltaUrl(address: string, folder: MailFolder, receivedSince: string): string {
  const params = new URLSearchParams({
    $select: DELTA_SELECT,
    $filter: `receivedDateTime ge ${receivedSince}`,
  });
  return `${GRAPH_BASE}/users/${encodeURIComponent(address)}/mailFolders/${folder}/messages/delta?${params.toString()}`;
}

/** Only absolute https links on graph.microsoft.com are followed. */
export function isGraphLink(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && url.hostname === 'graph.microsoft.com';
  } catch {
    return false;
  }
}

export function parseRetryAfter(value: string | null, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return fallbackMs;
}

export class HttpGraphClient implements GraphClient {
  private readonly credential: TokenCredential;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly maxRetryWaitMs: number;
  private readonly pageSize: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HttpGraphClientOptions = {}) {
    this.credential = options.credential ?? new DefaultAzureCredential();
    this.fetchImpl = options.fetch ?? fetch;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? 30_000;
    this.pageSize = options.pageSize ?? 50;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async deltaPage(start: DeltaStart): Promise<DeltaPage> {
    const url = 'link' in start ? start.link : initialDeltaUrl(start.address, start.folder, start.receivedSince);
    if (!isGraphLink(url)) throw new GraphError('Refusing to follow a non-Graph link', 0, 'invalid_link');
    const body = (await this.get(url)) as {
      value?: GraphMessage[];
      '@odata.nextLink'?: string;
      '@odata.deltaLink'?: string;
    };
    return {
      messages: Array.isArray(body.value) ? body.value : [],
      nextLink: body['@odata.nextLink'] ?? null,
      deltaLink: body['@odata.deltaLink'] ?? null,
    };
  }

  private async token(): Promise<string> {
    const token = await this.credential.getToken(GRAPH_SCOPE);
    if (!token) throw new GraphError('Could not acquire a Graph token', 0, 'no_token');
    return token.token;
  }

  private async get(url: string): Promise<unknown> {
    let lastError: GraphError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${await this.token()}`,
            Accept: 'application/json',
            Prefer: `outlook.body-content-type="text", odata.maxpagesize=${this.pageSize}`,
          },
        });
      } catch (err) {
        lastError = new GraphError(`Graph request failed: ${err instanceof Error ? err.message : String(err)}`, 0, 'network');
        if (attempt < this.maxAttempts) await this.sleep(Math.min(1000 * 2 ** (attempt - 1), this.maxRetryWaitMs));
        continue;
      }
      if (res.ok) return res.json();
      const code = await errorCode(res);
      if (res.status === 403 || res.status === 404) throw new GraphAccessError(res.status, code);
      if (res.status === 410 || code === 'syncStateNotFound' || code === 'syncStateInvalid' || code === 'resyncRequired') {
        throw new GraphDeltaResetError(res.status, code);
      }
      lastError = new GraphError(`Graph returned ${res.status} ${code}`, res.status, code);
      if (!RETRYABLE.has(res.status) || attempt === this.maxAttempts) throw lastError;
      const wait = parseRetryAfter(res.headers.get('retry-after'), 1000 * 2 ** (attempt - 1));
      await this.sleep(Math.min(wait, this.maxRetryWaitMs));
    }
    throw lastError ?? new GraphError('Graph request failed', 0, 'unknown');
  }
}

async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: string } };
    return typeof body.error?.code === 'string' ? body.error.code.slice(0, 80) : 'unknown';
  } catch {
    return 'unknown';
  }
}
