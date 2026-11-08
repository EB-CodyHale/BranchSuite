import type { ReactNode } from 'react';
import { cx } from '../../ui/cx.js';
import { useElementSize } from './hooks.js';
import { WALL_DESIGN_HEIGHT, WALL_DESIGN_WIDTH } from './layout.js';

/**
 * A 16:9 frame that renders its child at 1920x1080 and scales it to fit, so the staff preview
 * shows the same type scale, columns and paging a 1080p lobby TV gets.
 */
export function ScaledFrame({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const scale = size.width > 0 ? size.width / WALL_DESIGN_WIDTH : 1;
  return (
    <figure ref={ref} aria-label={label} className={cx('relative m-0 aspect-video w-full overflow-hidden rounded-lg border border-line-strong bg-bg shadow-card', className)}>
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: `${WALL_DESIGN_WIDTH}px`, height: `${WALL_DESIGN_HEIGHT}px`, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </figure>
  );
}
