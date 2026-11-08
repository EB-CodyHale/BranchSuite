import type { RealtimeMessage } from '@branchsuite/shared';
import { loadConfig, type Config } from '../src/config.js';
import { createAppContext, type AppContext } from '../src/context.js';
import { MemoryRepo, MemoryStore } from '../src/data/memory.js';
import type { ApiResponse } from '../src/http/types.js';
import { consoleLogger, silentLogger } from '../src/log.js';
import { MemoryMediaStore } from '../src/media/store.js';
import type { Publisher } from '../src/realtime/publisher.js';
import { createRouter } from '../src/routes/index.js';
import { seedDevData, seedEmail } from '../src/dev/seed.js';

export const NOW = new Date('2026-03-10T15:00:00.000Z');
export const B1 = 'branch-1001';
export const B2 = 'branch-1002';
export const TEST_SECRET = 'test-only-wall-secret-0123456789abcdefghij';

export class RecordingPublisher implements Publisher {
  readonly enabled = false;
  readonly sent: Array<{ groups: string[]; message: RealtimeMessage }> = [];
  async publish(groups: string[], message: RealtimeMessage): Promise<void> {
    this.sent.push({ groups, message });
  }
  async negotiate(): Promise<{ url: string | null }> {
    return { url: null };
  }
}

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ AUTH_MODE: 'dev', DATA_MODE: 'memory', AI_MODE: 'mock', WALL_HMAC_SECRET: TEST_SECRET, ...env });
}

export interface CallOptions {
  /** Seed user id to authenticate as (dev auth). */
  as?: string;
  body?: unknown;
  /** Raw binary body (what the adapters hand over for image/* uploads). */
  rawBody?: Buffer;
  headers?: Record<string, string>;
  ip?: string;
}

export interface TestApp {
  ctx: AppContext;
  repo: MemoryRepo;
  publisher: RecordingPublisher;
  media: MemoryMediaStore;
  clock: { now: Date };
  call(method: string, path: string, options?: CallOptions): Promise<ApiResponse & { body: any }>;
}

export async function createTestApp(env: Record<string, string> = {}, options: { seed?: boolean } = {}): Promise<TestApp> {
  const clock = { now: NOW };
  const now = () => clock.now;
  const repo = new MemoryRepo(new MemoryStore({ now }));
  const media = new MemoryMediaStore();
  if (options.seed !== false) await seedDevData(repo, NOW, media);
  const publisher = new RecordingPublisher();
  const ctx = createAppContext(testConfig(env), { repo, publisher, media, log: process.env.TEST_LOG ? consoleLogger() : silentLogger, now /* TEST_LOG=1 prints server-side errors */ });
  const router = createRouter();
  return {
    ctx,
    repo,
    publisher,
    media,
    clock,
    async call(method, path, opts = {}) {
      const [pathname, qs = ''] = path.split('?');
      const headers: Record<string, string> = { ...(opts.as ? { 'x-dev-user': seedEmail(opts.as) } : {}), ...opts.headers };
      const res = await router.handle(
        { method, path: pathname as string, params: {}, query: new URLSearchParams(qs), headers, body: opts.body, ...(opts.rawBody ? { rawBody: opts.rawBody } : {}), ip: opts.ip ?? '10.0.0.1' },
        ctx,
      );
      return res as ApiResponse & { body: any };
    },
  };
}
