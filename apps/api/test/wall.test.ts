import { describe, expect, it } from 'vitest';
import { DEV_DISPLAY_TOKEN } from '../src/dev/seed.js';
import { B1, createTestApp } from './helpers.js';

const display = { 'x-display-token': DEV_DISPLAY_TOKEN };

describe('wall feed', () => {
  it('contains no names, ids, notes or pay with default settings', async () => {
    const app = await createTestApp();
    const res = await app.call('GET', '/wall/feed', { headers: display });
    expect(res.status).toBe(200);
    expect(res.headers?.['cache-control']).toBe('no-store');
    expect(res.body.orders.length).toBeGreaterThan(0);

    const json = JSON.stringify(res.body);
    const accounts = await app.repo.listAccounts(B1);
    const orders = await app.repo.listOrders(B1, { open: true });
    const users = await app.repo.listUsers();
    const candidates = await app.repo.listCandidates(B1, 'active');
    const forbidden = [
      ...accounts.flatMap((a) => [a.name, a.id, ...(a.contacts ?? []).map((c) => c.email)]),
      ...orders.flatMap((o) => [o.id, ...o.openings.map((l) => l.id)]),
      ...users.flatMap((u) => [u.name, u.email, u.id]),
      ...candidates.flatMap((c) => [c.id, c.firstName, c.lastName]),
      'Client paused hiring',
    ];
    for (const value of forbidden) expect(json, value).not.toContain(value);
    expect(res.body.orders.every((o: { pay: unknown; clientName: unknown; location: unknown }) => o.pay === null && o.clientName === null && o.location === null)).toBe(true);
    expect(res.body.orders.flatMap((o: { openings: Array<{ mark: unknown }> }) => o.openings).every((l: { mark: unknown }) => l.mark === null)).toBe(true);
    expect(res.body.orders.every((o: { key: string }) => /^[A-Za-z0-9_-]{16}$/.test(o.key))).toBe(true);
  });

  it('matches the staff preview exactly', async () => {
    const app = await createTestApp();
    const feed = await app.call('GET', '/wall/feed', { headers: display });
    const preview = await app.call('GET', `/branches/${B1}/wall/preview`, { as: 'usr_casey' });
    expect(preview.body).toEqual(feed.body);
  });

  it('rejects unknown and revoked display tokens', async () => {
    const app = await createTestApp();
    expect((await app.call('GET', '/wall/feed', { headers: { 'x-display-token': 'not-a-token' } })).status).toBe(401);
    expect((await app.call('GET', '/wall/feed')).status).toBe(401);
    const revoke = await app.call('POST', `/branches/${B1}/displays/dsp_riverside_lobby/revoke`, { as: 'usr_morgan' });
    expect(revoke.status).toBe(200);
    expect(revoke.body.revokedAt).not.toBeNull();
    expect(app.publisher.sent.some((s) => s.groups.includes(`wall:${B1}`) && s.message.entities.includes('wall'))).toBe(true);
    expect((await app.call('GET', '/wall/feed', { headers: display })).status).toBe(401);
  });

  it('does not accept staff identity on wall routes', async () => {
    const app = await createTestApp();
    expect((await app.call('GET', '/wall/feed', { as: 'usr_avery' })).status).toBe(401);
  });

  it('throttles lastSeenAt writes to once per five minutes', async () => {
    const app = await createTestApp();
    await app.call('GET', '/wall/feed', { headers: display });
    const first = (await app.repo.getDisplay('dsp_riverside_lobby'))!.lastSeenAt;
    app.clock.now = new Date(app.clock.now.getTime() + 60_000);
    await app.call('GET', '/wall/feed', { headers: display });
    expect((await app.repo.getDisplay('dsp_riverside_lobby'))!.lastSeenAt).toBe(first);
    app.clock.now = new Date(app.clock.now.getTime() + 5 * 60_000);
    await app.call('GET', '/wall/feed', { headers: display });
    expect((await app.repo.getDisplay('dsp_riverside_lobby'))!.lastSeenAt).toBe(app.clock.now.toISOString());
  });
});

describe('display pairing', () => {
  it('pairs end to end and hands the token over exactly once', async () => {
    const app = await createTestApp();
    const start = await app.call('POST', '/wall/pair/start');
    expect(start.status).toBe(201);
    expect(start.body.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    const poll = (secret = start.body.secret) => app.call('GET', `/wall/pair/${start.body.pairingId}`, { headers: { 'x-pairing-secret': secret } });

    expect((await poll()).body.status).toBe('waiting');
    expect((await poll('wrong-secret')).status).toBe(401);

    // Members cannot claim; the code is accepted without the dash and in lowercase.
    const code = start.body.code.replace('-', '').toLowerCase();
    expect((await app.call('POST', `/branches/${B1}/displays/claim`, { as: 'usr_casey', body: { code, name: 'Break room' } })).status).toBe(403);
    const claim = await app.call('POST', `/branches/${B1}/displays/claim`, { as: 'usr_morgan', body: { code, name: 'Break room' } });
    expect(claim.status).toBe(201);
    expect(claim.body).toMatchObject({ branchId: B1, name: 'Break room', revokedAt: null });
    expect(claim.body.tokenHash).toBeUndefined();

    // The same code cannot be claimed twice.
    expect((await app.call('POST', `/branches/${B1}/displays/claim`, { as: 'usr_morgan', body: { code, name: 'Again' } })).status).toBe(404);

    const paired = await poll();
    expect(paired.body).toMatchObject({ status: 'paired', displayId: claim.body.id, branchName: 'Riverside, IL' });
    expect(paired.body.displayToken).toHaveLength(43);
    expect(claim.body.tokenPrefix).toBe(paired.body.displayToken.slice(0, 6));
    expect((await poll()).body.status).toBe('expired');

    const feed = await app.call('GET', '/wall/feed', { headers: { 'x-display-token': paired.body.displayToken } });
    expect(feed.status).toBe(200);
    expect(feed.body.branch.name).toBe('Riverside, IL');
  });

  it('expires unclaimed pairings', async () => {
    const app = await createTestApp();
    const start = await app.call('POST', '/wall/pair/start');
    app.clock.now = new Date(app.clock.now.getTime() + 601_000);
    const res = await app.call('GET', `/wall/pair/${start.body.pairingId}`, { headers: { 'x-pairing-secret': start.body.secret } });
    expect(res.body.status).toBe('expired');
    const claim = await app.call('POST', `/branches/${B1}/displays/claim`, { as: 'usr_morgan', body: { code: start.body.code, name: 'Late' } });
    expect(claim.status).toBe(404);
  });

  it('rate limits pairing starts per client IP', async () => {
    const app = await createTestApp();
    for (let i = 0; i < 10; i++) expect((await app.call('POST', '/wall/pair/start', { ip: '203.0.113.7' })).status).toBe(201);
    const limited = await app.call('POST', '/wall/pair/start', { ip: '203.0.113.7' });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect((await app.call('POST', '/wall/pair/start', { ip: '203.0.113.8' })).status).toBe(201);
  });
});
