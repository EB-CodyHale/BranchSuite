import { describe, expect, it } from 'vitest';
import { runMaintenance } from '../src/maintenance.js';
import { open, seal, secureRandom } from '../src/security/crypto.js';
import { B1, createTestApp, TEST_SECRET } from './helpers.js';

describe('crypto helpers', () => {
  const secret = Buffer.from(TEST_SECRET);

  it('seals and opens a value bound to its context', () => {
    const sealed = seal(secret, 'display-token', 'pairing:p1');
    expect(sealed).not.toContain('display-token');
    expect(open(secret, sealed, 'pairing:p1')).toBe('display-token');
    expect(() => open(secret, sealed, 'pairing:p2')).toThrow();
    expect(() => open(Buffer.from('another-secret-another-secret-xx'), sealed, 'pairing:p1')).toThrow();
    // A truncated GCM tag is refused (it would otherwise weaken authentication).
    const [iv, tag, ct] = sealed.split('.');
    const shortTag = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => open(secret, [iv, shortTag, ct].join('.'), 'pairing:p1')).toThrow();
  });

  it('produces uniform floats in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const v = secureRandom();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('maintenance', () => {
  it('resumes paused orders whose resume day has arrived, and only those', async () => {
    const app = await createTestApp();
    const result = await runMaintenance(app.ctx);
    expect(result.resumed).toBe(1);
    expect((await app.repo.getOrder('branch-1002', 'ord_o16'))!).toMatchObject({ status: 'active', pause: null, updatedBy: null });
    expect((await app.repo.getOrder(B1, 'ord_o6'))!.status).toBe('paused');
    expect(await app.repo.listEvents('branch-1002', 'order', 'ord_o16')).toHaveLength(1);
  });
});

describe('tasks and mail review', () => {
  it('creates an order from a branch task once, for managers only', async () => {
    const app = await createTestApp();
    const task = (await app.repo.listOpenTasks(B1)).find((t) => t.staffingRequest !== null)!;
    const body = { accountId: 'acc_northwind', unitId: 'unit_northwind_cold', role: 'Freezer Order Picker', openingCount: 3, shift: '2nd' };
    expect((await app.call('POST', `/tasks/${B1}/${task.id}/create-order`, { as: 'usr_casey', body })).status).toBe(403);

    const res = await app.call('POST', `/tasks/${B1}/${task.id}/create-order`, { as: 'usr_morgan', body });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ source: 'email', sourceTaskId: task.id, status: 'active', roleCategory: 'order_picker' });
    expect(res.body.order.openings).toHaveLength(3);
    expect(res.body.task.orderId).toBe(res.body.order.id);
    expect((await app.call('POST', `/tasks/${B1}/${task.id}/create-order`, { as: 'usr_morgan', body })).status).toBe(409);
  });

  it('runs the claim / complete / reopen cycle on branch tasks', async () => {
    const app = await createTestApp();
    const created = await app.call('POST', `/branches/${B1}/tasks`, { as: 'usr_casey', body: { title: 'Call back about timesheet' } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ scope: 'branch', categorySource: 'auto', boardDate: '2026-03-10', routing: { status: 'manual' } });
    const path = `/tasks/${B1}/${created.body.id}`;
    expect((await app.call('POST', `${path}/claim`, { as: 'usr_riley' })).body.assigneeId).toBe('usr_riley');
    const done = await app.call('POST', `${path}/complete`, { as: 'usr_riley' });
    expect(done.body).toMatchObject({ status: 'done', completedBy: 'usr_riley' });
    expect((await app.call('POST', `${path}/complete`, { as: 'usr_riley' })).status).toBe(409);
    expect((await app.call('POST', `${path}/reopen`, { as: 'usr_casey' })).body).toMatchObject({ status: 'open', completedAt: null });
    const manual = await app.call('PATCH', path, { as: 'usr_casey', body: { category: 'operations' } });
    expect(manual.body).toMatchObject({ category: 'operations', categorySource: 'manual' });
    const auto = await app.call('PATCH', path, { as: 'usr_casey', body: { category: null } });
    expect(auto.body.categorySource).toBe('auto');
  });

  it('promotes filtered mail to a task exactly once (managers only)', async () => {
    const app = await createTestApp();
    const list = await app.call('GET', `/branches/${B1}/mail/filtered`, { as: 'usr_morgan' });
    expect(list.status).toBe(200);
    expect((await app.call('GET', `/branches/${B1}/mail/filtered`, { as: 'usr_casey' })).status).toBe(403);
    const item = list.body[0];
    const promoted = await app.call('POST', `/mail/filtered/${B1}/${item.id}/promote`, { as: 'usr_morgan' });
    expect(promoted.status).toBe(201);
    expect(promoted.body).toMatchObject({ scopeId: B1, title: item.subject, email: { fromAddress: item.fromAddress } });
    expect((await app.call('POST', `/mail/filtered/${B1}/${item.id}/promote`, { as: 'usr_morgan' })).status).toBe(409);
  });

  it('connects and disconnects a personal mailbox', async () => {
    const app = await createTestApp();
    const connected = await app.call('POST', '/me/mail/connect', { as: 'usr_riley' });
    expect(connected.body).toMatchObject({ connected: true, status: 'pending', address: 'riley@branchsuite.example.com' });
    const disconnected = await app.call('POST', '/me/mail/disconnect', { as: 'usr_riley' });
    expect(disconnected.body).toMatchObject({ connected: false, status: 'disabled' });
    const off = await createTestApp({ FEATURE_PERSONAL_MAIL: 'false' });
    expect((await off.call('POST', '/me/mail/connect', { as: 'usr_riley' })).status).toBe(404);
  });
});
