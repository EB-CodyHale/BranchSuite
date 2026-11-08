/**
 * Realtime "invalidate" push (ARCHITECTURE §6). Messages carry no business data; clients refetch.
 * Groups are fixed at token issue time and clients get no join/leave or send roles.
 */
import { DefaultAzureCredential } from '@azure/identity';
import { WebPubSubServiceClient } from '@azure/web-pubsub';
import type { RealtimeMessage } from '@branchsuite/shared';
import type { Logger } from '../log.js';

export interface Publisher {
  readonly enabled: boolean;
  /** Never rejects: delivery failures are logged, because a push must never fail a request. */
  publish(groups: string[], message: RealtimeMessage): Promise<void>;
  negotiate(userId: string, groups: string[]): Promise<{ url: string | null }>;
}

export const TOKEN_LIFETIME_MINUTES = 60;

export class WebPubSubPublisher implements Publisher {
  readonly enabled = true;
  private readonly client: WebPubSubServiceClient;

  constructor(endpoint: string, hub: string, private readonly log: Logger) {
    this.client = new WebPubSubServiceClient(endpoint, new DefaultAzureCredential(), hub);
  }

  async publish(groups: string[], message: RealtimeMessage): Promise<void> {
    const results = await Promise.allSettled([...new Set(groups)].map((g) => this.client.group(g).sendToAll(message)));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      this.log.warn('Realtime publish failed', { groups, failed: failed.length, reason: String((failed[0] as PromiseRejectedResult).reason) });
    }
  }

  async negotiate(userId: string, groups: string[]): Promise<{ url: string | null }> {
    // Deliberately no `roles`: the connection cannot join, leave or send to any group itself.
    const token = await this.client.getClientAccessToken({ userId, groups, expirationTimeInMinutes: TOKEN_LIFETIME_MINUTES });
    return { url: token.url };
  }
}

/** Realtime disabled: clients fall back to polling. */
export class NoopPublisher implements Publisher {
  readonly enabled = false;
  async publish(): Promise<void> {}
  async negotiate(): Promise<{ url: string | null }> {
    return { url: null };
  }
}

export const groups = {
  scope: (scopeId: string) => `scope:${scopeId}`,
  wall: (branchId: string) => `wall:${branchId}`,
};
