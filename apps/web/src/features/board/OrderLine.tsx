import { startLabel, type Opening, type Order, type PersonLite, type StartLabelKind } from '@branchsuite/shared';
import { Check, Pencil, Plus } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { markerInkVar } from '../../app/theme.js';
import { cx } from '../../ui/cx.js';
import { useBoardEnv } from './BoardContext.js';
import { LinePopover } from './LinePopover.js';

const STATE_TEXT: Record<Opening['state'], string> = {
  open: 'open',
  tentative: 'penciled in',
  committed: 'committed',
  started: 'started',
};

const LABEL_CLASS: Record<StartLabelKind, string> = {
  overdue: 'font-semibold text-danger',
  soon: 'rounded-sm bg-warning-soft px-1 font-semibold text-warning',
  scheduled: 'text-muted',
  nodate: 'italic text-subtle',
  started: 'sr-only',
  none: 'sr-only',
};

/** CSS color for a line's initials: the WRITER's marker ink, never the viewer's; neutral ink otherwise. */
export function writerInk(line: Opening, peopleById: Map<string, PersonLite>): string | undefined {
  if (line.writtenBy === null) return undefined;
  const writer = peopleById.get(line.writtenBy);
  return writer ? `var(${markerInkVar(writer.marker)})` : undefined;
}

export function lineAccessibleName(line: Opening, index: number, label: string, writer: PersonLite | undefined, editable: boolean): string {
  const parts = [`Line ${index + 1}: ${STATE_TEXT[line.state]}`];
  if (line.initials && line.state !== 'open') parts.push(line.initials);
  if (label && line.state !== 'started') parts.push(label);
  if (line.candidateId) parts.push('pipeline candidate');
  if (writer && line.state !== 'open') parts.push(`written by ${writer.name}`);
  return parts.join(', ') + (editable ? '. Edit line' : '');
}

export interface OrderLineProps {
  order: Order;
  line: Opening;
  index: number;
  today: string;
  /** Lines on drafts and closed orders are read-only. */
  editable: boolean;
}

/** One whiteboard line. Blank underline, pencil, initials in the writer's ink, or a checked start. */
export const OrderLine = memo(function OrderLine({ order, line, index, today, editable }: OrderLineProps) {
  const { peopleById } = useBoardEnv();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const label = startLabel(line, today);
  const writer = line.writtenBy ? peopleById.get(line.writtenBy) : undefined;
  const ink = line.state === 'committed' || line.state === 'started' ? writerInk(line, peopleById) : undefined;
  const name = lineAccessibleName(line, index, label.label, writer, editable);

  const content = (
    <>
      <span className="flex min-h-6 items-end gap-1 leading-none">
        {line.state === 'open' ? (
          <Plus
            aria-hidden="true"
            className="mb-0.5 size-3.5 text-subtle opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        ) : null}
        {line.state === 'tentative' ? (
          <>
            <Pencil aria-hidden="true" className="mb-0.5 size-3.5 shrink-0 text-subtle" />
            <span className="font-display text-lg italic tracking-wide text-subtle">{line.initials}</span>
          </>
        ) : null}
        {line.state === 'committed' || line.state === 'started' ? (
          <span data-ink={ink ?? 'neutral'} className={cx('font-display text-xl font-bold tracking-wide', !ink && 'text-ink')} style={ink ? { color: ink } : undefined}>
            {line.initials}
          </span>
        ) : null}
        {line.state === 'started' ? <Check aria-hidden="true" strokeWidth={3} className="mb-0.5 size-4 shrink-0 text-success" /> : null}
      </span>
      <span className={cx('mt-0.5 min-h-4 text-[0.6875rem] leading-4 tabular-nums', LABEL_CLASS[label.kind])} aria-hidden="true">
        {label.label}
      </span>
    </>
  );

  const underline = cx(
    'flex w-full min-w-0 flex-col items-start px-1 pt-1 text-left',
    line.state === 'open' && 'border-b border-rule',
    line.state === 'tentative' && 'border-b-2 border-dashed border-subtle/60',
    line.state === 'committed' && 'border-b-2 border-ink/25',
    line.state === 'started' && 'border-b-2 border-success',
  );

  if (!editable) {
    return (
      <li data-state={line.state} className="min-w-0">
        <span role="img" aria-label={name} className={underline}>
          {content}
        </span>
      </li>
    );
  }

  return (
    <li data-state={line.state} className="min-w-0">
      <button
        ref={ref}
        type="button"
        aria-label={name}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx(underline, 'group rounded-t-sm transition-colors hover:bg-surface-2/70 focus-visible:bg-surface-2/70', open && 'bg-accent-soft')}
      >
        {content}
      </button>
      {open ? <LinePopover order={order} line={line} index={index} anchorRef={ref} onClose={() => setOpen(false)} /> : null}
    </li>
  );
});
