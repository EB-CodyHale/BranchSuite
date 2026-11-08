import { MARKERS, type MarkerId } from '@branchsuite/shared';
import { markerInkVar } from '../app/theme.js';
import { cx } from './cx.js';

export function markerLabel(id: MarkerId): string {
  return MARKERS.find((m) => m.id === id)?.label ?? id;
}

export interface MarkerDotProps {
  marker: MarkerId;
  /** Accessible name; defaults to "<Color> marker". Pass null when adjacent text already names the person. */
  label?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'size-2.5', md: 'size-3', lg: 'size-4' } as const;

/** A recruiter's marker color. Color comes from the runtime --marker-*-ink variables (theme-aware). */
export function MarkerDot({ marker, label, size = 'md', className }: MarkerDotProps) {
  const name = label === undefined ? `${markerLabel(marker)} marker` : label;
  return (
    <span
      role={name ? 'img' : undefined}
      aria-label={name ?? undefined}
      aria-hidden={name ? undefined : true}
      className={cx('inline-block shrink-0 rounded-full ring-1 ring-black/10', SIZES[size], className)}
      style={{ backgroundColor: `var(${markerInkVar(marker)})` }}
    />
  );
}
