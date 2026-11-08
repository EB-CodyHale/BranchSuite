import { WALL_COLORS, WALL_GLYPHS } from '@branchsuite/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { codeTextColor, WALL_COLOR_NAMES, WallGlyph } from './WallGlyph.js';

describe('WallGlyph', () => {
  it('renders every glyph as a labelled image with its shape', () => {
    for (const glyph of WALL_GLYPHS) {
      const { unmount, container } = render(<WallGlyph glyph={glyph} color="w1" />);
      const img = screen.getByRole('img', { name: `blue ${glyph}` });
      expect(img.querySelector('circle, rect, polygon')).not.toBeNull();
      expect(container.querySelector('text')).toBeNull();
      unmount();
    }
  });

  it('gives every shape a distinct outline so color is never the only cue', () => {
    const outlines = WALL_GLYPHS.map((glyph) => {
      const { container, unmount } = render(<WallGlyph glyph={glyph} color="w2" />);
      const el = container.querySelector('circle, rect, polygon')!;
      const sig = el.outerHTML;
      unmount();
      return sig.replace(/fill="[^"]*"/, '');
    });
    expect(new Set(outlines).size).toBe(WALL_GLYPHS.length);
  });

  it('includes the code in the accessible name and draws it inside the shape', () => {
    render(<WallGlyph glyph="diamond" color="w3" code="K7" />);
    const img = screen.getByRole('img', { name: 'amber diamond K7' });
    expect(img.querySelector('text')?.textContent).toBe('K7');
    expect(img.querySelector('polygon')?.getAttribute('fill')).toBe(WALL_COLORS.find((c) => c.id === 'w3')!.hex);
  });

  it('can be decorative when adjacent text names the client', () => {
    const { container } = render(<WallGlyph glyph="star" color="w4" label={null} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names every wall color and picks readable code text', () => {
    for (const c of WALL_COLORS) {
      expect(WALL_COLOR_NAMES[c.id]).toBeTruthy();
      expect(['#ffffff', '#111418']).toContain(codeTextColor(c.hex));
    }
    expect(codeTextColor('#2563eb')).toBe('#ffffff');
    expect(codeTextColor('#65a30d')).toBe('#111418');
  });
});
