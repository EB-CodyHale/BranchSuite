import { WALL_COLORS, type WallColorId, type WallGlyph as WallGlyphShape } from '@branchsuite/shared';
import { cx } from './cx.js';

/** Spoken names for the wall palette (WALL_COLORS carries only hex values). */
export const WALL_COLOR_NAMES: Record<WallColorId, string> = {
  w1: 'blue',
  w2: 'green',
  w3: 'amber',
  w4: 'purple',
  w5: 'red',
  w6: 'cyan',
  w7: 'pink',
  w8: 'lime',
};

/** Shapes drawn in a 100x100 box. Each is distinct in silhouette so coding never relies on color. */
const SHAPES: Record<WallGlyphShape, { el: 'circle' | 'rect' | 'polygon'; attrs: Record<string, string | number>; textY: number }> = {
  circle: { el: 'circle', attrs: { cx: 50, cy: 50, r: 46 }, textY: 50 },
  square: { el: 'rect', attrs: { x: 6, y: 6, width: 88, height: 88, rx: 10 }, textY: 50 },
  triangle: { el: 'polygon', attrs: { points: '50,4 97,92 3,92' }, textY: 64 },
  diamond: { el: 'polygon', attrs: { points: '50,2 98,50 50,98 2,50' }, textY: 50 },
  hexagon: { el: 'polygon', attrs: { points: '27,6 73,6 96,50 73,94 27,94 4,50' }, textY: 50 },
  star: { el: 'polygon', attrs: { points: '50,3 62,36 97,37 69,58 79,93 50,72 21,93 31,58 3,37 38,36' }, textY: 56 },
};

function hexOf(color: WallColorId): string {
  return WALL_COLORS.find((c) => c.id === color)?.hex ?? '#666666';
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** White or near-black code text, whichever contrasts more with the fill. */
export function codeTextColor(fillHex: string): string {
  const l = luminance(fillHex);
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / (0.0069 + 0.05)) ? '#ffffff' : '#111418';
}

export function wallCodeLabel(glyph: WallGlyphShape, color: WallColorId, code?: string | null): string {
  return [`${WALL_COLOR_NAMES[color]} ${glyph}`, code ? code : null].filter(Boolean).join(' ');
}

export interface WallGlyphProps {
  glyph: WallGlyphShape;
  color: WallColorId;
  /** Client wall code drawn inside the shape (e.g. "K7"). */
  code?: string | null;
  /** Pixel size or CSS length. Defaults to 1em so it scales with text. */
  size?: number | string;
  /** Accessible name override; null marks it decorative (adjacent text already says it). */
  label?: string | null;
  className?: string;
}

export function WallGlyph({ glyph, color, code, size = '1em', label, className }: WallGlyphProps) {
  const shape = SHAPES[glyph];
  const fill = hexOf(color);
  const name = label === undefined ? wallCodeLabel(glyph, color, code) : label;
  const Shape = shape.el;
  const fontSize = code && code.length > 2 ? 30 : 38;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={name ? 'img' : undefined}
      aria-label={name ?? undefined}
      aria-hidden={name ? undefined : true}
      focusable="false"
      className={cx('inline-block shrink-0 align-middle', className)}
    >
      <Shape {...shape.attrs} fill={fill} stroke="rgb(0 0 0 / 0.18)" strokeWidth={2} strokeLinejoin="round" />
      {code ? (
        <text
          x={50}
          y={shape.textY}
          textAnchor="middle"
          dominantBaseline="central"
          fill={codeTextColor(fill)}
          fontFamily="'Barlow Condensed', 'Barlow', sans-serif"
          fontWeight={700}
          fontSize={fontSize}
          aria-hidden="true"
        >
          {code}
        </text>
      ) : null}
    </svg>
  );
}
