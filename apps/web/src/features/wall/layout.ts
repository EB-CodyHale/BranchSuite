/**
 * Pure layout math for the wall board: type scale, column count, paging and burn-in shift.
 * Kept free of React and the DOM so every rule is unit-testable with plain numbers.
 */

/** The staff preview renders the board at this virtual size and scales it down (1080p TV). */
export const WALL_DESIGN_WIDTH = 1920;
export const WALL_DESIGN_HEIGHT = 1080;

/** Most openings drawn as symbols on one tile; the rest collapse into "+N more". */
export const MAX_SYMBOLS = 24;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Root font size in px for a board of the given size. 20px at 1920x1080, 40px at 3840x2160 (when a
 * 4K browser reports device pixels), never below 14px so phones and small previews stay legible.
 */
export function wallFontPx(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 16;
  return Math.round(clamp(Math.min(width / 96, height / 52), 14, 44) * 10) / 10;
}

/**
 * Minimum tile width: clamp(320px, 22vw, 560px), with the upper bound raised in step with the type
 * scale so a 4K screen at device-pixel resolution does not cram six narrow columns of large type.
 */
export function tileMinWidthPx(boardWidth: number, fontPx: number): number {
  return clamp(0.22 * boardWidth, 320, Math.max(560, 21 * fontPx));
}

/** Gap between tiles, proportional to the type scale. */
export function gapPx(fontPx: number): number {
  return Math.round(fontPx * 0.8);
}

/** How many tile columns fit in `stageWidth` (always at least 1). */
export function columnsFor(stageWidth: number, minTile: number, gap: number): number {
  if (stageWidth <= 0) return 1;
  return Math.max(1, Math.floor((stageWidth + gap) / (minTile + gap)));
}

/** Width of one column when `columns` share `stageWidth`. */
export function columnWidth(stageWidth: number, columns: number, gap: number): number {
  return Math.max(0, (stageWidth - gap * (columns - 1)) / columns);
}

/**
 * Split tiles into pages that fit `available` px of height without scrolling.
 * Tiles flow left to right in rows of `columns`; a row is as tall as its tallest tile. A row that is
 * taller than the whole stage still gets a page of its own (it is clipped rather than lost).
 * Returns tile indices per page, in feed order. With no tiles there is one empty page.
 */
export function paginate(heights: readonly number[], columns: number, available: number, gap: number): number[][] {
  if (heights.length === 0) return [[]];
  const cols = Math.max(1, Math.floor(columns));
  if (available <= 0) return [heights.map((_, i) => i)];
  const pages: number[][] = [];
  let page: number[] = [];
  let used = 0;
  for (let start = 0; start < heights.length; start += cols) {
    const row = heights.slice(start, start + cols);
    const rowHeight = Math.max(...row);
    const needed = page.length === 0 ? rowHeight : used + gap + rowHeight;
    if (page.length > 0 && needed > available) {
      pages.push(page);
      page = [];
      used = rowHeight;
    } else {
      used = needed;
    }
    for (let i = 0; i < row.length; i++) page.push(start + i);
  }
  pages.push(page);
  return pages;
}

/** Keep the current page when it still exists after a re-pagination; otherwise go back to the first. */
export function clampPage(index: number, pageCount: number): number {
  return index >= 0 && index < pageCount ? index : 0;
}

/**
 * Burn-in mitigation: the whole layout drifts around a 2px orbit, one step per page cycle (or every
 * few minutes on a single page). Static edges and headers never sit on the same pixels for hours.
 */
const ORBIT: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 1],
  [2, 0],
  [1, -1],
  [0, -2],
  [-1, -1],
  [-2, 0],
  [-1, 1],
];

export function burnInOffset(step: number): { x: number; y: number } {
  const [x, y] = ORBIT[((step % ORBIT.length) + ORBIT.length) % ORBIT.length]!;
  return { x, y };
}
