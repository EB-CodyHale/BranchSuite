import { accountLabel, isDayKey, LIMITS, ORDER_CLOSE_REASONS, type Order, type OrderCloseReason } from '@branchsuite/shared';
import { History, RotateCcw } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useBranchScope } from '../../app/BranchScope.js';
import { errorMessage } from '../../lib/api.js';
import { relativeAge, relativeAgeLong } from '../../lib/format.js';
import { useAddOpenings, useClosedOrders, useCloseOrder, useOrderHistory, usePauseOrder, useReopenOrder } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { Dialog, Drawer } from '../../ui/Dialog.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Select, TextField, Textarea } from '../../ui/Field.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';
import { useBoardEnv } from './BoardContext.js';
import { todayFor } from './boardModel.js';

export const CLOSE_REASON_LABELS: Record<OrderCloseReason, string> = {
  filled: 'Filled',
  cancelled: 'Cancelled by client',
  client_ended: 'Client ended the assignment',
  other: 'Other',
};

function useOrderTitle(order: Order): string {
  const { accountsById } = useBoardEnv();
  const account = accountsById.get(order.accountId);
  return `${account ? accountLabel(account, order.unitId) : 'Unknown account'} · ${order.role}${order.shift ? ` · ${order.shift}` : ''}`;
}

function FormDialog({
  title,
  description,
  submitLabel,
  tone = 'primary',
  busy,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description: ReactNode;
  submitLabel: string;
  tone?: 'primary' | 'danger';
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const formId = useId();
  return (
    <Dialog
      open
      title={title}
      description={description}
      onClose={() => !busy && onClose()}
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant={tone} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------

export function AddOpeningsDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const title = useOrderTitle(order);
  const [count, setCount] = useState('1');
  const [submitted, setSubmitted] = useState(false);
  const add = useAddOpenings();
  const { toast } = useToast();
  const room = LIMITS.maxOpeningsPerOrder - order.openings.length;
  const max = Math.min(50, room);
  const n = Number(count);
  const error = !Number.isInteger(n) || n < 1 || n > max ? (max < 1 ? 'This order already has the most lines allowed.' : `Enter a whole number from 1 to ${max}.`) : null;

  return (
    <FormDialog
      title="Add openings"
      description={title}
      submitLabel="Add openings"
      busy={add.isPending}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (error) return;
        add.mutate(
          { branchId: order.branchId, orderId: order.id, count: n },
          {
            onSuccess: () => {
              toast({ title: `Added ${n} ${n === 1 ? 'line' : 'lines'}`, tone: 'success' });
              onClose();
            },
            onError: (e) => toast({ title: 'Openings not added', description: errorMessage(e), tone: 'danger' }),
          },
        );
      }}
    >
      <TextField
        label="How many new blank lines?"
        type="number"
        inputMode="numeric"
        min="1"
        max={String(max)}
        value={count}
        autoFocus
        error={submitted ? error : undefined}
        hint={`This order has ${order.openings.length} ${order.openings.length === 1 ? 'line' : 'lines'}.`}
        onChange={(e) => setCount(e.target.value)}
        inputClassName="tabular-nums"
      />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------------------------

export function PauseDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const title = useOrderTitle(order);
  const { branchesById } = useBranchScope();
  const env = useBoardEnv();
  const pause = usePauseOrder();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [resumeOn, setResumeOn] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const today = todayFor(env.today, order.branchId, branchesById.get(order.branchId)?.timeZone);
  const dateError = resumeOn === '' ? null : !isDayKey(resumeOn) ? 'Enter a full date.' : resumeOn <= today ? 'Pick a date after today.' : null;
  const reasonError = reason.trim().length > 200 ? 'Keep the reason under 200 characters.' : null;

  return (
    <FormDialog
      title="Pause order"
      description={title}
      submitLabel="Pause order"
      busy={pause.isPending}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (dateError || reasonError) return;
        pause.mutate(
          { branchId: order.branchId, orderId: order.id, input: { reason: reason.trim(), resumeOn: resumeOn || null } },
          {
            onSuccess: () => {
              toast({ title: 'Order paused', tone: 'success' });
              onClose();
            },
            onError: (e) => toast({ title: 'Order not paused', description: errorMessage(e), tone: 'danger' }),
          },
        );
      }}
    >
      <p className="text-sm text-muted">Paused orders keep their lines and leave the wall. Staff can still see them with “Show paused”.</p>
      <TextField label="Reason" value={reason} autoFocus placeholder="Client hiring freeze" error={submitted ? reasonError : undefined} onChange={(e) => setReason(e.target.value)} />
      <TextField
        label="Resume on (optional)"
        type="date"
        value={resumeOn}
        min={today}
        error={submitted ? dateError : undefined}
        hint="The order returns to the board on this date."
        onChange={(e) => setResumeOn(e.target.value)}
      />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------------------------

export function CloseOrderDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const title = useOrderTitle(order);
  const closeOrder = useCloseOrder();
  const { toast } = useToast();
  const [reason, setReason] = useState<OrderCloseReason>('filled');
  const [note, setNote] = useState('');
  const noteError = note.trim().length > 500 ? 'Keep the note under 500 characters.' : null;

  return (
    <FormDialog
      title="Close order"
      description={title}
      submitLabel="Close order"
      tone="danger"
      busy={closeOrder.isPending}
      onClose={onClose}
      onSubmit={() => {
        if (noteError) return;
        closeOrder.mutate(
          { branchId: order.branchId, orderId: order.id, input: { reason, note: note.trim() } },
          {
            onSuccess: () => {
              toast({ title: 'Order closed', description: 'Find it under Recently closed to reopen it.', tone: 'success' });
              onClose();
            },
            onError: (e) => toast({ title: 'Order not closed', description: errorMessage(e), tone: 'danger' }),
          },
        );
      }}
    >
      <Select
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value as OrderCloseReason)}
        options={ORDER_CLOSE_REASONS.map((r) => ({ value: r, label: CLOSE_REASON_LABELS[r] }))}
      />
      <Textarea label="Note (optional)" value={note} error={noteError} onChange={(e) => setNote(e.target.value)} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------------------------

export function HistoryDrawer({ order, onClose }: { order: Order; onClose: () => void }) {
  const title = useOrderTitle(order);
  const { peopleById } = useBoardEnv();
  const history = useOrderHistory(order.branchId, order.id);
  const events = [...(history.data ?? [])].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return (
    <Drawer open onClose={onClose} title="Order history" description={title}>
      {history.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <span className="sr-only">Loading history</span>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : history.isError ? (
        <EmptyState
          title="History did not load"
          description={errorMessage(history.error)}
          action={
            <Button size="sm" onClick={() => void history.refetch()}>
              Try again
            </Button>
          }
        />
      ) : events.length === 0 ? (
        <EmptyState icon={<History />} title="No history yet" />
      ) : (
        <ol className="relative flex flex-col gap-0 border-l border-line pl-4">
          {events.map((ev) => {
            const actor = ev.actorId ? peopleById.get(ev.actorId) : undefined;
            return (
              <li key={ev.id} className="relative pb-4">
                <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 size-2.5 rounded-full border-2 border-surface bg-line-strong" />
                <p className="text-sm text-fg">{ev.summary}</p>
                <p className="text-xs text-muted">
                  {actor?.name ?? (ev.actorId ? 'Former staff member' : 'BranchSuite')} ·{' '}
                  <time dateTime={ev.at} title={new Date(ev.at).toLocaleString()}>
                    {relativeAgeLong(ev.at)}
                  </time>
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------

export function ClosedOrdersDrawer({ onClose }: { onClose: () => void }) {
  const { branchIds, branchesById } = useBranchScope();
  const { accountsById, canManage } = useBoardEnv();
  const [branchId, setBranchId] = useState(branchIds[0] ?? '');
  const closed = useClosedOrders(branchId, undefined, { enabled: branchId !== '' });
  const reopen = useReopenOrder();
  const { toast } = useToast();
  const manager = canManage(branchId);
  const orders = [...(closed.data ?? [])].sort((a, b) => ((a.close?.at ?? a.updatedAt) < (b.close?.at ?? b.updatedAt) ? 1 : -1));

  return (
    <Drawer open onClose={onClose} title="Recently closed" description="Closed orders keep their lines and history.">
      {branchIds.length > 1 ? (
        <Select
          label="Branch"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          options={branchIds.map((id) => ({ value: id, label: branchesById.get(id)?.name ?? id }))}
          className="mb-4"
        />
      ) : null}
      {closed.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <span className="sr-only">Loading closed orders</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : closed.isError ? (
        <EmptyState
          title="Closed orders did not load"
          description={errorMessage(closed.error)}
          action={
            <Button size="sm" onClick={() => void closed.refetch()}>
              Try again
            </Button>
          }
        />
      ) : orders.length === 0 ? (
        <EmptyState title="Nothing closed recently" />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {orders.map((o) => {
            const account = accountsById.get(o.accountId);
            const busy = reopen.isPending && reopen.variables?.orderId === o.id;
            return (
              <li key={o.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-semibold leading-tight">{account ? accountLabel(account, o.unitId) : 'Unknown account'}</p>
                  <p className="text-sm text-fg">
                    {o.role}
                    {o.shift ? ` · ${o.shift}` : ''} · <span className="tabular-nums">{o.openings.length}</span> {o.openings.length === 1 ? 'line' : 'lines'}
                  </p>
                  <p className="text-xs text-muted">
                    {o.close ? CLOSE_REASON_LABELS[o.close.reason] : 'Closed'}
                    {o.close?.note ? ` — ${o.close.note}` : ''}
                    {o.close ? (
                      <>
                        {' · '}
                        <time dateTime={o.close.at}>{relativeAge(o.close.at)}</time>
                      </>
                    ) : null}
                  </p>
                </div>
                {manager ? (
                  <Button
                    size="sm"
                    icon={<RotateCcw aria-hidden="true" className="size-4" />}
                    loading={busy}
                    aria-label={`Reopen ${account?.name ?? 'order'} ${o.role}`}
                    onClick={() =>
                      reopen.mutateAsync({ branchId: o.branchId, orderId: o.id }).then(
                        () => toast({ title: 'Order reopened', tone: 'success' }),
                        (e: unknown) => toast({ title: 'Order not reopened', description: errorMessage(e), tone: 'danger' }),
                      )
                    }
                  >
                    Reopen
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}

