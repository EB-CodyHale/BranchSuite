import { describe, expect, it } from 'vitest';
import { burnInOffset, clampPage, columnsFor, columnWidth, gapPx, paginate, tileMinWidthPx, wallFontPx } from './layout.js';

describe('wall type scale and columns', () => {
  it('scales the root font with the screen and clamps it', () => {
    expect(wallFontPx(1920, 1080)).toBe(20);
    expect(wallFontPx(3840, 2160)).toBe(40);
    expect(wallFontPx(320, 640)).toBe(14);
    expect(wallFontPx(0, 0)).toBe(16);
  });

  it('targets tiles of clamp(320px, 22vw, 560px)', () => {
    expect(tileMinWidthPx(1920, 20)).toBeCloseTo(422.4);
    expect(tileMinWidthPx(1000, 14)).toBe(320);
    expect(tileMinWidthPx(2560, 25)).toBe(560);
  });

  it('fits four columns on a 1080p TV and one on a phone', () => {
    const gap = gapPx(20);
    expect(columnsFor(1872, tileMinWidthPx(1920, 20), gap)).toBe(4);
    expect(columnsFor(288, tileMinWidthPx(320, 14), gapPx(14))).toBe(1);
    expect(columnsFor(0, 400, 16)).toBe(1);
    expect(columnWidth(1000, 2, 20)).toBe(490);
  });
});

describe('paginate', () => {
  it('packs rows (tallest tile per row) until the height is used up', () => {
    // rows: [0,1]=120, [2,3]=90, [4,5]=200  → 120+10+90 = 220 fits, +10+200 = 430 does not.
    expect(paginate([100, 120, 80, 90, 200, 50], 2, 350, 10)).toEqual([
      [0, 1, 2, 3],
      [4, 5],
    ]);
  });

  it('keeps everything on one page when it fits', () => {
    expect(paginate([100, 100, 100], 3, 120, 10)).toEqual([[0, 1, 2]]);
  });

  it('gives an over-tall row its own page instead of dropping it', () => {
    expect(paginate([50, 900, 50], 1, 300, 10)).toEqual([[0], [1], [2]]);
  });

  it('handles an empty board and an unmeasured stage', () => {
    expect(paginate([], 3, 500, 10)).toEqual([[]]);
    expect(paginate([10, 20], 2, 0, 10)).toEqual([[0, 1]]);
  });

  it('keeps the current page when it still exists', () => {
    expect(clampPage(1, 3)).toBe(1);
    expect(clampPage(3, 3)).toBe(0);
    expect(clampPage(-1, 2)).toBe(0);
  });
});

describe('burn-in drift', () => {
  it('never moves more than 2px and cycles', () => {
    for (let i = 0; i < 20; i++) {
      const { x, y } = burnInOffset(i);
      expect(Math.abs(x)).toBeLessThanOrEqual(2);
      expect(Math.abs(y)).toBeLessThanOrEqual(2);
    }
    expect(burnInOffset(0)).toEqual(burnInOffset(8));
    expect(burnInOffset(1)).not.toEqual(burnInOffset(0));
  });
});
