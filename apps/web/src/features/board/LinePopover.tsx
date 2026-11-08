import { isDayKey, zInitials, type Opening, type OpeningState, type OpeningUpdateInput, type Order } from '@branchsuite/shared';
import { Check, Eraser, Link2, Pencil, Trash2, UserCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../lib/api.js';
import { useRemoveOpening, useUpdateOpening } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import { Popover } from '../../ui/Popover.js';
import { Segmented } from '../../ui/Segmented.js';
import { useToast } from '../../ui/Toast.js';
import { useBoardEnv } from './BoardContext.js';
import { normalizeInitialsInput } from './boardModel.js';

type WriteState = Exclude<OpeningState, 'open'>;

const STATE_OPTIONS: ReadonlyArray<{ value: WriteState; label: string; icon: ReactNode }> = [
  { value: 'tentative', label: 'Pencil', icon: <Pencil /> },
  { value: 'committed', label: 'Committed', icon: <UserCheck /> },
  { value: 'started', label: 'Started', icon: <Check /> },
];

export const INITIALS_ERROR = 'Use 1 to 4 letters (A–Z). No digits or spaces.';

/** Returns an error message, or null when the initials are valid. */
export function validateInitials(value: string): string | null {
  return zInitials.safeParse(value).success && value.trim() === value ? null : INITIALS_ERROR;
}

export interface LinePopoverProps {
  order: Order;
  line: Opening;
  index: number;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

/**
 * Write on a line: initials, state and start date. Mirrors the API rule: a line held by a pipeline
 * candidate allows start date edits only. The write is optimistic (see useUpdateOpening).
 */
export function LinePopover({ order, line, index, anchorRef, onClose }: LinePopoverProps) {
  const { canManage, pipelineEnabled, accountsById } = useBoardEnv();
  const { toast } = useToast();
  const updateOpening = useUpdateOpening();
  const removeOpening = useRemoveOpening();
  const held = line.candidateId !== null;
  const [initials, setInitials] = useState(line.initials ?? '');
  const [state, setState] = useState<WriteState>(line.state === 'open' ? 'committed' : line.state);
  const [startDate, setStartDate] = useState(line.startDate ?? '');
  const [touched, setTouched] = useState(false);
  const initialsRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const initialsId = useId();
  const dateId = useId();

  useEffect(() => {
    (held ? dateRef : initialsRef).current?.focus();
  }, [held]);

  const initialsError = held ? null : validateInitials(initials);
  const showInitialsError = initialsError !== null && (touched || initials.length > 0);
  const dateError = startDate !== '' && !isDayKey(startDate) ? 'Enter a full date.' : null;
  const account = accountsById.get(order.accountId);
  const removable = canManage(order.branchId) && line.state === 'open' && !held && order.openings.length > 1;

  const close = () => {
    onClose();
    anchorRef.current?.focus();
  };

  // mutateAsync, not per-call callbacks: the popover closes (unmounts) right away for an optimistic
  // write, and TanStack skips per-call callbacks of an unmounted observer. The promise still settles.
  const write = (input: OpeningUpdateInput, success?: string) => {
    updateOpening.mutateAsync({ branchId: order.branchId, orderId: order.id, openingId: line.id, input }).then(
      () => {
        if (success) toast({ title: success, tone: 'success', durationMs: 2500 });
      },
      (e: unknown) => toast({ title: 'Line not saved', description: errorMessage(e), tone: 'danger' }),
    );
    close();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (initialsError || dateError) {
      if (initialsError) initialsRef.current?.focus();
      return;
    }
    const date = startDate === '' ? null : startDate;
    if (held) write({ state: line.state, startDate: date });
    else write({ state, initials, startDate: date });
  };

  const onClear = () => write({ state: 'open' }, 'Line cleared');

  const onRemove = () => {
    removeOpening.mutateAsync({ branchId: order.branchId, orderId: order.id, openingId: line.id }).then(
      () => toast({ title: 'Line removed', tone: 'success', durationMs: 2500 }),
      (e: unknown) => toast({ title: 'Line not removed', description: errorMessage(e), tone: 'danger' }),
    );
    close();
  };

  return (
    <Popover open onClose={onClose} anchorRef={anchorRef} autoFocus={false} role="dialog" aria-labelledby={titleId} className="w-[19rem] p-0">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 p-3">
        <div>
          <h3 id={titleId} className="font-display text-lg font-semibold leading-tight">
            Line {index + 1}
          </h3>
          <p className="truncate text-xs text-muted">
            {account?.name ?? 'Unknown account'} · {order.role}
            {order.shift ? ` · ${order.shift}` : ''}
          </p>
        </div>

        {held ? (
          <p className="flex items-start gap-2 rounded-md bg-accent-soft px-2.5 py-2 text-sm text-fg">
            <Link2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>
              Held by pipeline candidate —{' '}
              {pipelineEnabled ? (
                <Link to={`/pipeline?candidate=${encodeURIComponent(line.candidateId!)}`} className="font-semibold text-accent underline underline-offset-2">
                  manage in Pipeline
                </Link>
              ) : (
                'manage in Pipeline'
              )}
              . Only the start date can change here.
            </span>
          </p>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor={initialsId} className="text-sm font-semibold">
            Initials
          </label>
          <input
            ref={initialsRef}
            id={initialsId}
            value={initials}
            readOnly={held}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            aria-invalid={showInitialsError || undefined}
            aria-describedby={showInitialsError ? `${initialsId}-err` : `${initialsId}-hint`}
            onChange={(e) => setInitials(normalizeInitialsInput(e.target.value))}
            onBlur={() => setTouched(true)}
            className={cx(
              'h-11 w-full rounded-md border bg-paper px-2.5 font-display text-2xl font-bold uppercase tracking-[0.12em] text-ink',
              'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus read-only:opacity-70',
              showInitialsError ? 'border-danger' : 'border-line-strong',
            )}
          />
          {showInitialsError ? (
            <p id={`${initialsId}-err`} className="text-xs font-medium text-danger">
              {initialsError}
            </p>
          ) : (
            <p id={`${initialsId}-hint`} className="text-xs text-muted">
              Initials only — never a full name or phone number.
            </p>
          )}
        </div>

        {held ? null : <Segmented label="Line state" options={STATE_OPTIONS} value={state} onChange={setState} size="sm" className="w-full [&>button]:flex-1 [&>button]:justify-center" />}

        <div className="flex flex-col gap-1">
          <label htmlFor={dateId} className="text-sm font-semibold">
            Start date
          </label>
          <input
            ref={dateRef}
            id={dateId}
            type="date"
            value={startDate}
            aria-invalid={dateError ? true : undefined}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 tabular-nums text-fg focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
          />
          {dateError ? <p className="text-xs font-medium text-danger">{dateError}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button type="submit" variant="primary" size="sm">
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <span className="ml-auto flex gap-1">
            {line.state !== 'open' && !held ? (
              <Button size="sm" variant="ghost" icon={<Eraser aria-hidden="true" className="size-4" />} onClick={onClear}>
                Clear line
              </Button>
            ) : null}
            {removable ? (
              <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 aria-hidden="true" className="size-4" />} onClick={onRemove}>
                Remove this line
              </Button>
            ) : null}
          </span>
        </div>
      </form>
    </Popover>
  );
}
