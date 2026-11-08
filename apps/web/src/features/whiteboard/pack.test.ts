import { describe, expect, it } from 'vitest';
import { packColumns } from './pack.js';

describe('packColumns', () => {
  it('fills short columns before starting a new page (the 1080p huddle case)', () => {
    // talking points, assignments, priority orders, note, metrics, image
    const pages = packColumns([435, 300, 435, 200, 220, 640], 3, 830, 24);
    expect(pages[0]).toEqual([[0, 4], [1, 3], [2]]);
    expect(pages[1]).toEqual([[5], [], []]);
    expect(pages).toHaveLength(2);
  });

  it('keeps everything on one page when it fits', () => {
    expect(packColumns([100, 100, 100, 100], 2, 500, 10)).toEqual([[[0, 2], [1, 3]]]);
  });

  it('starts a new page for an oversized block and keeps filling beside it', () => {
    const pages = packColumns([100, 2000, 100], 2, 500, 10);
    expect(pages).toEqual([[[0], []], [[1], [2]]]);
  });

  it('returns a single empty page for no blocks and a single page when the stage is unmeasured', () => {
    expect(packColumns([], 3, 800, 10)).toEqual([[[], [], []]]);
    expect(packColumns([10, 20, 30], 2, 0, 10)).toEqual([[[0, 2], [1]]]);
  });

  it('never drops or duplicates a block', () => {
    const heights = [300, 120, 700, 90, 410, 260, 880, 50, 330];
    const flat = packColumns(heights, 3, 800, 16).flat(2).sort((a, b) => a - b);
    expect(flat).toEqual(heights.map((_, i) => i));
  });
});
