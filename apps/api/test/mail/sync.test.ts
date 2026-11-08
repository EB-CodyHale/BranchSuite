import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../src/log.js';
import { GraphAccessError, GraphDeltaResetError } from '../../src/mail/graph.js';
import { acquireLease, MailStore } from '../../src/mail/mailStore.js';
import { createMailService } from '../../src/mail/service.js';
import { MailSync } from '../../src/mail/sync.js';
import { B1, createTestApp, NOW } from '../helpers.js';
import { createMailTestApp, FakeGraph, graphMessage } from './mailHelpers.js';

const RIVERSIDE = 'riverside.orders@branchsuite.example.com';
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

async function setup() {
  const app = await createMailTestApp();
  const graph = new FakeGraph();
  const sync = new MailSync(app.deps, graph);
  return { app, graph, sync, mailStore: new MailStore(app.repo.store) };
}

describe('mail sync', () => {
  it('first sync never backfills: filtered window, only mail after enable time, delta link saved and reused', async () => {
    const { app, graph, sync, mailStore } = await setup();
    // Re-enabled 10 minutes ago.
    await app.repo.updateMailbox('mbx_riverside', (m) => ({ ...m, updatedAt: minutesAgo(10) }));
    graph.setInitial(RIVERSIDE, 'inbox', [
      {
        messages: [
          graphMessage('old', { at: minutesAgo(30), text: 'Old request, please call.' }),
          graphMessage('new', { at: minutesAgo(5), text: 'New request, please call.' }),
          graphMessage('gone', { '@removed': { reason: 'deleted' } }),
          graphMessage('draft', { isDraft: true, at: minutesAgo(1) }),
        ],
        nextLink: null,
        deltaLink: 'https://graph.microsoft.com/delta/riverside-inbox-1',
      },
    ]);

    const result = await sync.syncAll();
    expect(result).toMatchObject({ processed: 1 });
    const first = graph.calls.find((c) => 'address' in c && c.address === RIVERSIDE && c.folder === 'inbox');
    expect(first).toEqual({ address: RIVERSIDE, folder: 'inbox', receivedSince: minutesAgo(10) });
    // Sent Items is synced for branch mailboxes, not for personal ones.
    expect(graph.calls.some((c) => 'address' in c && c.address === RIVERSIDE && c.folder === 'sentitems')).toBe(true);
    expect(graph.calls.some((c) => 'address' in c && c.address === 'casey@branchsuite.example.com' && c.folder === 'sentitems')).toBe(false);

    const state = (await mailStore.getState('mbx_riverside', 'inbox'))!.state;
    expect(state).toMatchObject({ link: 'https://graph.microsoft.com/delta/riverside-inbox-1', linkKind: 'delta', processAfter: minutesAgo(10), lastSyncAt: NOW.toISOString() });
    expect(await mailStore.getReceipt('mbx_riverside', 'old')).toBeNull();
    expect(await mailStore.getReceipt('mbx_riverside', 'new')).not.toBeNull();

    const mailbox = (await app.repo.getMailbox('mbx_riverside'))!;
    expect(mailbox).toMatchObject({ status: 'ok', lastError: null, lastSyncAt: NOW.toISOString(), updatedAt: minutesAgo(10) });

    graph.calls.length = 0;
    await sync.syncAll();
    expect(graph.calls).toContainEqual({ link: 'https://graph.microsoft.com/delta/riverside-inbox-1' });
  });

  it('uses the one-hour window for a mailbox enabled long ago', async () => {
    const { graph, sync } = await setup();
    await sync.syncAll();
    expect(graph.calls.find((c) => 'address' in c && c.address === RIVERSIDE)).toMatchObject({ receivedSince: minutesAgo(60) });
  });

  it('skips the run while another holder has the lease, and runs after it expires', async () => {
    const { app, graph, sync } = await setup();
    const other = await acquireLease(app.repo.store, 'other-host', () => app.clock.now, 5 * 60_000);
    expect(other).not.toBeNull();
    expect(await sync.syncAll()).toEqual({ mailboxes: 0, processed: 0, skipped: true });
    await sync.syncOne('mbx_riverside');
    expect(graph.calls).toHaveLength(0);

    app.clock.now = new Date(NOW.getTime() + 6 * 60_000);
    const result = await sync.syncAll();
    expect(result.skipped).toBeUndefined();
    expect(graph.calls.length).toBeGreaterThan(0);
  });

  it('lets only one of two concurrent runs proceed, and releases the lease afterwards', async () => {
    const { app, graph } = await setup();
    const a = new MailSync(app.deps, graph);
    const b = new MailSync(app.deps, graph);
    const results = await Promise.all([a.syncAll(), b.syncAll()]);
    expect(results.filter((r) => r.skipped)).toHaveLength(1);
    // Released: a later run proceeds.
    expect((await b.syncAll()).skipped).toBeUndefined();
  });

  it('marks a mailbox no_access on Graph 403 and keeps syncing the others', async () => {
    const { app, graph, sync } = await setup();
    graph.failWith.set(`${RIVERSIDE}|inbox`, new GraphAccessError(403, 'ErrorAccessDenied'));
    const result = await sync.syncAll();
    expect(result.mailboxes).toBe(3);
    const riverside = (await app.repo.getMailbox('mbx_riverside'))!;
    expect(riverside.status).toBe('no_access');
    expect(riverside.lastError).toMatch(/mailbox group/);
    expect((await app.repo.getMailbox('mbx_lakeview'))!.status).toBe('ok');
  });

  it('starts a new round when the stored delta link has expired', async () => {
    const { graph, sync, mailStore } = await setup();
    await sync.syncAll();
    const link = (await mailStore.getState('mbx_riverside', 'inbox'))!.state.link!;
    graph.failWith.set(link, new GraphDeltaResetError(410, 'SyncStateNotFound'));
    await sync.syncAll();
    const state = (await mailStore.getState('mbx_riverside', 'inbox'))!.state;
    expect(state.resets).toBe(1);
    expect(state.linkKind).toBe('delta');
  });

  it('stops at the per-run message cap and continues from the saved nextLink', async () => {
    const { app, graph, mailStore } = await setup();
    const sync = new MailSync(app.deps, graph, { maxMessagesPerRun: 1, concurrency: 1 });
    graph.setInitial(RIVERSIDE, 'inbox', [
      { messages: [graphMessage('p1', { at: minutesAgo(5), text: 'First, please call.' })], nextLink: 'https://graph.microsoft.com/next/2', deltaLink: null },
    ]);
    graph.byLink.set('https://graph.microsoft.com/next/2', { messages: [graphMessage('p2', { at: minutesAgo(4), text: 'Second, please call.' })], nextLink: null, deltaLink: 'https://graph.microsoft.com/delta/done' });

    expect((await sync.syncAll()).processed).toBe(1);
    expect((await mailStore.getState('mbx_riverside', 'inbox'))!.state).toMatchObject({ link: 'https://graph.microsoft.com/next/2', linkKind: 'next' });
    expect(await mailStore.getReceipt('mbx_riverside', 'p2')).toBeNull();

    expect((await sync.syncAll()).processed).toBe(1);
    expect(await mailStore.getReceipt('mbx_riverside', 'p2')).not.toBeNull();
    expect((await mailStore.getState('mbx_riverside', 'inbox'))!.state.link).toBe('https://graph.microsoft.com/delta/done');
    expect((await app.repo.listOpenTasks(B1)).filter((t) => t.email?.mailboxId === 'mbx_riverside' && t.title.startsWith('Subject p')).length).toBe(2);
  });

  it('skips disabled mailboxes and personal mailboxes when personal mail is off', async () => {
    const { app, graph } = await setup();
    await app.repo.updateMailbox('mbx_lakeview', (m) => ({ ...m, enabled: false, status: 'disabled' }));
    const deps = { ...app.deps, config: { ...app.deps.config, features: { ...app.deps.config.features, personalMail: false } } };
    const result = await new MailSync(deps, graph).syncAll();
    expect(result.mailboxes).toBe(1);
    expect(graph.calls.every((c) => !('address' in c) || c.address === RIVERSIDE)).toBe(true);
  });
});

describe('mail service', () => {
  it('returns zeros without Graph in memory mode', async () => {
    const app = await createTestApp();
    const service = createMailService({ config: app.ctx.config, repo: app.repo, publisher: app.publisher, log: silentLogger, now: () => app.clock.now });
    expect(await service.syncAll()).toEqual({ mailboxes: 0, processed: 0 });
    await expect(service.requestSync('mbx_riverside')).resolves.toBeUndefined();
  });

  it('syncs end to end with an injected Graph', async () => {
    const app = await createTestApp();
    const graph = new FakeGraph();
    graph.setInitial(RIVERSIDE, 'inbox', [{ messages: [graphMessage('svc1', { at: minutesAgo(2) })], nextLink: null, deltaLink: 'https://graph.microsoft.com/d' }]);
    const service = createMailService({ config: app.ctx.config, repo: app.repo, publisher: app.publisher, log: silentLogger, now: () => app.clock.now, graph });
    expect(await service.syncAll()).toEqual({ mailboxes: 3, processed: 1 });
  });
});
