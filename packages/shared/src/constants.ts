/**
 * Single source of truth for enumerations, palettes and limits.
 * Web, API and wall all import from here. Never duplicate these values.
 */

export const ROLES = ['admin', 'manager', 'member'] as const;
export type Role = (typeof ROLES)[number];

/** Staff marker colors (whiteboard marker per recruiter). Ink/wash for light and dark surfaces. */
export const MARKERS = [
  { id: 'blue', label: 'Blue', ink: '#1f5fa8', inkDark: '#7fb6f0', wash: '#e3eefa', washDark: '#1b3350' },
  { id: 'red', label: 'Red', ink: '#b42318', inkDark: '#f59a92', wash: '#fdecea', washDark: '#4a1f1b' },
  { id: 'green', label: 'Green', ink: '#1d7a3e', inkDark: '#7fd39c', wash: '#e4f4ea', washDark: '#173d26' },
  { id: 'purple', label: 'Purple', ink: '#6a3fb5', inkDark: '#c3a8f2', wash: '#efe8fb', washDark: '#33224f' },
  { id: 'orange', label: 'Orange', ink: '#a84c0a', inkDark: '#f7b27a', wash: '#fcefe3', washDark: '#4a2c14' },
  { id: 'teal', label: 'Teal', ink: '#0f766e', inkDark: '#6fd6cc', wash: '#e1f4f2', washDark: '#143c39' },
  { id: 'pink', label: 'Pink', ink: '#b0306f', inkDark: '#f3a0c8', wash: '#fbe8f1', washDark: '#4a1d33' },
  { id: 'black', label: 'Black', ink: '#1f2328', inkDark: '#e6e8eb', wash: '#eceef0', washDark: '#2b2f35' },
  { id: 'brown', label: 'Brown', ink: '#7a4a1f', inkDark: '#d9b08a', wash: '#f4ece4', washDark: '#3d2a1a' },
  { id: 'navy', label: 'Navy', ink: '#24366b', inkDark: '#9fb1e8', wash: '#e6eaf6', washDark: '#1d2645' },
] as const;
export type MarkerId = (typeof MARKERS)[number]['id'];
export const MARKER_IDS = MARKERS.map((m) => m.id) as unknown as readonly [MarkerId, ...MarkerId[]];

/**
 * Wall coding: each account gets a code + color + glyph. These are deliberately a separate
 * palette from staff markers so a client tile is never confused with a recruiter.
 * The glyph keeps the coding readable without color (accessibility).
 */
export const WALL_COLORS = [
  { id: 'w1', hex: '#2563eb' },
  { id: 'w2', hex: '#16a34a' },
  { id: 'w3', hex: '#d97706' },
  { id: 'w4', hex: '#9333ea' },
  { id: 'w5', hex: '#dc2626' },
  { id: 'w6', hex: '#0891b2' },
  { id: 'w7', hex: '#db2777' },
  { id: 'w8', hex: '#65a30d' },
] as const;
export type WallColorId = (typeof WALL_COLORS)[number]['id'];
export const WALL_COLOR_IDS = WALL_COLORS.map((c) => c.id) as unknown as readonly [WallColorId, ...WallColorId[]];

export const WALL_GLYPHS = ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'star'] as const;
export type WallGlyph = (typeof WALL_GLYPHS)[number];

/** Alphabet for wall codes: no I, O, 0, 1, S, 5, Z, 2 to avoid misreads at distance. */
export const WALL_CODE_LETTERS = 'ABCDEFGHJKLMNPQRTUVWXY';
export const WALL_CODE_DIGITS = '346789';

export const ROLE_CATEGORIES = [
  { id: 'forklift', label: 'Forklift' },
  { id: 'reach', label: 'Reach / Stand-up' },
  { id: 'order_picker', label: 'Order picker' },
  { id: 'general_labor', label: 'General labor' },
  { id: 'machine_operator', label: 'Machine operator' },
  { id: 'production', label: 'Production / assembly' },
  { id: 'clerical', label: 'Clerical / office' },
  { id: 'driver', label: 'Driver' },
  { id: 'maintenance', label: 'Maintenance / skilled trade' },
  { id: 'other', label: 'Other' },
] as const;
export type RoleCategory = (typeof ROLE_CATEGORIES)[number]['id'];
export const ROLE_CATEGORY_IDS = ROLE_CATEGORIES.map((r) => r.id) as unknown as readonly [RoleCategory, ...RoleCategory[]];

/** Default shift suggestions. Shift is free text; branches can add their own (A/B/C, AM/PM, etc.). */
export const DEFAULT_SHIFTS = ['1st', '2nd', '3rd', 'Weekend'] as const;

export const ORDER_STATUSES = ['draft', 'active', 'paused', 'closed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_CLOSE_REASONS = ['filled', 'cancelled', 'client_ended', 'other'] as const;
export type OrderCloseReason = (typeof ORDER_CLOSE_REASONS)[number];

/**
 * Opening state.
 * open      = blank line on the whiteboard.
 * tentative = penciled in (pipeline candidate in process, not yet accepted). Still counts as "to fill".
 * committed = initials on the line; candidate accepted, not yet started.
 * started   = candidate has started.
 */
export const OPENING_STATES = ['open', 'tentative', 'committed', 'started'] as const;
export type OpeningState = (typeof OPENING_STATES)[number];

/** Candidate pipeline stages, in order. 'dropped' is the single exit stage. */
export const PIPELINE_STAGES = [
  { id: 'sourced', label: 'Sourced', opening: 'tentative' },
  { id: 'screened', label: 'Screened', opening: 'tentative' },
  { id: 'submitted', label: 'Submitted', opening: 'tentative' },
  { id: 'interviewing', label: 'Interviewing', opening: 'tentative' },
  { id: 'accepted', label: 'Offer accepted', opening: 'committed' },
  { id: 'onboarding', label: 'Onboarding', opening: 'committed' },
  { id: 'started', label: 'Started', opening: 'started' },
  { id: 'dropped', label: 'Dropped', opening: null },
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number]['id'];
export const PIPELINE_STAGE_IDS = PIPELINE_STAGES.map((s) => s.id) as unknown as readonly [PipelineStage, ...PipelineStage[]];

export const DROP_REASONS = ['candidate_withdrew', 'not_selected', 'failed_screening', 'no_show', 'unreachable', 'other'] as const;
export type DropReason = (typeof DROP_REASONS)[number];

export const TASK_CATEGORIES = [
  { id: 'client', label: 'Client communication' },
  { id: 'associate', label: 'Associate management' },
  { id: 'operations', label: 'Branch operations' },
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number]['id'];
export const TASK_CATEGORY_IDS = TASK_CATEGORIES.map((c) => c.id) as unknown as readonly [TaskCategory, ...TaskCategory[]];

export const TASK_PRIORITIES = ['hot', 'normal', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** open = active; done = completed by a person; reply_closed = completed by a detected team reply. */
export const TASK_STATUSES = ['open', 'done', 'reply_closed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const THEMES = ['daylight', 'slate', 'night'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_TIME_ZONE = 'America/Chicago';

export const LIMITS = {
  maxOpeningsPerOrder: 200,
  maxInitialsLength: 4,
  maxShortText: 200,
  maxShiftText: 100,
  maxNote: 2000,
  maxPayRate: 1000,
  maxUnitDepth: 5,
  maxEmailBodyChars: 12000,
  maxAliases: 50,
  maxDomains: 20,
  maxContactsPerAccount: 500,
  maxUnitsPerAccount: 200,
  startingSoonDays: 2,
  agingOrderDays: 7,
  wallPairingTtlSeconds: 600,
  mailReceiptTtlSeconds: 60 * 60 * 24 * 120,
  filteredMailTtlSeconds: 60 * 60 * 24 * 30,
  auditTtlSeconds: 60 * 60 * 24 * 400,
} as const;

/** Default pay bands for wall "band" mode: a rate below `min` of the next band falls in the previous band. */
export const DEFAULT_PAY_BANDS = [
  { min: 0, label: '$' },
  { min: 18, label: '$$' },
  { min: 22, label: '$$$' },
] as const;
