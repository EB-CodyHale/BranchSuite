/**
 * Morning whiteboard (huddle) mode.
 *
 * A manager prepares one whiteboard per branch per day (today or ahead). During the huddle window
 * (branch-local) — or when a manager starts it manually — every paired wall display switches from the
 * coded order board to the whiteboard (scheduled takeover). Outside the window the API never sends
 * whiteboard content to displays. Huddles happen before associates arrive, so whiteboard content may
 * show real names (decision 2026-11-08); `orderLabels: 'code'` is available per board.
 *
 * Storage: `board` container, scopeId = branchId, type 'whiteboard', id `wb_<branchId>_<date>`.
 * Images: Azure Blob Storage (private container `whiteboard-media`, managed identity); metadata doc
 * type 'media' in the board container. Served only through the API (staff session, or display token
 * while the referencing whiteboard is live). Never public URLs or SAS links.
 */
import { z } from 'zod';
import type { BoardMetrics } from './domain/orders.js';
import type { MarkerId, RoleCategory, WallColorId, WallGlyph } from './constants.js';
import { zAudited, zDayKey, zId, zIso } from './schemas.js';

export const WHITEBOARD_LIMITS = {
  maxBlocks: 12,
  maxItemsPerBlock: 20,
  maxItemText: 280,
  maxNoteText: 2000,
  maxPriorityOrders: 12,
  maxImageBytes: 8 * 1024 * 1024,
  imageTypes: ['image/png', 'image/jpeg', 'image/webp'] as const,
  mediaRetentionDays: 90,
} as const;

/** 'HH:MM' 24h, branch-local. */
export const zClock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const zTitle = z.string().trim().max(80);
const zItemText = z.string().trim().min(1).max(WHITEBOARD_LIMITS.maxItemText);

export const zTalkingPointsBlock = z.object({
  id: zId,
  kind: z.literal('talking_points'),
  title: zTitle.default('Talking points'),
  items: z.array(z.object({ id: zId, text: zItemText })).max(WHITEBOARD_LIMITS.maxItemsPerBlock),
});

export const zAssignmentsBlock = z.object({
  id: zId,
  kind: z.literal('assignments'),
  title: zTitle.default('Assignments'),
  items: z
    .array(
      z.object({
        id: zId,
        /** Roster user id; null = "anyone / team". */
        userId: zId.nullable(),
        text: zItemText,
        /** Linked inbox task when the manager chose "Also create a task". */
        taskId: zId.nullable(),
        done: z.boolean(),
      }),
    )
    .max(WHITEBOARD_LIMITS.maxItemsPerBlock),
});

export const zPriorityOrdersBlock = z.object({
  id: zId,
  kind: z.literal('priority_orders'),
  title: zTitle.default('Priority orders'),
  items: z
    .array(z.object({ orderId: zId, note: z.string().trim().max(200).default('') }))
    .max(WHITEBOARD_LIMITS.maxPriorityOrders),
});

export const zImageBlock = z.object({
  id: zId,
  kind: z.literal('image'),
  title: zTitle.default(''),
  mediaId: zId,
  caption: z.string().trim().max(200).default(''),
});

export const zNoteBlock = z.object({
  id: zId,
  kind: z.literal('note'),
  title: zTitle.default(''),
  /** Plain text; line breaks preserved; `- ` lines render as bullets. No HTML. */
  text: z.string().trim().max(WHITEBOARD_LIMITS.maxNoteText),
  tone: z.enum(['neutral', 'celebrate', 'safety', 'alert']).default('neutral'),
});

/** Live board numbers (to fill, starting soon, aging) computed at render time. */
export const zMetricsBlock = z.object({
  id: zId,
  kind: z.literal('metrics'),
  title: zTitle.default("Today's numbers"),
});

export const zWhiteboardBlock = z.discriminatedUnion('kind', [
  zTalkingPointsBlock,
  zAssignmentsBlock,
  zPriorityOrdersBlock,
  zImageBlock,
  zNoteBlock,
  zMetricsBlock,
]);
export type WhiteboardBlock = z.infer<typeof zWhiteboardBlock>;
export type WhiteboardBlockKind = WhiteboardBlock['kind'];

export const zWhiteboard = zAudited.extend({
  id: zId,
  branchId: zId,
  date: zDayKey,
  title: z.string().trim().max(100).default('Morning huddle'),
  /** Huddle window, branch-local. start < end required. */
  window: z.object({ start: zClock, end: zClock }),
  /** 'auto' = follow window; 'on' = live now until manager stops; 'off' = never live today. */
  live: z.enum(['auto', 'on', 'off']),
  orderLabels: z.enum(['name', 'code']).default('name'),
  blocks: z.array(zWhiteboardBlock).max(WHITEBOARD_LIMITS.maxBlocks),
});
export type Whiteboard = z.infer<typeof zWhiteboard>;

export const zWhiteboardUpsertInput = z.object({
  title: zWhiteboard.shape.title.optional(),
  window: zWhiteboard.shape.window.optional(),
  orderLabels: z.enum(['name', 'code']).optional(),
  /** Client supplies block/item ids (newId) so edits are stable; server validates referenced orders/users/media belong to the branch. */
  blocks: z.array(zWhiteboardBlock).max(WHITEBOARD_LIMITS.maxBlocks).optional(),
});
export type WhiteboardUpsertInput = z.infer<typeof zWhiteboardUpsertInput>;

export const zWhiteboardLiveInput = z.object({ live: z.enum(['auto', 'on', 'off']) });
/** Copy blocks from another date (e.g. yesterday) into this date's board. Assignment `done`/taskId reset. */
export const zWhiteboardCopyInput = z.object({ fromDate: zDayKey });
export const zAssignmentDoneInput = z.object({ done: z.boolean() });
/** Create an inbox task from an assignment item and link it. */
export const zAssignmentTaskInput = z.object({ priority: z.enum(['hot', 'normal', 'low']).default('normal') });

export const zMedia = z.object({
  id: zId,
  branchId: zId,
  contentType: z.enum(WHITEBOARD_LIMITS.imageTypes),
  bytes: z.number().int().positive().max(WHITEBOARD_LIMITS.maxImageBytes),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  fileName: z.string().max(200),
  sha256: z.string().length(64),
  uploadedBy: zId,
  uploadedAt: zIso,
});
export type Media = z.infer<typeof zMedia>;

// ---------- presentation (staff + wall) ----------

/** Resolved whiteboard: references expanded for display. Built by toWhiteboardView (pure). */
export interface WhiteboardView {
  date: string;
  title: string;
  window: { start: string; end: string };
  isLive: boolean;
  blocks: WhiteboardViewBlock[];
}

export type WhiteboardViewBlock =
  | { id: string; kind: 'talking_points'; title: string; items: { id: string; text: string }[] }
  | {
      id: string;
      kind: 'assignments';
      title: string;
      items: { id: string; text: string; done: boolean; person: { name: string; initials: string; marker: MarkerId } | null }[];
    }
  | {
      id: string;
      kind: 'priority_orders';
      title: string;
      items: {
        /** Account name, or wall code text when orderLabels = 'code'. */
        label: string;
        client: { code: string; color: WallColorId; glyph: WallGlyph };
        role: string;
        roleCategory: RoleCategory;
        shift: string;
        toFill: number;
        total: number;
        startingSoon: number;
        note: string;
      }[];
    }
  | { id: string; kind: 'image'; title: string; caption: string; mediaUrl: string; width: number | null; height: number | null }
  | { id: string; kind: 'note'; title: string; text: string; tone: 'neutral' | 'celebrate' | 'safety' | 'alert' }
  | { id: string; kind: 'metrics'; title: string; metrics: BoardMetrics };

/**
 * Wall feed extension: when the branch's whiteboard is live, `/api/wall/feed` returns
 * `{ ...WallFeed, mode: 'whiteboard', whiteboard: WhiteboardView }`; otherwise `mode: 'board'`
 * and no whiteboard field. mediaUrl on displays = `/api/wall/media/<id>` (display-token authed,
 * served only while the referencing whiteboard is live).
 */
export type WallMode = 'board' | 'whiteboard';

// ---------- HTTP contract ----------
/**
 * Routes (staff unless noted). :date is a branch-local day key. Managers edit; any branch member reads.
 *   GET    /branches/:b/whiteboards?from=&to=                     -> WhiteboardSummary[]  (dates that have a board, max 62-day range)
 *   GET    /branches/:b/whiteboards/:date                         -> WhiteboardResponse   (whiteboard null when none yet)
 *   PUT    /branches/:b/whiteboards/:date   WhiteboardUpsertInput -> WhiteboardResponse   (manager; creates with defaults)
 *   POST   /branches/:b/whiteboards/:date/live  WhiteboardLiveInput -> WhiteboardResponse (manager)
 *   POST   /branches/:b/whiteboards/:date/copy  WhiteboardCopyInput -> WhiteboardResponse (manager; replaces blocks)
 *   POST   /branches/:b/whiteboards/:date/assignments/:itemId/done  AssignmentDoneInput -> WhiteboardResponse
 *                                                                  (the assigned person, or a manager)
 *   POST   /branches/:b/whiteboards/:date/assignments/:itemId/task  AssignmentTaskInput -> WhiteboardResponse & { task: Task }
 *                                                                  (manager; creates a branch inbox task assigned to the item's user, links taskId)
 *   POST   /branches/:b/media      raw image body; Content-Type image/png|jpeg|webp; header x-file-name -> Media (manager; <= maxImageBytes;
 *                                  magic bytes must match Content-Type; width/height read from header bytes)
 *   GET    /branches/:b/media/:id                                 -> image bytes (staff of branch; Cache-Control private, max-age=3600)
 *   -- display token --
 *   GET    /wall/media/:id                                        -> image bytes, ONLY if the display's branch whiteboard is live now
 *                                                                    and references the media; else 404
 * Wall feed: GET /wall/feed adds mode/whiteboard (see WallFeed). Realtime entity 'whiteboard' is published to
 * scope:<b> and wall:<b> on every whiteboard change, plus at window start/end (maintenance timer every minute
 * is NOT required: displays re-evaluate by refetching at the window boundaries they receive in the view).
 * Default window for a new board: 07:30-08:15.
 */
export interface WhiteboardResponse {
  whiteboard: Whiteboard | null;
  /** Staff-resolved view (mediaUrl -> /api/branches/:b/media/:id); null when no board. */
  view: WhiteboardView | null;
}
export interface WhiteboardSummary {
  date: string;
  title: string;
  blockCount: number;
  live: Whiteboard['live'];
}
export type AssignmentDoneInput = z.infer<typeof zAssignmentDoneInput>;
export type AssignmentTaskInput = z.infer<typeof zAssignmentTaskInput>;
export type WhiteboardLiveInput = z.infer<typeof zWhiteboardLiveInput>;
export type WhiteboardCopyInput = z.infer<typeof zWhiteboardCopyInput>;

export const DEFAULT_HUDDLE_WINDOW = { start: '07:30', end: '08:15' } as const;

const enc = encodeURIComponent;
export const whiteboardPaths = {
  list: (b: string, from: string, to: string) => `/api/branches/${enc(b)}/whiteboards?from=${from}&to=${to}`,
  board: (b: string, date: string) => `/api/branches/${enc(b)}/whiteboards/${date}`,
  action: (b: string, date: string, action: 'live' | 'copy') => `/api/branches/${enc(b)}/whiteboards/${date}/${action}`,
  assignment: (b: string, date: string, itemId: string, action: 'done' | 'task') =>
    `/api/branches/${enc(b)}/whiteboards/${date}/assignments/${enc(itemId)}/${action}`,
  uploadMedia: (b: string) => `/api/branches/${enc(b)}/media`,
  media: (b: string, id: string) => `/api/branches/${enc(b)}/media/${enc(id)}`,
  wallMedia: (id: string) => `/api/wall/media/${enc(id)}`,
} as const;
