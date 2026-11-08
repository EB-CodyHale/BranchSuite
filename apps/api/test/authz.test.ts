import { describe, expect, it } from 'vitest';
import { B1, B2, createTestApp } from './helpers.js';

const newOrder = { accountId: 'acc_fabrikam', role: 'Material Handler', openingCount: 2 };

describe('authorization matrix', () => {
  it('rejects a missing identity with 401 and an unknown user with 403 not_provisioned', async () => {
    const app = await createTestApp();
    expect((await app.call('GET', '/me')).status).toBe(401);
    const unknown = await app.call('GET', '/me', { headers: { 'x-dev-user': 'nobody@branchsuite.example.com' } });
    expect(unknown.status).toBe(403);
    expect(unknown.body.error.code).toBe('not_provisioned');
  });

  it('refuses inactive users', async () => {
    const app = await createTestApp();
    await app.repo.updateUser('usr_casey', (u) => ({ ...u, active: false }));
    const res = await app.call('GET', '/me', { as: 'usr_casey' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_provisioned');
  });

  it('lets a member write a line but not create, edit or close orders', async () => {
    const app = await createTestApp();
    expect((await app.call('POST', `/branches/${B1}/orders`, { as: 'usr_casey', body: newOrder })).status).toBe(403);
    expect((await app.call('PATCH', `/branches/${B1}/orders/ord_o4`, { as: 'usr_casey', body: { role: 'X' } })).status).toBe(403);
    expect((await app.call('POST', `/branches/${B1}/orders/ord_o4/close`, { as: 'usr_casey', body: { reason: 'filled' } })).status).toBe(403);

    const order = await app.repo.getOrder(B1, 'ord_o4');
    const line = order!.openings.find((o) => o.state === 'open')!;
    const res = await app.call('PUT', `/branches/${B1}/orders/ord_o4/openings/${line.id}`, {
      as: 'usr_casey',
      body: { state: 'committed', initials: 'zq', startDate: '2026-03-12' },
    });
    expect(res.status).toBe(200);
    const written = res.body.openings.find((o: { id: string }) => o.id === line.id);
    expect(written).toMatchObject({ state: 'committed', initials: 'ZQ', writtenBy: 'usr_casey', startDate: '2026-03-12' });
    expect(app.publisher.sent.some((s) => s.groups.includes(`wall:${B1}`))).toBe(true);
  });

  it('lets a manager create orders only in a managed branch, with server defaults', async () => {
    const app = await createTestApp();
    const other = await app.call('POST', `/branches/${B2}/orders`, { as: 'usr_morgan', body: { ...newOrder, accountId: 'acc_litware' } });
    expect(other.status).toBe(403);

    const res = await app.call('POST', `/branches/${B1}/orders`, { as: 'usr_morgan', body: { ...newOrder, status: 'closed', createdBy: 'usr_x' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ roleCategory: 'other', status: 'active', source: 'manual', createdBy: 'usr_morgan', branchId: B1 });
    expect(res.body.openings).toHaveLength(2);
    expect(res.body.openings.every((o: { state: string }) => o.state === 'open')).toBe(true);

    const history = await app.call('GET', `/branches/${B1}/orders/${res.body.id}/history`, { as: 'usr_casey' });
    expect(history.body.map((e: { action: string }) => e.action)).toEqual(['create']);
  });

  it('rejects orders against reserved or foreign accounts', async () => {
    const app = await createTestApp();
    const reserved = await app.call('POST', `/branches/${B1}/orders`, { as: 'usr_morgan', body: { ...newOrder, accountId: `acc_internal_${B1}` } });
    expect(reserved.status).toBe(400);
    const foreign = await app.call('POST', `/branches/${B1}/orders`, { as: 'usr_morgan', body: { ...newOrder, accountId: 'acc_litware' } });
    expect(foreign.status).toBe(400);
  });

  it('never sends account contacts to members, and the board never sends them to anyone', async () => {
    const app = await createTestApp();
    const asMember = await app.call('GET', `/branches/${B1}/accounts`, { as: 'usr_casey' });
    expect(asMember.status).toBe(200);
    expect(asMember.body.every((a: object) => !('contacts' in a))).toBe(true);

    const asManager = await app.call('GET', `/branches/${B1}/accounts`, { as: 'usr_morgan' });
    expect(asManager.body.find((a: { id: string }) => a.id === 'acc_northwind').contacts).toHaveLength(2);

    const board = await app.call('GET', `/board?branches=${B1}`, { as: 'usr_morgan' });
    expect(board.status).toBe(200);
    expect(board.body.accounts.every((a: object) => !('contacts' in a))).toBe(true);
    expect(board.body.orders.every((o: { status: string }) => o.status !== 'closed')).toBe(true);
    expect(board.body.today[B1]).toBe('2026-03-10');
  });

  it('rejects a board request for an unreadable branch', async () => {
    const app = await createTestApp();
    const res = await app.call('GET', `/board?branches=${B1},${B2}`, { as: 'usr_casey' });
    expect(res.status).toBe(403);
  });

  it('scopes the roster to shared branches and gives members PersonLite only', async () => {
    const app = await createTestApp();
    const member = await app.call('GET', '/users', { as: 'usr_casey' });
    const ids = member.body.map((u: { id: string }) => u.id).sort();
    expect(ids).toEqual(['usr_avery', 'usr_casey', 'usr_morgan', 'usr_riley']);
    expect(member.body.every((u: object) => !('email' in u) && !('preferences' in u))).toBe(true);

    const manager = await app.call('GET', '/users', { as: 'usr_morgan' });
    const casey = manager.body.find((u: { id: string }) => u.id === 'usr_casey');
    expect(casey.email).toBeDefined();
    // An admin record is never handed to a manager in full.
    expect(manager.body.find((u: { id: string }) => u.id === 'usr_avery').email).toBeUndefined();
  });

  it('stops managers from touching admins or granting admin', async () => {
    const app = await createTestApp();
    expect((await app.call('PATCH', '/users/usr_avery', { as: 'usr_morgan', body: { name: 'Changed' } })).status).toBe(403);
    const grant = await app.call('POST', '/users', {
      as: 'usr_morgan',
      body: { email: 'new.person@branchsuite.example.com', name: 'New Person', initials: 'NP', role: 'admin', branchIds: [B1], marker: 'teal' },
    });
    expect(grant.status).toBe(403);
    const otherBranch = await app.call('POST', '/users', {
      as: 'usr_morgan',
      body: { email: 'new.person@branchsuite.example.com', name: 'New Person', initials: 'NP', role: 'member', branchIds: [B2], marker: 'teal' },
    });
    expect(otherBranch.status).toBe(403);
    const ok = await app.call('POST', '/users', {
      as: 'usr_morgan',
      body: { email: 'new.person@branchsuite.example.com', name: 'New Person', initials: 'NP', role: 'member', branchIds: [B1], marker: 'teal' },
    });
    expect(ok.status).toBe(201);
  });

  it('limits a manager to wall and settings when editing a branch', async () => {
    const app = await createTestApp();
    expect((await app.call('PATCH', `/branches/${B1}`, { as: 'usr_morgan', body: { name: 'Renamed' } })).status).toBe(403);
    const res = await app.call('PATCH', `/branches/${B1}`, { as: 'usr_morgan', body: { wall: { payDisplay: 'band' } } });
    expect(res.status).toBe(200);
    // Partial update keeps the other wall settings.
    expect(res.body.wall).toMatchObject({ payDisplay: 'band', clientDisplay: 'code', headline: 'Now hiring — ask the front desk' });
  });

  it('answers 404 for pipeline routes when the feature is off', async () => {
    const app = await createTestApp({ FEATURE_PIPELINE: 'false' });
    expect((await app.call('GET', `/branches/${B1}/candidates`, { as: 'usr_casey' })).status).toBe(404);
    expect((await app.call('GET', '/me', { as: 'usr_casey' })).body.features.pipeline).toBe(false);
  });
});

describe('pipeline through the API', () => {
  it('links a candidate onto a line and moves the line with the stage, atomically', async () => {
    const app = await createTestApp();
    const created = await app.call('POST', `/branches/${B1}/candidates`, { as: 'usr_casey', body: { firstName: 'Quinn', lastName: 'Ivers' } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ initials: 'QI', stage: 'sourced', recruiterId: 'usr_casey' });

    const linked = await app.call('POST', `/branches/${B1}/candidates/${created.body.id}/link`, { as: 'usr_casey', body: { orderId: 'ord_o2' } });
    expect(linked.status).toBe(200);
    const line = linked.body.orders[0].openings.find((o: { candidateId: string | null }) => o.candidateId === created.body.id);
    expect(line).toMatchObject({ state: 'tentative', initials: 'QI' });

    const accepted = await app.call('POST', `/branches/${B1}/candidates/${created.body.id}/stage`, { as: 'usr_casey', body: { stage: 'accepted' } });
    expect(accepted.status).toBe(200);
    const stored = await app.repo.getOrder(B1, 'ord_o2');
    expect(stored!.openings.find((o) => o.candidateId === created.body.id)!.state).toBe('committed');

    const archived = await app.call('POST', `/branches/${B1}/candidates/${created.body.id}/archive`, { as: 'usr_casey' });
    expect(archived.body).toMatchObject({ status: 'archived', orderId: null });
    const released = await app.repo.getOrder(B1, 'ord_o2');
    expect(released!.openings.some((o) => o.candidateId === created.body.id)).toBe(false);
  });
});
