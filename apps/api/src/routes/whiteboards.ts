/**
 * Morning whiteboard (huddle) routes and whiteboard media (packages/shared/src/whiteboard.ts contract).
 * Managers edit; any branch reader reads. Server stamps every audit field and owns assignment task links.
 */
import { createHash } from 'node:crypto';
import {
  canManage,
  copyWhiteboardBlocks,
  daysBetween,
  DEFAULT_HUDDLE_WINDOW,
  newId,
  sniffImage,
  todayKey,
  validateWhiteboard,
  WHITEBOARD_LIMITS,
  zAssignmentDoneInput,
  zAssignmentTaskInput,
  zDayKey,
  zMedia,
  zWhiteboard,
  zWhiteboardCopyInput,
  zWhiteboardLiveInput,
  zWhiteboardUpsertInput,
  type Branch,
  type Media,
  type Task,
  type Whiteboard,
  type WhiteboardBlock,
  type WhiteboardResponse,
  type WhiteboardSummary,
} from '@branchsuite/shared';
import type { Caller } from '../auth/staff.js';
import type { AppContext } from '../context.js';
import { whiteboardId } from '../data/documentRepo.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../http/errors.js';
import { mediaType, payloadTooLarge } from '../http/request.js';
import type { Router } from '../http/router.js';
import { bytes, created, ok, type ApiRequest } from '../http/types.js';
import { parse, parsePatch } from '../http/validate.js';
import { audit, managedBranch, notify, readableBranch, staff } from './support.js';
import { buildWhiteboardView, imageMediaIds, loadMedia } from './whiteboardView.js';

const MAX_LIST_DAYS = 62;
const FILE_NAME_HEADER = 'x-file-name';

type AssignmentItem = Extract<WhiteboardBlock, { kind: 'assignments' }>['items'][number];

// ---------- helpers ----------

function dateParam(req: ApiRequest): string {
  const result = zDayKey.safeParse(req.params.date);
  if (!result.success) throw badRequest('Use a YYYY-MM-DD date.');
  return result.data;
}

function isManager(caller: Caller, branchId: string): boolean {
  return caller.perms.isAdmin || canManage(caller.perms, branchId);
}

function requireEditableDate(ctx: AppContext, branch: Branch, date: string): void {
  if (date < todayKey(branch.timeZone, ctx.now())) throw badRequest('Past whiteboards are read-only.');
}

async function respond(ctx: AppContext, branch: Branch, wb: Whiteboard | null): Promise<WhiteboardResponse> {
  return { whiteboard: wb, view: wb ? await buildWhiteboardView(ctx, branch, wb, 'staff') : null };
}

function changed(ctx: AppContext, caller: Caller, wb: Whiteboard, action: string, summary: string): Promise<void> {
  // Realtime: staff boards and every wall display of the branch refetch (displays re-evaluate mode).
  notify(ctx, wb.branchId, ['whiteboard'], { wall: true });
  // AuditEvent has no 'whiteboard' entity; board events are recorded on the branch with the board id.
  return audit(ctx, caller.user.id, { branchId: wb.branchId, entity: 'whiteboard', entityId: wb.id, action: `whiteboard.${action}`, summary });
}

function newBoard(branch: Branch, date: string, actorId: string, nowIso: string): Whiteboard {
  return {
    id: whiteboardId(branch.id, date),
    branchId: branch.id,
    date,
    title: 'Morning huddle',
    window: { ...DEFAULT_HUDDLE_WINDOW },
    live: 'auto',
    orderLabels: 'name',
    blocks: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: actorId,
    updatedBy: actorId,
  };
}

function findAssignment(wb: Whiteboard, itemId: string): AssignmentItem | null {
  for (const block of wb.blocks) {
    if (block.kind !== 'assignments') continue;
    const item = block.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return null;
}

function mapAssignment(wb: Whiteboard, itemId: string, fn: (item: AssignmentItem) => AssignmentItem): Whiteboard {
  return {
    ...wb,
    blocks: wb.blocks.map((block) =>
      block.kind === 'assignments' ? { ...block, items: block.items.map((i) => (i.id === itemId ? fn(i) : i)) } : block,
    ),
  };
}

/** Task links are server-owned: keep each item's existing taskId (by item id); new items start unlinked. */
function preserveTaskLinks(blocks: WhiteboardBlock[], current: Whiteboard | null): WhiteboardBlock[] {
  const links = new Map<string, string | null>();
  for (const block of current?.blocks ?? []) if (block.kind === 'assignments') for (const i of block.items) links.set(i.id, i.taskId);
  return blocks.map((block) =>
    block.kind === 'assignments' ? { ...block, items: block.items.map((i) => ({ ...i, taskId: links.get(i.id) ?? null })) } : block,
  );
}

/** Orders, people and media referenced by blocks must belong to the branch. Returns the media ids found. */
async function checkReferences(ctx: AppContext, branch: Branch, blocks: WhiteboardBlock[]): Promise<Set<string>> {
  const orderIds = new Set<string>();
  const userIds = new Set<string>();
  for (const block of blocks) {
    if (block.kind === 'priority_orders') for (const i of block.items) orderIds.add(i.orderId);
    if (block.kind === 'assignments') for (const i of block.items) if (i.userId !== null) userIds.add(i.userId);
  }
  const [orders, users, media] = await Promise.all([
    Promise.all([...orderIds].map((id) => ctx.repo.getOrder(branch.id, id))),
    Promise.all([...userIds].map((id) => ctx.repo.getUser(id))),
    loadMedia(ctx, branch.id, imageMediaIds({ blocks })),
  ]);
  if (orders.some((o) => o === null)) throw badRequest('A priority order is not in this branch.');
  if (users.some((u) => !u || !u.active || !u.branchIds.includes(branch.id))) {
    throw badRequest('Assignments can go only to active people in this branch.');
  }
  return new Set(media.keys());
}

function finalize(next: Whiteboard, knownMedia: Set<string>): Whiteboard {
  const errors = validateWhiteboard(next, knownMedia);
  if (errors.length > 0) throw badRequest('This whiteboard has problems.', errors);
  const parsed = zWhiteboard.safeParse(next);
  if (!parsed.success) throw badRequest('This whiteboard has problems.', parsed.error.issues.map((i) => i.message));
  return parsed.data;
}

/** "chart.png" from an x-file-name header (URL-encoded or plain); never a path, never control characters. */
function cleanFileName(header: string | undefined): string {
  let name = header ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep as sent
  }
  name = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return name || 'image';
}

// ---------- routes ----------

export function registerWhiteboardRoutes(router: Router): void {
  router.get(
    '/branches/:b/whiteboards',
    staff(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const from = zDayKey.safeParse(req.query.get('from'));
      const to = zDayKey.safeParse(req.query.get('to'));
      if (!from.success || !to.success) throw badRequest('from and to must be YYYY-MM-DD dates.');
      const span = daysBetween(from.data, to.data);
      if (span < 0 || span > MAX_LIST_DAYS) throw badRequest(`Pick a range of 0 to ${MAX_LIST_DAYS} days.`);
      const boards = await ctx.repo.listWhiteboards(branch.id, from.data, to.data);
      const summaries: WhiteboardSummary[] = boards.map((wb) => ({ date: wb.date, title: wb.title, blockCount: wb.blocks.length, live: wb.live }));
      return ok(summaries);
    }),
  );

  router.get(
    '/branches/:b/whiteboards/:date',
    staff(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      return ok(await respond(ctx, branch, await ctx.repo.getWhiteboard(branch.id, dateParam(req))));
    }),
  );

  router.put(
    '/branches/:b/whiteboards/:date',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const date = dateParam(req);
      requireEditableDate(ctx, branch, date);
      const input = parsePatch(zWhiteboardUpsertInput, req.body ?? {});
      const knownMedia = input.blocks ? await checkReferences(ctx, branch, input.blocks) : null;
      let isNew = false;
      const wb = await ctx.repo.upsertWhiteboard(branch.id, date, (current) => {
        const nowIso = ctx.now().toISOString();
        isNew = current === null;
        const base = current ?? newBoard(branch, date, caller.user.id, nowIso);
        const next: Whiteboard = {
          ...base,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.window !== undefined ? { window: input.window } : {}),
          ...(input.orderLabels !== undefined ? { orderLabels: input.orderLabels } : {}),
          blocks: input.blocks ? preserveTaskLinks(input.blocks, current) : base.blocks,
          updatedAt: nowIso,
          updatedBy: caller.user.id,
        };
        // Unchanged blocks were validated when stored; only new blocks need their media checked.
        return finalize(next, knownMedia ?? imageMediaIds(next));
      });
      await changed(ctx, caller, wb, isNew ? 'create' : 'update', `${isNew ? 'Created' : 'Updated'} whiteboard ${date}`);
      return ok(await respond(ctx, branch, wb));
    }),
  );

  router.post(
    '/branches/:b/whiteboards/:date/live',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const date = dateParam(req);
      requireEditableDate(ctx, branch, date);
      const { live } = parse(zWhiteboardLiveInput, req.body);
      if (!(await ctx.repo.getWhiteboard(branch.id, date))) throw notFound('Create the whiteboard for that date first.');
      const wb = await ctx.repo.updateWhiteboard(branch.id, date, (current) => ({
        ...current,
        live,
        updatedAt: ctx.now().toISOString(),
        updatedBy: caller.user.id,
      }));
      await changed(ctx, caller, wb, 'live', `Whiteboard ${date} display set to ${live}`);
      return ok(await respond(ctx, branch, wb));
    }),
  );

  router.post(
    '/branches/:b/whiteboards/:date/copy',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const date = dateParam(req);
      requireEditableDate(ctx, branch, date);
      const { fromDate } = parse(zWhiteboardCopyInput, req.body);
      if (fromDate === date) throw badRequest('Pick a different date to copy from.');
      const source = await ctx.repo.getWhiteboard(branch.id, fromDate);
      if (!source) throw notFound('There is no whiteboard on that date.');
      // Images whose metadata has expired cannot be shown again; drop them rather than fail the copy.
      const media = await loadMedia(ctx, branch.id, imageMediaIds(source));
      const blocks = copyWhiteboardBlocks(source).filter((b) => b.kind !== 'image' || media.has(b.mediaId));
      const known = new Set(media.keys());
      const wb = await ctx.repo.upsertWhiteboard(branch.id, date, (current) => {
        const nowIso = ctx.now().toISOString();
        const base = current ?? {
          ...newBoard(branch, date, caller.user.id, nowIso),
          title: source.title,
          window: { ...source.window },
          orderLabels: source.orderLabels,
        };
        return finalize({ ...base, blocks, live: 'auto', updatedAt: nowIso, updatedBy: caller.user.id }, known);
      });
      await changed(ctx, caller, wb, 'copy', `Copied whiteboard ${fromDate} to ${date}`);
      return ok(await respond(ctx, branch, wb));
    }),
  );

  router.post(
    '/branches/:b/whiteboards/:date/assignments/:itemId/done',
    staff(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const date = dateParam(req);
      const itemId = req.params.itemId!;
      const { done } = parse(zAssignmentDoneInput, req.body);
      const authorize = (wb: Whiteboard): AssignmentItem => {
        const item = findAssignment(wb, itemId);
        if (!item) throw notFound('No such assignment.');
        // The assigned person or a manager; a team item (no person) can be checked off by anyone in the branch.
        if (item.userId !== null && item.userId !== caller.user.id && !isManager(caller, branch.id)) {
          throw forbidden('Only the assigned person or a manager can check this off.');
        }
        return item;
      };
      const existing = await ctx.repo.getWhiteboard(branch.id, date);
      if (!existing) throw notFound('No whiteboard for that date.');
      authorize(existing);
      const wb = await ctx.repo.updateWhiteboard(branch.id, date, (current) => {
        authorize(current);
        return { ...mapAssignment(current, itemId, (i) => ({ ...i, done })), updatedAt: ctx.now().toISOString(), updatedBy: caller.user.id };
      });
      await changed(ctx, caller, wb, 'assignment', `${done ? 'Checked off' : 'Reopened'} a whiteboard assignment (${date})`);
      return ok(await respond(ctx, branch, wb));
    }),
  );

  router.post(
    '/branches/:b/whiteboards/:date/assignments/:itemId/task',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const date = dateParam(req);
      const itemId = req.params.itemId!;
      const { priority } = parse(zAssignmentTaskInput, req.body ?? {});
      const existing = await ctx.repo.getWhiteboard(branch.id, date);
      const item = existing ? findAssignment(existing, itemId) : null;
      if (!item) throw notFound('No such assignment.');
      if (item.taskId !== null) throw conflict('This assignment already has a task.');
      if (item.userId !== null) {
        const user = await ctx.repo.getUser(item.userId);
        if (!user || !user.active || !user.branchIds.includes(branch.id)) throw badRequest('The assigned person is no longer in this branch.');
      }

      const taskId = newId('task');
      const { whiteboard, task } = await ctx.repo.createTaskForWhiteboard(branch.id, date, (current) => {
        const target = findAssignment(current, itemId);
        if (!target) throw notFound('No such assignment.');
        if (target.taskId !== null) throw conflict('This assignment already has a task.');
        const now = ctx.now();
        const nowIso = now.toISOString();
        const task: Task = {
          id: taskId,
          scopeId: branch.id,
          scope: 'branch',
          branchId: branch.id,
          ownerUserId: null,
          boardDate: todayKey(branch.timeZone, now),
          title: target.text.slice(0, 200),
          summary: `From the ${current.date} huddle whiteboard.`,
          category: 'operations',
          categorySource: 'manual',
          priority,
          status: 'open',
          assigneeId: target.userId,
          accountId: null,
          unitId: null,
          routing: { status: 'manual', candidates: [] },
          email: null,
          deadline: null,
          staffingRequest: null,
          orderId: null,
          completedAt: null,
          completedBy: null,
          closedByReply: null,
          createdAt: nowIso,
          updatedAt: nowIso,
          createdBy: caller.user.id,
          updatedBy: caller.user.id,
        };
        const linked = mapAssignment(current, itemId, (i) => ({ ...i, taskId }));
        return { whiteboard: { ...linked, updatedAt: nowIso, updatedBy: caller.user.id }, task };
      });
      await audit(ctx, caller.user.id, { branchId: branch.id, entity: 'task', entityId: task.id, action: 'create', summary: `Created task from whiteboard: ${task.title}` });
      notify(ctx, branch.id, ['tasks']);
      await changed(ctx, caller, whiteboard, 'task', `Linked a task to a whiteboard assignment (${date})`);
      return created({ ...(await respond(ctx, branch, whiteboard)), task });
    }),
  );

  // ---------- media ----------

  router.post(
    '/branches/:b/media',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const declared = mediaType(req.headers['content-type']);
      if (!(WHITEBOARD_LIMITS.imageTypes as readonly string[]).includes(declared)) {
        throw new HttpError(415, 'bad_request', 'Upload a PNG, JPEG or WebP image.');
      }
      const raw = req.rawBody;
      if (!raw || raw.length === 0) throw badRequest('The upload is empty.');
      if (raw.length > WHITEBOARD_LIMITS.maxImageBytes) throw payloadTooLarge(`Images can be at most ${WHITEBOARD_LIMITS.maxImageBytes / (1024 * 1024)} MB.`);
      const sniffed = sniffImage(raw);
      if (sniffed.contentType !== declared) throw badRequest('The file content does not match its image type.');

      const sha256 = createHash('sha256').update(raw).digest('hex');
      const duplicate = await ctx.repo.findMediaBySha256(branch.id, sha256);
      if (duplicate) return ok(duplicate);

      const media: Media = zMedia.parse({
        id: newId('med'),
        branchId: branch.id,
        contentType: sniffed.contentType,
        bytes: raw.length,
        width: sniffed.width,
        height: sniffed.height,
        fileName: cleanFileName(req.headers[FILE_NAME_HEADER]),
        sha256,
        uploadedBy: caller.user.id,
        uploadedAt: ctx.now().toISOString(),
      });
      // Bytes first: metadata never points at an object that does not exist.
      await ctx.media.put(branch.id, media.id, raw, media.contentType);
      await ctx.repo.createMedia(media);
      await audit(ctx, caller.user.id, { branchId: branch.id, entity: 'media', entityId: media.id, action: 'media.upload', summary: `Uploaded whiteboard image ${media.fileName}` });
      return created(media);
    }),
  );

  router.get(
    '/branches/:b/media/:id',
    staff(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const media = await ctx.repo.getMedia(branch.id, req.params.id!);
      const content = media ? await ctx.media.get(branch.id, media.id) : null;
      if (!media || !content) throw notFound('No such image.');
      return bytes(content, media.contentType, { 'cache-control': 'private, max-age=3600' });
    }),
  );
}
