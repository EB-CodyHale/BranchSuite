import type { Task } from '@branchsuite/shared';
import { describe, expect, it } from 'vitest';
import { DOC_KINDS, fromDoc } from '../../src/data/documentRepo.js';
import type { WriteOp } from '../../src/data/store.js';
import { emailOrderId } from '../../src/mail/ingest.js';
import { mailboxPartition, receiptId } from '../../src/mail/mailStore.js';
import { B1, B2 } from '../helpers.js';
import { createMailTestApp, DANA, KIM, MORGAN, type MailTestApp } from './mailHelpers.js';

const RIVERSIDE = 'riverside.orders@branchsuite.example.com';

async function allTasks(app: MailTestApp, scopeId: string): Promise<Task[]> {
  return (await app.repo.store.query('board', { partition: scopeId, type: 'task' })).map((d) => fromDoc<Task>(DOC_KINDS.task, d));
}
async function orderIds(app: MailTestApp, scopeId: string): Promise<string[]> {
  return (await app.repo.store.query('board', { partition: scopeId, type: 'order' })).map((d) => d.id);
}
async function hasReceipt(app: MailTestApp, mailboxId: string, graphId: string): Promise<boolean> {
  return (await app.repo.store.read('mail', mailboxPartition(mailboxId), receiptId(mailboxId, graphId))) !== null;
}

describe('mail ingest: new mail', () => {
  it('creates a routed, assigned task, stores the sanitized message, writes a receipt and notifies the branch', async () => {
    const app = await createMailTestApp();
    const res = await app.ingest({ message: { id: 'g1', from: DANA, subject: 'Schedule question', body: 'Can you call me about the schedule?\n\nOn Mon, Dana wrote:\n> old' } });
    expect(res).toMatchObject({ outcome: 'task_created', scopeId: B1, orderId: null });
    const task = (await app.repo.getTask(B1, res.taskId!))!;
    expect(task).toMatchObject({
      scope: 'branch',
      branchId: B1,
      boardDate: '2026-03-10',
      status: 'open',
      accountId: 'acc_northwind',
      assigneeId: 'usr_casey',
      routing: { status: 'matched' },
      categorySource: 'auto',
      createdBy: null,
      email: { mailboxId: 'mbx_riverside', conversationId: 'conv-g1', messageCount: 1, fromAddress: DANA.address },
    });
    const messages = await app.repo.listMessages(B1, task.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ direction: 'inbound', bodyText: 'Can you call me about the schedule?', internetMessageId: '<g1@test.example.com>' });
    expect(await hasReceipt(app, 'mbx_riverside', 'g1')).toBe(true);
    expect(app.publisher.sent.map((s) => s.groups)).toEqual([[`scope:${B1}`]]);
  });

  it('is idempotent: the same message twice gives one task', async () => {
    const app = await createMailTestApp();
    const before = (await allTasks(app, B1)).length;
    const message = { id: 'g-replay', from: DANA, subject: 'Badge request', body: 'Please order a badge for the new starter.' };
    expect((await app.ingest({ message })).outcome).toBe('task_created');
    expect((await app.ingest({ message })).outcome).toBe('duplicate');
    expect((await app.ingest({ message: { ...message, subject: 'Edited subject' } })).outcome).toBe('duplicate');
    expect((await allTasks(app, B1)).length).toBe(before + 1);
  });

  it('files auto-replies as filtered mail (inbox) and ignores them in Sent Items', async () => {
    const app = await createMailTestApp();
    const res = await app.ingest({ message: { id: 'g-ooo', from: DANA, subject: 'Automatic reply: Away', body: 'I am out until Monday.' } });
    expect(res).toMatchObject({ outcome: 'filtered', scopeId: B1 });
    const filtered = await app.repo.listFiltered(B1);
    expect(filtered.find((f) => f.subject === 'Automatic reply: Away')).toMatchObject({ stage: 'prefilter', excerpt: 'I am out until Monday.' });
    const sent = await app.ingest({ folder: 'sentitems', message: { id: 'g-ooo2', from: { address: RIVERSIDE }, subject: 'Automatic reply: closed', body: 'Closed today.' } });
    expect(sent.outcome).toBe('ignored');
  });

  it('files non-actionable mail as model-filtered', async () => {
    const app = await createMailTestApp();
    const res = await app.ingest({ message: { id: 'g-thanks', from: DANA, subject: 'Thanks', body: 'Thanks!' } });
    expect(res.outcome).toBe('filtered');
    expect((await app.repo.listFiltered(B1)).some((f) => f.stage === 'model' && f.subject === 'Thanks')).toBe(true);
  });

  it('skips messages received before the mailbox was enabled, without a receipt', async () => {
    const app = await createMailTestApp();
    const res = await app.ingest({ processAfter: '2026-03-10T16:00:00.000Z', message: { id: 'g-old', from: DANA, subject: 'Old', body: 'Old mail' } });
    expect(res.outcome).toBe('before_enable');
    expect(await hasReceipt(app, 'mbx_riverside', 'g-old')).toBe(false);
  });

  it('ignores drafts and removed delta entries', async () => {
    const app = await createMailTestApp();
    expect((await app.ingest({ message: { id: 'g-draft', from: DANA, subject: 'Draft', body: 'x', isDraft: true } })).outcome).toBe('ignored');
    expect((await app.ingest({ message: { id: 'g-rm', from: DANA, subject: 'x', body: 'x', '@removed': { reason: 'deleted' } } })).outcome).toBe('ignored');
  });
});

describe('mail ingest: threads', () => {
  it('escalates an open task on an inbound follow-up, even across days', async () => {
    const app = await createMailTestApp();
    const first = await app.ingest({ message: { id: 'g-a', conversationId: 'conv-x', from: DANA, subject: 'Gloves for dock', body: 'Can you bring gloves for the dock crew when you can?' } });
    const task = (await app.repo.getTask(B1, first.taskId!))!;
    expect(task.priority).toBe('normal');
    app.clock.now = new Date('2026-03-11T15:00:00.000Z');
    const follow = await app.ingest({ message: { id: 'g-b', conversationId: 'conv-x', from: DANA, subject: 'RE: Gloves for dock', body: 'Urgent: we need them today.', receivedDateTime: '2026-03-11T14:59:00Z' } });
    expect(follow).toMatchObject({ outcome: 'task_updated', taskId: task.id });
    const updated = (await app.repo.getTask(B1, task.id))!;
    expect(updated).toMatchObject({ priority: 'hot', boardDate: '2026-03-10', status: 'open', email: { messageCount: 2, lastMessageAt: '2026-03-11T14:59:00.000Z' } });
    expect(await app.repo.listMessages(B1, task.id)).toHaveLength(2);
  });

  it('never reopens a completed task; actionable mail starts a new task instead', async () => {
    const app = await createMailTestApp();
    const first = await app.ingest({ message: { id: 'g-c1', conversationId: 'conv-done', from: DANA, subject: 'Invoice copy', body: 'Can you resend the invoice?' } });
    await app.repo.updateTask(B1, first.taskId!, (t) => ({ ...t, status: 'done', completedAt: '2026-03-10T15:10:00.000Z', completedBy: 'usr_casey' }));

    const thanks = await app.ingest({ message: { id: 'g-c2', conversationId: 'conv-done', from: DANA, subject: 'RE: Invoice copy', body: 'Thanks!' } });
    expect(thanks.outcome).toBe('filtered');
    const again = await app.ingest({ message: { id: 'g-c3', conversationId: 'conv-done', from: DANA, subject: 'RE: Invoice copy', body: 'Can you also send the March statement?' } });
    expect(again.outcome).toBe('task_created');
    expect(again.taskId).not.toBe(first.taskId);
    expect((await app.repo.getTask(B1, first.taskId!))!.status).toBe('done');

    // The thread now points at the new open task.
    const follow = await app.ingest({ message: { id: 'g-c4', conversationId: 'conv-done', from: DANA, subject: 'RE', body: 'Any update?' } });
    expect(follow).toMatchObject({ outcome: 'task_updated', taskId: again.taskId });
  });

  it('closes an open task when a team reply from Sent Items resolves it', async () => {
    const app = await createMailTestApp();
    const first = await app.ingest({ message: { id: 'g-r1', conversationId: 'conv-r', from: DANA, subject: 'Start confirmation', body: 'Can you confirm the start time for Monday?' } });
    const ack = await app.ingest({ folder: 'sentitems', message: { id: 'g-r2', conversationId: 'conv-r', from: { address: RIVERSIDE }, subject: 'RE', body: "On it, we'll check and get back to you." } });
    expect(ack.outcome).toBe('reply_open');
    expect((await app.repo.getTask(B1, first.taskId!))!.status).toBe('open');

    const done = await app.ingest({ folder: 'sentitems', message: { id: 'g-r3', conversationId: 'conv-r', from: { address: RIVERSIDE }, subject: 'RE', body: 'Confirmed: start is 6:00 AM Monday.', receivedDateTime: '2026-03-10T14:58:00Z' } });
    expect(done.outcome).toBe('reply_closed');
    const task = (await app.repo.getTask(B1, first.taskId!))!;
    expect(task).toMatchObject({ status: 'reply_closed', completedAt: '2026-03-10T14:58:00.000Z', closedByReply: { fromAddress: RIVERSIDE, excerpt: 'Confirmed: start is 6:00 AM Monday.' }, email: { messageCount: 3 } });
    const messages = await app.repo.listMessages(B1, task.id);
    expect(messages.filter((m) => m.direction === 'outbound')).toHaveLength(2);
  });

  it('treats a teammate replying from the inbox as a team reply', async () => {
    const app = await createMailTestApp();
    const first = await app.ingest({ message: { id: 'g-t1', conversationId: 'conv-t', from: DANA, subject: 'Timesheet', body: 'Can you send last week timesheet?' } });
    const res = await app.ingest({ message: { id: 'g-t2', conversationId: 'conv-t', from: MORGAN, subject: 'RE: Timesheet', body: 'Sent it this morning, attached.' } });
    expect(res.outcome).toBe('reply_closed');
    expect((await app.repo.getTask(B1, first.taskId!))!.status).toBe('reply_closed');
  });

  it('does not create tasks from Sent Items without an open thread', async () => {
    const app = await createMailTestApp();
    const res = await app.ingest({ folder: 'sentitems', message: { id: 'g-s1', from: { address: RIVERSIDE }, subject: 'Hello', body: 'Can you call us?' } });
    expect(res.outcome).toBe('team_no_task');
  });
});

describe('mail ingest: draft orders', () => {
  const ORDER_MAIL = { from: DANA, subject: 'Pickers for Monday', body: 'We need 3 order pickers on 2nd shift at $21/hr.' };

  it('creates a linked draft order with a deterministic id when headcount is exact and routing matched', async () => {
    const app = await createMailTestApp();
    const res = await app.ingest({ message: { id: 'g-o1', ...ORDER_MAIL } });
    expect(res.orderId).toBe(emailOrderId(B1, '<g-o1@test.example.com>'));
    const order = (await app.repo.getOrder(B1, res.orderId!))!;
    expect(order).toMatchObject({
      status: 'draft', source: 'email', sourceTaskId: res.taskId, sourceMessageId: '<g-o1@test.example.com>', accountId: 'acc_northwind',
      roleCategory: 'order_picker', shift: '2nd', payRate: 21, isPriority: true, createdBy: null,
    });
    expect(order.openings).toHaveLength(3);
    const task = (await app.repo.getTask(B1, res.taskId!))!;
    expect(task).toMatchObject({ orderId: order.id, category: 'client', staffingRequest: { headcount: 3, blockedReason: null } });
    expect(app.publisher.sent.at(-1)!.groups).toEqual([`scope:${B1}`, `wall:${B1}`]);
    expect(app.publisher.sent.at(-1)!.message.entities).toEqual(['tasks', 'orders']);
    expect(await app.repo.listEvents(B1, 'order', order.id)).toHaveLength(1);
  });

  it('publishes the order as active when the branch auto-publishes email orders', async () => {
    const app = await createMailTestApp();
    await app.repo.updateBranch(B1, (b) => ({ ...b, settings: { ...b.settings, autoPublishEmailOrders: true } }));
    const res = await app.ingest({ message: { id: 'g-o2', ...ORDER_MAIL } });
    expect((await app.repo.getOrder(B1, res.orderId!))!.status).toBe('active');
  });

  it('writes task and order atomically: a failed batch leaves neither, and a replay creates both once', async () => {
    const app = await createMailTestApp();
    const tasksBefore = (await allTasks(app, B1)).length;
    const ordersBefore = (await orderIds(app, B1)).length;
    const store = app.repo.store;
    const original = store.commit.bind(store);
    let fail = true;
    store.commit = async (container: Parameters<typeof original>[0], partition: string, ops: WriteOp[]) => {
      if (fail && container === 'board' && ops.length === 2) {
        fail = false;
        throw new Error('simulated outage');
      }
      return original(container, partition, ops);
    };
    await expect(app.ingest({ message: { id: 'g-o3', ...ORDER_MAIL } })).rejects.toThrow('simulated outage');
    expect((await allTasks(app, B1)).length).toBe(tasksBefore);
    expect((await orderIds(app, B1)).length).toBe(ordersBefore);
    expect(await hasReceipt(app, 'mbx_riverside', 'g-o3')).toBe(false);

    const retry = await app.ingest({ message: { id: 'g-o3', ...ORDER_MAIL } });
    expect(retry.outcome).toBe('task_created');
    expect((await allTasks(app, B1)).length).toBe(tasksBefore + 1);
    expect((await orderIds(app, B1)).length).toBe(ordersBefore + 1);
  });

  it('keeps the request on the task without an order when the headcount is not exact', async () => {
    const app = await createMailTestApp();
    const res = await app.ingest({ message: { id: 'g-o4', from: DANA, subject: 'Pickers', body: 'We need 3-5 pickers next week.' } });
    expect(res.orderId).toBeNull();
    const task = (await app.repo.getTask(B1, res.taskId!))!;
    expect(task.orderId).toBeNull();
    expect(task.staffingRequest).toMatchObject({ headcount: null, headcountText: '3-5', blockedReason: 'The email does not state one exact headcount.' });
  });

  it('blocks the order when routing is ambiguous', async () => {
    const app = await createMailTestApp();
    const ordersBefore = (await orderIds(app, B1)).length;
    const res = await app.ingest({ message: { id: 'g-o5', from: { address: 'buyer@unknown.example.org' }, subject: 'Pickers for Northwind and Contoso', body: 'We need 3 order pickers for Northwind and Contoso.' } });
    expect(res).toMatchObject({ outcome: 'task_created', orderId: null });
    const task = (await app.repo.getTask(B1, res.taskId!))!;
    expect(task).toMatchObject({ routing: { status: 'ambiguous' }, accountId: null, assigneeId: null, staffingRequest: { headcount: 3, blockedReason: 'The client account needs review before an order is created.' } });
    expect((await orderIds(app, B1)).length).toBe(ordersBefore);
  });
});

describe('mail ingest: scopes', () => {
  it('keeps personal mail private: personal partition only, no routing, orders or branch writes', async () => {
    const app = await createMailTestApp();
    const b1Tasks = (await allTasks(app, B1)).length;
    const b1Orders = (await orderIds(app, B1)).length;
    const res = await app.ingest({ mailboxId: 'mbx_casey', message: { id: 'g-p1', from: DANA, subject: 'Pickers', body: 'We need 3 order pickers Monday.' } });
    expect(res).toMatchObject({ outcome: 'task_created', scopeId: 'personal:usr_casey', orderId: null });
    const task = (await app.repo.getTask('personal:usr_casey', res.taskId!))!;
    expect(task).toMatchObject({ scope: 'personal', branchId: null, ownerUserId: 'usr_casey', assigneeId: 'usr_casey', accountId: null, routing: { status: 'unmatched', candidates: [] } });
    expect(task.staffingRequest?.blockedReason).toBe('Personal mail does not create orders.');
    expect((await allTasks(app, B1)).length).toBe(b1Tasks);
    expect((await orderIds(app, B1)).length).toBe(b1Orders);
    expect(app.publisher.sent.every((s) => s.groups.every((g) => g === 'scope:personal:usr_casey'))).toBe(true);

    // The owner's own replies never close personal tasks.
    const self = await app.ingest({ mailboxId: 'mbx_casey', message: { id: 'g-p2', conversationId: 'conv-g-p1', from: { address: 'casey@branchsuite.example.com' }, subject: 'RE', body: 'Confirmed.' } });
    expect(self.outcome).toBe('ignored');
    expect((await app.repo.getTask('personal:usr_casey', res.taskId!))!.status).toBe('open');
  });

  it('routes a multi-branch mailbox to the matched account\'s branch, else the first branch as ambiguous', async () => {
    const app = await createMailTestApp();
    await app.repo.createMailbox({
      id: 'mbx_shared', address: 'shared.orders@branchsuite.example.com', kind: 'branch', branchIds: [B1, B2], userId: null, brand: '',
      enabled: true, status: 'ok', lastSyncAt: null, lastError: null, createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z', createdBy: null, updatedBy: null,
    });
    const kim = await app.ingest({ mailboxId: 'mbx_shared', message: { id: 'g-m1', from: KIM, subject: 'Sanitation', body: 'We need 2 sanitation workers tonight.' } });
    expect(kim.scopeId).toBe(B2);
    const kimTask = (await app.repo.getTask(B2, kim.taskId!))!;
    expect(kimTask).toMatchObject({ branchId: B2, accountId: 'acc_litware', assigneeId: 'usr_taylor', routing: { status: 'matched' }, priority: 'hot' });
    expect(kim.orderId).toBe(emailOrderId(B2, '<g-m1@test.example.com>'));

    const unknown = await app.ingest({ mailboxId: 'mbx_shared', message: { id: 'g-m2', from: { address: 'someone@unknown.example.org' }, subject: 'Question', body: 'Can you call me?' } });
    expect(unknown.scopeId).toBe(B1);
    expect((await app.repo.getTask(B1, unknown.taskId!))!.routing).toEqual({ status: 'ambiguous', candidates: [] });
  });
});
