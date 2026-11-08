import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/http/errors.js';
import { MAX_RETRIES } from '../src/data/transaction.js';
import { B1, createTestApp } from './helpers.js';

describe('optimistic concurrency', () => {
  it('retries after a stale ETag and keeps both writes', async () => {
    const app = await createTestApp();
    let attempts = 0;
    const result = await app.repo.updateOrder(B1, 'ord_o4', async (order) => {
      attempts += 1;
      if (attempts === 1) {
        // Another writer commits between our read and our replace.
        await app.repo.updateOrder(B1, 'ord_o4', (o) => ({ ...o, note: 'written by someone else' }));
      }
      return { ...order, isPriority: true };
    });
    expect(attempts).toBe(2);
    expect(result).toMatchObject({ isPriority: true, note: 'written by someone else' });
    expect(await app.repo.getOrder(B1, 'ord_o4')).toMatchObject({ isPriority: true, note: 'written by someone else' });
  });

  it('gives up with 409 conflict when the document keeps changing', async () => {
    const app = await createTestApp();
    let attempts = 0;
    const attempt = app.repo.updateOrder(B1, 'ord_o4', async (order) => {
      attempts += 1;
      await app.repo.updateOrder(B1, 'ord_o4', (o) => ({ ...o, note: `competing write ${attempts}` }));
      return { ...order, isPriority: true };
    });
    await expect(attempt).rejects.toMatchObject({ status: 409, code: 'conflict' });
    await expect(attempt).rejects.toBeInstanceOf(HttpError);
    expect(attempts).toBe(MAX_RETRIES + 1);
    expect((await app.repo.getOrder(B1, 'ord_o4'))!.isPriority).toBe(false);
  });

  it('commits candidate and order together or not at all', async () => {
    const app = await createTestApp();
    const [candidate] = (await app.repo.listCandidates(B1, 'active')).filter((c) => c.orderId === null && c.stage !== 'dropped');
    const before = await app.repo.getOrder(B1, 'ord_o4');
    const failing = app.repo.mutatePipeline(B1, candidate!.id, async (c, loadOrder) => {
      const order = (await loadOrder('ord_o4'))!;
      // A competing write to the order invalidates the batch on every attempt.
      await app.repo.updateOrder(B1, 'ord_o4', (o) => ({ ...o, note: `${o.note}.` }));
      return { candidate: { ...c, notes: 'should not persist' }, orders: [{ ...order, isPriority: true }], result: null };
    });
    await expect(failing).rejects.toMatchObject({ status: 409 });
    expect((await app.repo.getCandidate(B1, candidate!.id))!.notes).toBe('');
    expect((await app.repo.getOrder(B1, 'ord_o4'))!.isPriority).toBe(before!.isPriority);
  });

  it('strips storage fields from what the repository returns', async () => {
    const app = await createTestApp();
    const order = (await app.repo.getOrder(B1, 'ord_o1')) as Record<string, unknown>;
    for (const field of ['_etag', '_ts', 'type', 'scopeId', 'ttl', 'pk']) expect(order).not.toHaveProperty(field);
    const display = (await app.repo.getDisplay('dsp_riverside_lobby')) as Record<string, unknown>;
    expect(display).not.toHaveProperty('tokenHash');
    const task = (await app.repo.listOpenTasks(B1))[0] as Record<string, unknown>;
    expect(task.scopeId).toBe(B1);
  });
});
