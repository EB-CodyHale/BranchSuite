/**
 * Column (masonry) packing for whiteboard pages.
 *
 * Blocks keep their order. Each block goes into the shortest column of the current page that still has
 * room; when no column can take it, a new page starts. A block taller than the stage gets a page to
 * itself. This fills a TV screen far better than row-by-row paging, where one tall block pushes a
 * whole row (and every short block in it) to the next page.
 *
 * Returns pages -> columns -> block indices.
 */
export function packColumns(heights: readonly number[], columns: number, available: number, gap: number): number[][][] {
  const cols = Math.max(1, Math.floor(columns));
  const emptyPage = (): { items: number[][]; used: number[] } => ({
    items: Array.from({ length: cols }, () => []),
    used: Array.from({ length: cols }, () => 0),
  });
  if (heights.length === 0) return [emptyPage().items];
  if (available <= 0) {
    const page = emptyPage();
    heights.forEach((_, i) => page.items[i % cols]!.push(i));
    return [page.items];
  }

  const pages: number[][][] = [];
  let page = emptyPage();
  let pageHasItems = false;

  heights.forEach((h, i) => {
    const place = (): boolean => {
      // Shortest column first; ties go to the leftmost column so reading order stays natural.
      const order = page.used.map((u, c) => [u, c] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [used, c] of order) {
        const needed = page.items[c]!.length === 0 ? h : used + gap + h;
        if (needed <= available) {
          page.items[c]!.push(i);
          page.used[c] = needed;
          return true;
        }
      }
      return false;
    };
    if (place()) {
      pageHasItems = true;
      return;
    }
    if (pageHasItems) {
      pages.push(page.items);
      page = emptyPage();
    }
    // Fits on a fresh page, or is oversized: it gets the first column of a new page either way.
    if (!place()) {
      page.items[0]!.push(i);
      page.used[0] = h;
    }
    pageHasItems = true;
  });
  pages.push(page.items);
  return pages;
}
