import { describe, expect, it } from 'vitest';
import { B1, createTestApp } from './helpers.js';

const CASEY_SCOPE = 'personal:usr_casey';

async function caseyPersonalTask(app: Awaited<ReturnType<typeof createTestApp>>) {
  const tasks = await app.repo.listOpenTasks(CASEY_SCOPE);
  expect(tasks).toHaveLength(1);
  return tasks[0]!;
}

describe('personal task privacy', () => {
  it('shows a personal task and its messages to the owner only', async () => {
    const app = await createTestApp();
    const task = await caseyPersonalTask(app);

    const own = await app.call('GET', `/tasks/${encodeURIComponent(CASEY_SCOPE)}/${task.id}/messages`, { as: 'usr_casey' });
    expect(own.status).toBe(200);
    expect(own.body).toHaveLength(1);

    for (const other of ['usr_riley', 'usr_morgan', 'usr_avery']) {
      const res = await app.call('GET', `/tasks/${CASEY_SCOPE}/${task.id}/messages`, { as: other });
      expect(res.status, other).toBe(404);
      const patch = await app.call('PATCH', `/tasks/${CASEY_SCOPE}/${task.id}`, { as: other, body: { title: 'Peek' } });
      expect(patch.status, other).toBe(404);
      const complete = await app.call('POST', `/tasks/${CASEY_SCOPE}/${task.id}/complete`, { as: other });
      expect(complete.status, other).toBe(404);
    }
  });

  it('never mixes someone else’s personal tasks into task views', async () => {
    const app = await createTestApp();
    const task = await caseyPersonalTask(app);

    const admin = await app.call('GET', '/tasks?view=combined', { as: 'usr_avery' });
    expect(admin.status).toBe(200);
    expect(admin.body.tasks.some((t: { id: string }) => t.id === task.id)).toBe(false);

    const owner = await app.call('GET', `/tasks?view=combined&branches=${B1}`, { as: 'usr_casey' });
    const ids = owner.body.tasks.map((t: { id: string }) => t.id);
    expect(ids).toContain(task.id);
    expect(owner.body.tasks.every((t: { scopeId: string }) => t.scopeId === B1 || t.scopeId === CASEY_SCOPE)).toBe(true);

    const branchOnly = await app.call('GET', `/tasks?view=branch&branches=${B1}`, { as: 'usr_casey' });
    expect(branchOnly.body.tasks.some((t: { id: string }) => t.id === task.id)).toBe(false);
  });

  it('keeps personal tasks off the wall and out of the branch audit trail', async () => {
    const app = await createTestApp();
    const task = await caseyPersonalTask(app);
    await app.call('POST', `/tasks/${CASEY_SCOPE}/${task.id}/complete`, { as: 'usr_casey' });
    expect(await app.repo.listEvents(B1, 'task', task.id)).toHaveLength(0);
    const pushes = app.publisher.sent.filter((s) => s.message.scopeId === CASEY_SCOPE);
    expect(pushes.length).toBeGreaterThan(0);
    expect(pushes.every((s) => s.groups.every((g) => g === `scope:${CASEY_SCOPE}`))).toBe(true);
  });
});
