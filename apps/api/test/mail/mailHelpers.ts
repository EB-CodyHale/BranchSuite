import type { Classifier } from '../../src/mail/classify.js';
import type { DeltaPage, DeltaStart, GraphClient, GraphMessage } from '../../src/mail/graph.js';
import type { IngestDeps } from '../../src/mail/ingest.js';
import { createIngestDeps, ingestTestMessage, type TestMessageInput } from '../../src/mail/service.js';
import { silentLogger } from '../../src/log.js';
import { createTestApp, type TestApp } from '../helpers.js';

export interface MailTestApp extends TestApp {
  deps: IngestDeps;
  ingest(input: Omit<TestMessageInput, 'mailboxId'> & { mailboxId?: string }): ReturnType<typeof ingestTestMessage>;
}

export async function createMailTestApp(options: { classifier?: Classifier } = {}): Promise<MailTestApp> {
  const app = await createTestApp();
  const deps = createIngestDeps({
    config: app.ctx.config,
    repo: app.repo,
    publisher: app.publisher,
    log: silentLogger,
    now: () => app.clock.now,
    ...(options.classifier ? { classifier: options.classifier } : {}),
  });
  return {
    ...app,
    deps,
    ingest: (input) => ingestTestMessage(deps, { mailboxId: 'mbx_riverside', ...input }),
  };
}

export const DANA = { address: 'dana.whitfield@northwind.example.com', name: 'Dana Whitfield' };
export const KIM = { address: 'kim.alvarez@litware.example.com', name: 'Kim Alvarez' };
export const MORGAN = { address: 'morgan@branchsuite.example.com', name: 'Morgan Reyes' };

/** Graph message with sensible defaults. */
export function graphMessage(id: string, fields: Partial<GraphMessage> & { from?: string; text?: string; at?: string } = {}): GraphMessage {
  const { from, text, at, ...rest } = fields;
  return {
    id,
    internetMessageId: `<${id}@mail.example.com>`,
    conversationId: `conv-${id}`,
    subject: `Subject ${id}`,
    from: { emailAddress: { address: from ?? DANA.address, name: 'Sender' } },
    toRecipients: [],
    ccRecipients: [],
    receivedDateTime: at ?? '2026-03-10T14:55:00Z',
    webLink: null,
    uniqueBody: { contentType: 'text', content: text ?? 'Can you call me about the schedule?' },
    body: { contentType: 'text', content: text ?? 'Can you call me about the schedule?' },
    internetMessageHeaders: [],
    isDraft: false,
    ...rest,
  };
}

/** Scripted Graph: pages per "address|folder"; links are looked up in `byLink`. */
export class FakeGraph implements GraphClient {
  readonly calls: DeltaStart[] = [];
  readonly initial = new Map<string, DeltaPage[]>();
  readonly byLink = new Map<string, DeltaPage>();
  failWith: Map<string, Error> = new Map();

  setInitial(address: string, folder: string, pages: DeltaPage[]): void {
    this.initial.set(`${address}|${folder}`, pages);
  }

  async deltaPage(start: DeltaStart): Promise<DeltaPage> {
    this.calls.push(start);
    if ('link' in start) {
      const failure = this.failWith.get(start.link);
      if (failure) {
        this.failWith.delete(start.link);
        throw failure;
      }
      return this.byLink.get(start.link) ?? { messages: [], nextLink: null, deltaLink: start.link };
    }
    const key = `${start.address}|${start.folder}`;
    const failure = this.failWith.get(key);
    if (failure) throw failure;
    const pages = this.initial.get(key) ?? [];
    const first = pages[0] ?? { messages: [], nextLink: null, deltaLink: `https://graph.microsoft.com/delta/${encodeURIComponent(key)}/0` };
    return first;
  }
}
