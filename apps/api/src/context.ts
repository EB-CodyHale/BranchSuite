/**
 * Process-wide application context, built lazily once per process so cold starts stay cheap
 * (no SDK client is constructed until the first request needs the context).
 */
import { dirname, join } from 'node:path';
import { loadConfig, type Config } from './config.js';
import { CosmosRepo } from './data/cosmos.js';
import { MemoryRepo, MemoryStore } from './data/memory.js';
import type { Repo } from './data/repo.js';
import { SlidingWindowLimiter } from './http/rateLimit.js';
import { consoleLogger, type Logger } from './log.js';
import { createMailService, type MailService } from './mail/service.js';
import { BlobMediaStore, MemoryMediaStore, UnconfiguredMediaStore, type MediaStore } from './media/store.js';
import { NoopPublisher, WebPubSubPublisher, type Publisher } from './realtime/publisher.js';
import { wallSecretProvider, type WallSecretProvider } from './security/wallSecret.js';

/** Anonymous pairing starts allowed per client IP per window. */
export const PAIR_START_LIMIT = { hits: 10, windowMs: 10 * 60 * 1000 };

export interface AppContext {
  config: Config;
  repo: Repo;
  publisher: Publisher;
  mail: MailService;
  /** Whiteboard image bytes (metadata is in the repo). */
  media: MediaStore;
  log: Logger;
  now(): Date;
  wallSecret: WallSecretProvider;
  pairStartLimiter: SlidingWindowLimiter;
}

export interface ContextOverrides {
  repo?: Repo;
  publisher?: Publisher;
  mail?: MailService;
  media?: MediaStore;
  log?: Logger;
  now?: () => Date;
}

export function createAppContext(config: Config, overrides: ContextOverrides = {}): AppContext {
  const log = overrides.log ?? consoleLogger();
  const now = overrides.now ?? (() => new Date());
  const repo = overrides.repo ?? createRepo(config, now);
  const publisher =
    overrides.publisher ??
    (config.webPubSubEndpoint ? new WebPubSubPublisher(config.webPubSubEndpoint, config.webPubSubHub, log) : new NoopPublisher());
  const mail = overrides.mail ?? createMailService({ config, repo, publisher, log, now });
  return {
    config,
    repo,
    publisher,
    mail,
    media: overrides.media ?? createMediaStore(config),
    log,
    now,
    wallSecret: wallSecretProvider(config.wallSecret),
    pairStartLimiter: new SlidingWindowLimiter(PAIR_START_LIMIT.hits, PAIR_START_LIMIT.windowMs),
  };
}

function createRepo(config: Config, now: () => Date): Repo {
  if (config.dataMode === 'cosmos') {
    // loadConfig guarantees the endpoint for cosmos mode.
    return new CosmosRepo(config.cosmosEndpoint as string, config.cosmosDatabase);
  }
  return new MemoryRepo(new MemoryStore({ file: config.devDataFile, now }));
}

/** Blob store when configured; memory for memory data mode (persisted next to DEV_DATA_FILE); otherwise unconfigured. */
export function createMediaStore(config: Config): MediaStore {
  if (config.mediaBlobEndpoint) return new BlobMediaStore(config.mediaBlobEndpoint, config.mediaContainer);
  if (config.dataMode === 'memory') return new MemoryMediaStore(config.devDataFile ? join(dirname(config.devDataFile), 'media') : null);
  return new UnconfiguredMediaStore();
}

let singleton: AppContext | null = null;

/** The process singleton (Functions host). Throws at first use when configuration is invalid. */
export function getAppContext(): AppContext {
  singleton ??= createAppContext(loadConfig(process.env));
  return singleton;
}
