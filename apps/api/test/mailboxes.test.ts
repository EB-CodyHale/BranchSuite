import { describe, expect, it } from 'vitest';
import { B1, createTestApp } from './helpers.js';

const later = (from: Date, minutes: number) => new Date(from.getTime() + minutes * 60_000);

describe('mailbox enabledAt (no-backfill point for mail sync)', () => {
  it('is set on create, moves only on a false -> true switch, and clears on disable', async () => {
    const app = await createTestApp();
    const t0 = app.clock.now.toISOString();

    const off = await app.call('POST', '/mailboxes', { as: 'usr_avery', body: { address: 'new.orders@branchsuite.example.com', branchIds: [B1], enabled: false } });
    expect(off.status).toBe(201);
    expect(off.body).toMatchObject({ enabled: false, enabledAt: null, status: 'disabled' });

    const on = await app.call('POST', '/mailboxes', { as: 'usr_avery', body: { address: 'other.orders@branchsuite.example.com', branchIds: [B1] } });
    expect(on.body).toMatchObject({ enabled: true, enabledAt: t0 });

    app.clock.now = later(app.clock.now, 10);
    const renamed = await app.call('PATCH', `/mailboxes/${on.body.id}`, { as: 'usr_avery', body: { brand: 'Renamed' } });
    expect(renamed.body.enabledAt).toBe(t0);
    expect(renamed.body.updatedAt).not.toBe(t0);

    const disabled = await app.call('PATCH', `/mailboxes/${on.body.id}`, { as: 'usr_avery', body: { enabled: false } });
    expect(disabled.body).toMatchObject({ enabled: false, enabledAt: null });

    app.clock.now = later(app.clock.now, 5);
    const reenabled = await app.call('PATCH', `/mailboxes/${on.body.id}`, { as: 'usr_avery', body: { enabled: true } });
    expect(reenabled.body).toMatchObject({ enabled: true, enabledAt: app.clock.now.toISOString(), status: 'pending' });
  });
});
