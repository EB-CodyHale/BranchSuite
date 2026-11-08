import { WHITEBOARD_LIMITS, type WhiteboardBlock } from '@branchsuite/shared';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { encodePng, seedChartPng } from '../src/dev/png.js';
import { DEV_DISPLAY_TOKEN, SEED_MEDIA_ID } from '../src/dev/seed.js';
import { readStreamLimited, toApiRequest } from '../src/http/request.js';
import { createRouter } from '../src/routes/index.js';
import { B1, B2, createTestApp, NOW, testConfig, type TestApp } from './helpers.js';

const display = { 'x-display-token': DEV_DISPLAY_TOKEN };
const TODAY = '2026-03-10'; // NOW = 2026-03-10T15:00Z = 10:00 CDT, after the seed window (07:30-08:15 = 12:30Z-13:15Z)
const TOMORROW = '2026-03-11';
const IN_WINDOW = new Date('2026-03-10T12:45:00.000Z');
const board = (date = TODAY) => `/branches/${B1}/whiteboards/${date}`;
const png = (w = 4, h = 3) => encodePng(w, h, () => [10, 20, 30]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);

function upload(app: TestApp, bytes: Buffer, contentType: string, as = 'usr_morgan', branch = B1) {
  return app.call('POST', `/branches/${branch}/media`, { as, rawBody: bytes, headers: { 'content-type': contentType, 'x-file-name': 'chart%20q1.png' } });
}

function blocksOf(app: TestApp, date = TODAY): Promise<WhiteboardBlock[]> {
  return app.repo.getWhiteboard(B1, date).then((wb) => wb!.blocks);
}

describe('whiteboard staff routes', () => {
  it('lets any branch reader read, with a resolved staff view', async () => {
    const app = await createTestApp();
    const res = await app.call('GET', board(), { as: 'usr_casey' });
    expect(res.status).toBe(200);
    expect(res.body.whiteboard).toMatchObject({ id: `wb_${B1}_${TODAY}`, live: 'auto', window: { start: '07:30', end: '08:15' } });
    expect(res.body.view.blocks.map((b: { kind: string }) => b.kind)).toEqual(['talking_points', 'assignments', 'priority_orders', 'note', 'image', 'metrics']);
    const image = res.body.view.blocks.find((b: { kind: string }) => b.kind === 'image');
    expect(image).toMatchObject({ mediaUrl: `/api/branches/${B1}/media/${SEED_MEDIA_ID}`, width: 480, height: 270 });
    expect(res.body.view.isLive).toBe(false);

    expect((await app.call('GET', board(TOMORROW), { as: 'usr_casey' })).body).toEqual({ whiteboard: null, view: null });
    expect((await app.call('GET', board(), { as: 'usr_taylor' })).status).toBe(403);
    expect((await app.call('GET', `/branches/${B1}/whiteboards/not-a-date`, { as: 'usr_casey' })).status).toBe(400);
  });

  it('lists boards in a bounded range', async () => {
    const app = await createTestApp();
    const list = await app.call('GET', `/branches/${B1}/whiteboards?from=2026-03-01&to=2026-03-31`, { as: 'usr_casey' });
    expect(list.body).toEqual([{ date: TODAY, title: 'Morning huddle', blockCount: 6, live: 'auto' }]);
    expect((await app.call('GET', `/branches/${B1}/whiteboards?from=2026-01-01&to=2026-03-31`, { as: 'usr_casey' })).status).toBe(400);
    expect((await app.call('GET', `/branches/${B1}/whiteboards?from=2026-03-31&to=2026-03-01`, { as: 'usr_casey' })).status).toBe(400);
    expect((await app.call('GET', `/branches/${B1}/whiteboards`, { as: 'usr_casey' })).status).toBe(400);
  });

  it('only managers of the branch edit', async () => {
    const app = await createTestApp();
    expect((await app.call('PUT', board(), { as: 'usr_casey', body: { title: 'x' } })).status).toBe(403);
    expect((await app.call('PUT', board(), { as: 'usr_jordan', body: { title: 'x' } })).status).toBe(403);
    expect((await app.call('POST', `${board()}/live`, { as: 'usr_casey', body: { live: 'on' } })).status).toBe(403);
    expect((await app.call('POST', `${board(TOMORROW)}/copy`, { as: 'usr_riley', body: { fromDate: TODAY } })).status).toBe(403);
    expect((await app.call('PUT', board(), { as: 'usr_avery', body: { title: 'Admin edit' } })).status).toBe(200);
  });

  it('creates a new board with defaults and server-stamped audit fields', async () => {
    const app = await createTestApp();
    const res = await app.call('PUT', board(TOMORROW), {
      as: 'usr_morgan',
      body: {
        title: 'Tuesday huddle',
        createdBy: 'usr_casey',
        createdAt: '2020-01-01T00:00:00.000Z',
        live: 'on',
        blocks: [{ id: 'b1', kind: 'talking_points', items: [{ id: 'i1', text: '  Welcome  ' }] }],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.whiteboard).toMatchObject({
      id: `wb_${B1}_${TOMORROW}`,
      date: TOMORROW,
      title: 'Tuesday huddle',
      window: { start: '07:30', end: '08:15' },
      live: 'auto',
      orderLabels: 'name',
      createdBy: 'usr_morgan',
      createdAt: NOW.toISOString(),
      blocks: [{ id: 'b1', kind: 'talking_points', title: 'Talking points', items: [{ id: 'i1', text: 'Welcome' }] }],
    });
    // A partial update keeps everything it does not mention.
    const patch = await app.call('PUT', board(TOMORROW), { as: 'usr_morgan', body: { window: { start: '07:00', end: '07:45' } } });
    expect(patch.body.whiteboard).toMatchObject({ title: 'Tuesday huddle', window: { start: '07:00', end: '07:45' }, blocks: [{ id: 'b1' }] });
    expect(app.publisher.sent.some((s) => s.groups.includes(`scope:${B1}`) && s.groups.includes(`wall:${B1}`) && s.message.entities.includes('whiteboard'))).toBe(true);
    const events = await app.repo.listEvents(B1, 'whiteboard', `wb_${B1}_${TOMORROW}`);
    expect(events.map((e) => e.action).sort()).toEqual(['whiteboard.create', 'whiteboard.update']);
  });

  it('rejects past dates and invalid content', async () => {
    const app = await createTestApp();
    const put = (blocks: unknown[], extra: Record<string, unknown> = {}) => app.call('PUT', board(TOMORROW), { as: 'usr_morgan', body: { blocks, ...extra } });
    expect((await app.call('PUT', board('2026-03-09'), { as: 'usr_morgan', body: { title: 'old' } })).status).toBe(400);
    expect((await put([], { window: { start: '09:00', end: '08:00' } })).status).toBe(400);
    expect((await put([{ id: 'x', kind: 'metrics' }, { id: 'x', kind: 'metrics' }])).status).toBe(400);
    expect((await put([{ id: 'p', kind: 'priority_orders', items: [{ orderId: 'ord_o10' }] }])).body.error.message).toMatch(/not in this branch/); // B2 order
    expect((await put([{ id: 'p', kind: 'priority_orders', items: [{ orderId: 'ord_nope' }] }])).status).toBe(400);
    const asg = (userId: string) => [{ id: 'a', kind: 'assignments', items: [{ id: 'i', userId, text: 'x', taskId: null, done: false }] }];
    expect((await put(asg('usr_taylor'))).status).toBe(400); // B2 only
    expect((await put(asg('usr_ghost'))).status).toBe(400);
    expect((await put(asg('usr_riley'))).status).toBe(200);
    expect((await put([{ id: 'img', kind: 'image', mediaId: 'med_missing' }])).status).toBe(400);
    const b2media = await upload(app, png(), 'image/png', 'usr_jordan', B2);
    expect(b2media.status).toBe(201);
    expect((await put([{ id: 'img', kind: 'image', mediaId: b2media.body.id }])).status).toBe(400);
    expect((await put([{ id: 'img', kind: 'image', mediaId: SEED_MEDIA_ID }])).status).toBe(200);
    expect((await put([{ id: 'n', kind: 'note', text: 'x'.repeat(WHITEBOARD_LIMITS.maxNoteText + 1) }])).status).toBe(400);
  });

  it('keeps task links server-owned on PUT', async () => {
    const app = await createTestApp();
    const blocks = await blocksOf(app);
    const forged = blocks.map((b) => (b.kind === 'assignments' ? { ...b, items: b.items.map((i) => ({ ...i, taskId: 'task_forged' })) } : b));
    const res = await app.call('PUT', board(), { as: 'usr_morgan', body: { blocks: forged } });
    expect(res.status).toBe(200);
    const asg = (await blocksOf(app)).find((b) => b.kind === 'assignments');
    expect(asg?.kind === 'assignments' && asg.items.every((i) => i.taskId === null)).toBe(true);
  });

  it('copies blocks from another date with assignment state reset', async () => {
    const app = await createTestApp();
    await app.call('POST', `${board()}/assignments/itm_asg_1/task`, { as: 'usr_morgan', body: {} });
    expect((await app.call('POST', `${board(TOMORROW)}/copy`, { as: 'usr_morgan', body: { fromDate: '2026-03-01' } })).status).toBe(404);
    expect((await app.call('POST', `${board()}/copy`, { as: 'usr_morgan', body: { fromDate: TODAY } })).status).toBe(400);
    const res = await app.call('POST', `${board(TOMORROW)}/copy`, { as: 'usr_morgan', body: { fromDate: TODAY } });
    expect(res.status).toBe(200);
    expect(res.body.whiteboard).toMatchObject({ date: TOMORROW, live: 'auto', window: { start: '07:30', end: '08:15' } });
    const asg = res.body.whiteboard.blocks.find((b: WhiteboardBlock) => b.kind === 'assignments');
    expect(asg.items.map((i: { done: boolean; taskId: string | null }) => [i.done, i.taskId])).toEqual([[false, null], [false, null], [false, null]]);
    expect(res.body.whiteboard.blocks).toHaveLength(6);
  });

  it('switches live mode (manager) and requires an existing board', async () => {
    const app = await createTestApp();
    expect((await app.call('POST', `${board(TOMORROW)}/live`, { as: 'usr_morgan', body: { live: 'on' } })).status).toBe(404);
    expect((await app.call('POST', `${board()}/live`, { as: 'usr_morgan', body: { live: 'maybe' } })).status).toBe(400);
    const res = await app.call('POST', `${board()}/live`, { as: 'usr_morgan', body: { live: 'on' } });
    expect(res.status).toBe(200);
    expect(res.body.view.isLive).toBe(true);
    expect(app.publisher.sent.some((s) => s.groups.includes(`wall:${B1}`) && s.message.entities.includes('whiteboard'))).toBe(true);
  });
});

describe('whiteboard assignments', () => {
  it('can be checked off by the assignee or a manager, not by another member', async () => {
    const app = await createTestApp();
    const done = (itemId: string, as: string, value = true) => app.call('POST', `${board()}/assignments/${itemId}/done`, { as, body: { done: value } });
    expect((await done('itm_asg_1', 'usr_riley')).status).toBe(403);
    const ok = await done('itm_asg_1', 'usr_casey');
    expect(ok.status).toBe(200);
    expect(ok.body.view.blocks.find((b: { kind: string }) => b.kind === 'assignments').items[0]).toMatchObject({ done: true, person: { name: 'Casey Brooks' } });
    expect((await done('itm_asg_1', 'usr_morgan', false)).status).toBe(200);
    // Team items (no person) can be checked off by anyone in the branch.
    expect((await done('itm_asg_3', 'usr_riley')).status).toBe(200);
    expect((await done('itm_missing', 'usr_morgan')).status).toBe(404);
    expect((await done('itm_asg_1', 'usr_taylor')).status).toBe(403); // not in the branch
    expect((await app.call('POST', `${board(TOMORROW)}/assignments/itm_asg_1/done`, { as: 'usr_morgan', body: { done: true } })).status).toBe(404);
  });

  it('creates exactly one linked branch task per item (manager only)', async () => {
    const app = await createTestApp();
    const path = `${board()}/assignments/itm_asg_1/task`;
    expect((await app.call('POST', path, { as: 'usr_casey', body: { priority: 'hot' } })).status).toBe(403);
    const res = await app.call('POST', path, { as: 'usr_morgan', body: { priority: 'hot' } });
    expect(res.status).toBe(201);
    expect(res.body.task).toMatchObject({
      scopeId: B1,
      scope: 'branch',
      branchId: B1,
      title: 'Call back yesterday’s forklift applicants before 10a',
      category: 'operations',
      priority: 'hot',
      assigneeId: 'usr_casey',
      boardDate: TODAY,
      status: 'open',
      createdBy: 'usr_morgan',
    });
    const item = res.body.whiteboard.blocks.find((b: WhiteboardBlock) => b.kind === 'assignments').items[0];
    expect(item.taskId).toBe(res.body.task.id);
    expect(await app.repo.getTask(B1, res.body.task.id)).toMatchObject({ id: res.body.task.id });
    expect(app.publisher.sent.some((s) => s.message.entities.includes('tasks'))).toBe(true);

    const again = await app.call('POST', path, { as: 'usr_morgan', body: { priority: 'hot' } });
    expect(again.status).toBe(409);
    expect((await app.repo.listOpenTasks(B1)).filter((t) => t.title.startsWith('Call back yesterday')).length).toBe(1);

    // Team items create an unassigned task; default priority is normal.
    const team = await app.call('POST', `${board()}/assignments/itm_asg_3/task`, { as: 'usr_morgan' });
    expect(team.status).toBe(201);
    expect(team.body.task).toMatchObject({ assigneeId: null, priority: 'normal' });
  });
});

describe('whiteboard media upload', () => {
  it('stores a valid image with sniffed dimensions and dedupes by content', async () => {
    const app = await createTestApp();
    const res = await upload(app, png(64, 32), 'image/png');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ branchId: B1, contentType: 'image/png', width: 64, height: 32, fileName: 'chart q1.png', uploadedBy: 'usr_morgan' });
    expect(res.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await app.media.get(B1, res.body.id)).toEqual(png(64, 32));

    const again = await upload(app, png(64, 32), 'image/png; charset=binary');
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(res.body.id);

    const jpg = await upload(app, jpeg, 'image/jpeg');
    expect(jpg.status).toBe(201);
    expect(jpg.body).toMatchObject({ contentType: 'image/jpeg', width: 3, height: 2 });
  });

  it('does not hand back an old copy that is about to expire', async () => {
    const app = await createTestApp();
    const first = await upload(app, png(40, 20), 'image/png');
    expect(first.status).toBe(201);
    // 80 days later the first copy has 10 days of retention left (TTL and blob lifecycle run from the first upload).
    app.clock.now = new Date(NOW.getTime() + 80 * 86_400_000);
    const later = await upload(app, png(40, 20), 'image/png');
    expect(later.status).toBe(201);
    expect(later.body.id).not.toBe(first.body.id);
    // The fresh copy is the one reused from now on.
    const again = await upload(app, png(40, 20), 'image/png');
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(later.body.id);
  });

  it('is manager-only', async () => {
    const app = await createTestApp();
    expect((await upload(app, png(), 'image/png', 'usr_casey')).status).toBe(403);
    expect((await upload(app, png(), 'image/png', 'usr_jordan')).status).toBe(403);
  });

  it('rejects non-images (415), spoofed types (400), empty (400) and oversize (413)', async () => {
    const app = await createTestApp();
    expect((await app.call('POST', `/branches/${B1}/media`, { as: 'usr_morgan', body: { a: 1 }, headers: { 'content-type': 'application/json' } })).status).toBe(415);
    expect((await upload(app, Buffer.from('GIF89a'), 'image/gif')).status).toBe(415);
    expect((await upload(app, Buffer.from('<svg/>'), 'image/svg+xml')).status).toBe(415);
    expect((await upload(app, png(), 'image/jpeg')).status).toBe(400); // PNG bytes declared as JPEG
    expect((await upload(app, jpeg, 'image/webp')).status).toBe(400);
    expect((await upload(app, Buffer.from('<html><script>alert(1)</script>'), 'image/png')).status).toBe(400);
    expect((await upload(app, Buffer.alloc(0), 'image/png')).status).toBe(400);
    const big = Buffer.concat([png(), Buffer.alloc(WHITEBOARD_LIMITS.maxImageBytes)]);
    expect((await upload(app, big, 'image/png')).status).toBe(413);
  });

  it('serves bytes to staff of the branch only', async () => {
    const app = await createTestApp();
    const res = await app.call('GET', `/branches/${B1}/media/${SEED_MEDIA_ID}`, { as: 'usr_casey' });
    expect(res.status).toBe(200);
    expect(res.headers?.['content-type']).toBe('image/png');
    expect(res.headers?.['cache-control']).toBe('private, max-age=3600');
    expect(res.headers?.['x-content-type-options']).toBe('nosniff');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body).toEqual(seedChartPng());
    expect((await app.call('GET', `/branches/${B1}/media/${SEED_MEDIA_ID}`, { as: 'usr_taylor' })).status).toBe(403);
    expect((await app.call('GET', `/branches/${B2}/media/${SEED_MEDIA_ID}`, { as: 'usr_jordan' })).status).toBe(404);
    expect((await app.call('GET', `/branches/${B1}/media/med_nope`, { as: 'usr_casey' })).status).toBe(404);
  });
});

describe('wall takeover', () => {
  it('switches mode exactly at the window edges and always reports the next change', async () => {
    const app = await createTestApp();
    const feed = async (iso: string) => {
      app.clock.now = new Date(iso);
      const res = await app.call('GET', '/wall/feed', { headers: display });
      expect(res.status).toBe(200);
      return res.body;
    };
    const before = await feed('2026-03-10T12:29:59.000Z');
    expect(before.mode).toBe('board');
    expect(before).not.toHaveProperty('whiteboard');
    expect(before.nextModeChangeAt).toBe('2026-03-10T12:30:00.000Z');
    expect(before.orders.length).toBeGreaterThan(0);

    const during = await feed('2026-03-10T12:30:00.000Z');
    expect(during.mode).toBe('whiteboard');
    expect(during.nextModeChangeAt).toBe('2026-03-10T13:15:00.000Z');
    expect(during.whiteboard.isLive).toBe(true);
    expect(during.whiteboard.blocks.find((b: { kind: string }) => b.kind === 'image').mediaUrl).toBe(`/api/wall/media/${SEED_MEDIA_ID}`);

    const after = await feed('2026-03-10T13:15:00.000Z');
    expect(after.mode).toBe('board');
    expect(after).not.toHaveProperty('whiteboard');
    expect(after.nextModeChangeAt).toBeNull();

    // Next day: the board is from yesterday, so nothing is live or scheduled.
    const tomorrow = await feed('2026-03-11T12:45:00.000Z');
    expect(tomorrow.mode).toBe('board');
    expect(tomorrow.nextModeChangeAt).toBeNull();
  });

  it("follows manual 'on' and 'off'", async () => {
    const app = await createTestApp();
    await app.call('POST', `${board()}/live`, { as: 'usr_morgan', body: { live: 'on' } });
    const on = await app.call('GET', '/wall/feed', { headers: display });
    expect(on.body.mode).toBe('whiteboard');
    expect(on.body.nextModeChangeAt).toBeNull();

    await app.call('POST', `${board()}/live`, { as: 'usr_morgan', body: { live: 'off' } });
    app.clock.now = IN_WINDOW;
    const off = await app.call('GET', '/wall/feed', { headers: display });
    expect(off.body.mode).toBe('board');
    expect(off.body).not.toHaveProperty('whiteboard');
  });

  it('never puts personal or confidential data in the takeover feed', async () => {
    const app = await createTestApp();
    app.clock.now = IN_WINDOW;
    // Code labels: no account names anywhere on the display.
    await app.call('PUT', board(), { as: 'usr_morgan', body: { orderLabels: 'code' } });
    const res = await app.call('GET', '/wall/feed', { headers: display });
    expect(res.body.mode).toBe('whiteboard');
    const json = JSON.stringify(res.body);
    const accounts = await app.repo.listAccounts(B1);
    const orders = await app.repo.listOrders(B1, { open: true });
    const users = await app.repo.listUsers();
    const candidates = await app.repo.listCandidates(B1, 'active');
    const personal = await app.repo.listOpenTasks('personal:usr_casey');
    const forbidden = [
      ...accounts.flatMap((a) => [a.name, a.id, ...(a.contacts ?? []).flatMap((c) => [c.email, c.name])]),
      ...orders.flatMap((o) => [o.id, ...o.openings.map((l) => l.id), ...(o.note ? [o.note] : [])]),
      ...orders.flatMap((o) => (o.payRate === null ? [] : [`${o.payRate}/hr`])),
      ...users.flatMap((u) => [u.email, u.id]),
      ...users.filter((u) => !u.branchIds.includes(B1)).map((u) => u.name),
      ...candidates.flatMap((c) => [c.id, c.firstName, c.lastName]),
      ...personal.map((t) => t.title),
      SEED_MEDIA_ID.length > 0 ? `/branches/${B1}/media` : '',
    ];
    for (const value of forbidden) expect(json, value).not.toContain(value);
    // Huddle decision: branch people's names may be shown.
    expect(json).toContain('Casey Brooks');
    const po = res.body.whiteboard.blocks.find((b: { kind: string }) => b.kind === 'priority_orders');
    expect(po.items.map((i: { label: string }) => i.label)).toEqual(po.items.map((i: { client: { code: string } }) => i.client.code));
  });
});

describe('WALL MEDIA INVARIANT', () => {
  const media = (app: TestApp, id = SEED_MEDIA_ID, headers: Record<string, string> = display) => app.call('GET', `/wall/media/${id}`, { headers });

  it('serves referenced media only while the board is live', async () => {
    const app = await createTestApp();
    // NOW is after the window.
    expect((await media(app)).status).toBe(404);
    app.clock.now = new Date('2026-03-10T12:29:59.000Z');
    expect((await media(app)).status).toBe(404);

    app.clock.now = IN_WINDOW;
    const live = await media(app);
    expect(live.status).toBe(200);
    expect(live.headers?.['content-type']).toBe('image/png');
    expect(live.headers?.['cache-control']).toBe('no-store');
    expect(live.body).toEqual(seedChartPng());

    app.clock.now = new Date('2026-03-10T13:15:00.000Z');
    expect((await media(app)).status).toBe(404);
  });

  it('404s for media that exist but are not on the live board, or belong to another branch', async () => {
    const app = await createTestApp();
    const other = await upload(app, png(9, 9), 'image/png');
    const b2 = await upload(app, png(7, 7), 'image/png', 'usr_jordan', B2);
    app.clock.now = IN_WINDOW;
    expect((await media(app)).status).toBe(200);
    const unreferenced = await media(app, other.body.id);
    expect(unreferenced.status).toBe(404);
    expect(unreferenced.body.error.code).toBe('not_found');
    expect((await media(app, b2.body.id)).status).toBe(404);
    expect((await media(app, '..%2F..%2Fetc')).status).toBe(404);
  });

  it("404s when the board is set to 'off', and for yesterday's board", async () => {
    const app = await createTestApp();
    app.clock.now = IN_WINDOW;
    await app.call('POST', `${board()}/live`, { as: 'usr_morgan', body: { live: 'off' } });
    expect((await media(app)).status).toBe(404);
    await app.call('POST', `${board()}/live`, { as: 'usr_morgan', body: { live: 'on' } });
    expect((await media(app)).status).toBe(200);
    app.clock.now = new Date('2026-03-11T12:45:00.000Z');
    expect((await media(app)).status).toBe(404);
  });

  it('requires a display token and never accepts staff identity', async () => {
    const app = await createTestApp();
    app.clock.now = IN_WINDOW;
    expect((await media(app, SEED_MEDIA_ID, {})).status).toBe(401);
    expect((await app.call('GET', `/wall/media/${SEED_MEDIA_ID}`, { as: 'usr_morgan' })).status).toBe(401);
    await app.call('POST', `/branches/${B1}/displays/dsp_riverside_lobby/revoke`, { as: 'usr_morgan' });
    expect((await media(app)).status).toBe(401);
  });
});

describe('per-display content (office TVs)', () => {
  const lobby = `/branches/${B1}/displays/dsp_riverside_lobby`;
  const media = (app: TestApp) => app.call('GET', `/wall/media/${SEED_MEDIA_ID}`, { headers: display });
  const feed = async (app: TestApp) => (await app.call('GET', '/wall/feed', { headers: display })).body;

  it("'whiteboard' shows today's board all day, with its images, and never schedules a switch", async () => {
    const app = await createTestApp();
    // NOW is after the huddle window: an 'auto' screen shows the coded board here.
    expect((await feed(app)).mode).toBe('board');
    const res = await app.call('PATCH', lobby, { as: 'usr_morgan', body: { content: 'whiteboard' } });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('whiteboard');
    const pinned = await feed(app);
    expect(pinned.mode).toBe('whiteboard');
    expect(pinned.nextModeChangeAt).toBeNull();
    expect((await media(app)).status).toBe(200);
    // Even when the manager turns the huddle off for the lobby screens.
    await app.call('POST', `${board()}/live`, { as: 'usr_morgan', body: { live: 'off' } });
    expect((await feed(app)).mode).toBe('whiteboard');
    // Tomorrow, with no board yet: back to the coded board and no media.
    app.clock.now = new Date('2026-03-11T15:00:00.000Z');
    const tomorrow = await feed(app);
    expect(tomorrow.mode).toBe('board');
    expect(tomorrow).not.toHaveProperty('whiteboard');
    expect((await media(app)).status).toBe(404);
  });

  it("'board' never shows the whiteboard, even inside the window or after Start now", async () => {
    const app = await createTestApp();
    await app.call('PATCH', lobby, { as: 'usr_morgan', body: { content: 'board' } });
    app.clock.now = IN_WINDOW;
    const inWindow = await feed(app);
    expect(inWindow.mode).toBe('board');
    expect(inWindow).not.toHaveProperty('whiteboard');
    expect(inWindow.nextModeChangeAt).toBeNull();
    expect((await media(app)).status).toBe(404);
    await app.call('POST', `${board()}/live`, { as: 'usr_morgan', body: { live: 'on' } });
    expect((await feed(app)).mode).toBe('board');
    expect((await media(app)).status).toBe(404);
  });

  it("treats display records without the field as 'auto'", async () => {
    const app = await createTestApp();
    await app.repo.updateDisplay('dsp_riverside_lobby', (d) => {
      const { content: _drop, ...rest } = d;
      return rest as typeof d;
    });
    app.clock.now = IN_WINDOW;
    expect((await feed(app)).mode).toBe('whiteboard');
    app.clock.now = new Date('2026-03-10T13:15:00.000Z');
    expect((await feed(app)).mode).toBe('board');
  });

  it('only managers of the branch can change a display; revoked displays cannot be changed', async () => {
    const app = await createTestApp();
    expect((await app.call('PATCH', lobby, { as: 'usr_casey', body: { content: 'whiteboard' } })).status).toBe(403);
    expect((await app.call('PATCH', lobby, { as: 'usr_jordan', body: { content: 'whiteboard' } })).status).toBe(403);
    expect((await app.call('PATCH', lobby, { as: 'usr_morgan', body: { content: 'everything' } })).status).toBe(400);
    const renamed = await app.call('PATCH', lobby, { as: 'usr_morgan', body: { name: 'Office TV' } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Office TV');
    await app.call('POST', `${lobby}/revoke`, { as: 'usr_morgan' });
    expect((await app.call('PATCH', lobby, { as: 'usr_morgan', body: { content: 'whiteboard' } })).status).toBe(409);
  });
});

describe('staff wall preview', () => {
  it('mirrors the takeover and can force it outside the window (staff only)', async () => {
    const app = await createTestApp();
    const normal = await app.call('GET', `/branches/${B1}/wall/preview`, { as: 'usr_casey' });
    expect(normal.body.mode).toBe('board');
    const forced = await app.call('GET', `/branches/${B1}/wall/preview?mode=whiteboard`, { as: 'usr_casey' });
    expect(forced.status).toBe(200);
    expect(forced.body.mode).toBe('whiteboard');
    expect(forced.body.whiteboard.isLive).toBe(false);
    expect(forced.body.whiteboard.blocks.find((b: { kind: string }) => b.kind === 'image').mediaUrl).toBe(`/api/branches/${B1}/media/${SEED_MEDIA_ID}`);

    // Displays cannot force it.
    const wall = await app.call('GET', '/wall/feed?mode=whiteboard', { headers: display });
    expect(wall.body.mode).toBe('board');
    expect(wall.body).not.toHaveProperty('whiteboard');

    expect((await app.call('GET', `/branches/${B1}/wall/preview?mode=whiteboard`, { as: 'usr_taylor' })).status).toBe(403);
    expect((await app.call('GET', `/branches/${B1}/wall/preview?mode=bogus`, { as: 'usr_casey' })).status).toBe(400);
    // No board today in B2: forcing falls back to the order board.
    expect((await app.call('GET', `/branches/${B2}/wall/preview?mode=whiteboard`, { as: 'usr_jordan' })).body.mode).toBe('board');
  });

  it('matches the display feed while live, apart from media URLs', async () => {
    const app = await createTestApp();
    app.clock.now = IN_WINDOW;
    const feed = await app.call('GET', '/wall/feed', { headers: display });
    const preview = await app.call('GET', `/branches/${B1}/wall/preview`, { as: 'usr_casey' });
    const normalize = (body: unknown) => JSON.parse(JSON.stringify(body).replaceAll(`/api/branches/${B1}/media/`, '/api/wall/media/'));
    expect(normalize(preview.body)).toEqual(feed.body);
  });
});

describe('DEV_WHITEBOARD_LIVE', () => {
  it("forces today's board live in dev, except when set to 'off'", async () => {
    const app = await createTestApp({ DEV_WHITEBOARD_LIVE: 'on' });
    const res = await app.call('GET', '/wall/feed', { headers: display });
    expect(res.body.mode).toBe('whiteboard');
    expect(res.body.nextModeChangeAt).toBeNull();
    expect((await app.call('GET', `/wall/media/${SEED_MEDIA_ID}`, { headers: display })).status).toBe(200);
    await app.call('POST', `${board()}/live`, { as: 'usr_morgan', body: { live: 'off' } });
    expect((await app.call('GET', '/wall/feed', { headers: display })).body.mode).toBe('board');
  });

  it('is refused outside dev auth and on Azure', () => {
    expect(() => testConfig({ DEV_WHITEBOARD_LIVE: 'on', AUTH_MODE: 'swa' })).toThrow(ConfigError);
    expect(() => testConfig({ DEV_WHITEBOARD_LIVE: 'on', WEBSITE_SITE_NAME: 'app' })).toThrow(ConfigError);
    expect(testConfig().devWhiteboardLive).toBe(false);
  });
});

describe('media config', () => {
  it('validates the blob endpoint and container name', () => {
    expect(testConfig({ MEDIA_BLOB_ENDPOINT: 'https://stbranch.blob.core.windows.net/' })).toMatchObject({
      mediaBlobEndpoint: 'https://stbranch.blob.core.windows.net',
      mediaContainer: 'whiteboard-media',
    });
    expect(() => testConfig({ MEDIA_BLOB_ENDPOINT: 'http://stbranch.blob.core.windows.net' })).toThrow(ConfigError);
    expect(() => testConfig({ MEDIA_BLOB_ENDPOINT: 'https://stbranch.blob.core.windows.net/container' })).toThrow(ConfigError);
    expect(() => testConfig({ MEDIA_CONTAINER: 'Bad_Name' })).toThrow(ConfigError);
  });
});

describe('binary request plumbing (adapters)', () => {
  it('passes image bodies through as bytes and rejects oversize with 413', async () => {
    const app = await createTestApp();
    const req = toApiRequest({ method: 'POST', url: '/api/branches/b/media', headers: [['Content-Type', 'image/png']], bodyText: '', bodyBytes: png() });
    expect(req.rawBody).toEqual(png());
    expect(req.body).toBeUndefined();

    const router = createRouter();
    const res = await router.handleRaw(
      { method: 'POST', url: `/api/branches/${B1}/media`, headers: [['content-type', 'image/png']], bodyText: '', bodyBytes: Buffer.alloc(WHITEBOARD_LIMITS.maxImageBytes + 1) },
      app.ctx,
    );
    expect(res.status).toBe(413);
  });

  it('stops reading a stream as soon as it passes the limit', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
        if (pulled > 100) controller.close();
      },
    });
    await expect(readStreamLimited(stream, 4096)).rejects.toMatchObject({ status: 413 });
    expect(pulled).toBeLessThan(10);
    const small = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]));
        c.enqueue(new Uint8Array([3]));
        c.close();
      },
    });
    expect(await readStreamLimited(small, 3)).toEqual(Buffer.from([1, 2, 3]));
    expect(await readStreamLimited(null, 3)).toEqual(Buffer.alloc(0));
  });
});
