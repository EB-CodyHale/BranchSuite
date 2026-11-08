/**
 * Theme application. The three staff themes are CSS token sets keyed by <html data-theme>.
 * Marker colors come from MARKERS in @branchsuite/shared and are written as CSS variables here,
 * so the palette is defined exactly once. Dark surfaces use each marker's dark ink and wash.
 */
import { MARKERS, THEMES, type MarkerId, type Theme } from '@branchsuite/shared';
import { readStorage, writeStorage } from '../lib/storage.js';

export type Tone = 'light' | 'dark';

export const THEME_OPTIONS: ReadonlyArray<{ id: Theme; label: string; tone: Tone }> = [
  { id: 'daylight', label: 'Daylight', tone: 'light' },
  { id: 'slate', label: 'Soft Slate', tone: 'light' },
  { id: 'night', label: 'Night', tone: 'dark' },
];

const THEME_KEY = 'bs.theme';

export function toneOf(theme: Theme): Tone {
  return THEME_OPTIONS.find((t) => t.id === theme)?.tone ?? 'light';
}

export function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v);
}

export const markerInkVar = (id: MarkerId) => `--marker-${id}-ink`;
export const markerWashVar = (id: MarkerId) => `--marker-${id}-wash`;

/** CSS custom properties for every marker in the given tone. Also used by the wall's own light/dark theme. */
export function markerVars(tone: Tone): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of MARKERS) {
    vars[markerInkVar(m.id)] = tone === 'dark' ? m.inkDark : m.ink;
    vars[markerWashVar(m.id)] = tone === 'dark' ? m.washDark : m.wash;
  }
  return vars;
}

/**
 * Props for a nested element that renders in a different theme than the page (wall previews, frames).
 * applyTheme writes marker inks inline on <html> only, so a nested data-theme also needs its own marker
 * variables or it would keep the page's inks. Spread onto the element: <div {...themeScope('night')}>.
 */
export function themeScope(theme: Theme): { 'data-theme': Theme; style: Record<string, string> } {
  return { 'data-theme': theme, style: markerVars(toneOf(theme)) };
}

export function applyMarkerVars(el: HTMLElement, tone: Tone): void {
  for (const [name, value] of Object.entries(markerVars(tone))) el.style.setProperty(name, value);
}

/** Apply a theme to the document and remember it for the next page load. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
  applyMarkerVars(root, toneOf(theme));
  writeStorage(THEME_KEY, theme);
}

/** Theme to paint before the user's preferences load. */
export function storedTheme(): Theme {
  const v = readStorage(THEME_KEY);
  if (isTheme(v)) return v;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'daylight';
}
