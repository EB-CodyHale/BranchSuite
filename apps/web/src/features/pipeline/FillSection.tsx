import { openingCounts, scheduleText, startLabel, type Candidate, type Order } from '@branchsuite/shared';
import { ChevronDown, Link2Off, Pencil, Star } from 'lucide-react';
import { useId, useState } from 'react';
import { errorMessage } from '../../lib/api.js';
import { useLinkCandidate, useUnlinkCandidate } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import { Checkbox } from '../../ui/Field.js';
import { useToast } from '../../ui/Toast.js';
import { AccountTag, LineStatusPill } from './PipelineBits.js';
import { usePipelineEnv } from './PipelineContext.js';
import { fillableOrders, fullName, linkedLine, openLines, roleShift } from './pipelineModel.js';

/** Tentative fill: the line this candidate holds, or a picker to pencil them onto an open line. */
export function FillSection({ candidate }: { candidate: Candidate }) {
  const env = usePipelineEnv();
  const link = linkedLine(candidate, env.ordersById);
  const unlink = useUnlinkCandidate();
  const { toast } = useToast();
  const headingId = useId();

  const release = async () => {
    try {
      await unlink.mutateAsync({ branchId: candidate.branchId, candidateId: candidate.id });
      toast({ title: 'Line released', description: `${fullName(candidate)} is no longer penciled onto that order.`, tone: 'success' });
    } catch (e) {
      toast({ title: 'Line not released', description: errorMessage(e), tone: 'danger' });
    }
  };

  let body;
  if (link) {
    const account = env.accountsById.get(link.order.accountId);
    const schedule = scheduleText(link.order);
    const label = env.today ? startLabel(link.line, env.today).label : '';
    body = (
      <div className="rounded-md border border-rule bg-paper p-3 text-ink shadow-card">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {account ? <AccountTag account={account} className="font-display text-base font-bold" /> : null}
            <p className="text-sm font-medium">{roleShift(link.order)}</p>
            {schedule ? <p className="text-xs text-muted">{schedule}</p> : null}
          </div>
          <LineStatusPill line={link.line} />
        </div>
        <p className="mt-2 flex flex-wrap gap-x-3 text-xs tabular-nums text-muted">
          <span>
            Line {link.index + 1} of {link.order.openings.length}
          </span>
          <span>{openingCounts(link.order).toFill} to fill on this order</span>
          {label ? <span>{label}</span> : null}
          {link.order.status === 'paused' ? <span className="font-semibold text-warning">Order paused</span> : null}
        </p>
        {candidate.status === 'active' ? (
          <Button size="sm" className="mt-3" icon={<Link2Off aria-hidden="true" className="size-4" />} onClick={() => void release()} loading={unlink.isPending}>
            Unlink
          </Button>
        ) : null}
      </div>
    );
  } else if (candidate.orderId) {
    body = (
      <div className="flex flex-col items-start gap-2 text-sm text-muted">
        <p>The linked order is no longer on the board (it may have closed).</p>
        {candidate.status === 'active' ? (
          <Button size="sm" icon={<Link2Off aria-hidden="true" className="size-4" />} onClick={() => void release()} loading={unlink.isPending}>
            Clear link
          </Button>
        ) : null}
      </div>
    );
  } else if (candidate.status === 'archived') {
    body = <p className="text-sm text-muted">Archived candidates cannot hold a line.</p>;
  } else if (candidate.stage === 'dropped') {
    body = <p className="text-sm text-muted">Move them back to an active stage to pencil them onto an opening.</p>;
  } else {
    body = <FillPicker candidate={candidate} />;
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="font-display text-sm font-bold uppercase tracking-wider text-muted">
        Tentative fill
      </h3>
      {body}
    </section>
  );
}

function FillPicker({ candidate }: { candidate: Candidate }) {
  const env = usePipelineEnv();
  const link = useLinkCandidate();
  const { toast } = useToast();
  const [onlyAccount, setOnlyAccount] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const account = candidate.accountId ? env.accountsById.get(candidate.accountId) : undefined;
  const orders = fillableOrders(env.orders, candidate.branchId, account && onlyAccount ? account.id : null);

  const fill = async (order: Order, openingId: string, lineNo: number) => {
    try {
      await link.mutateAsync({ branchId: candidate.branchId, candidateId: candidate.id, input: { orderId: order.id, openingId } });
      toast({ title: `${fullName(candidate)} penciled in`, description: `${roleShift(order)}, line ${lineNo}.`, tone: 'success' });
    } catch (e) {
      toast({ title: 'Opening not filled', description: errorMessage(e), tone: 'danger' });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">Fill an opening: pencil {candidate.firstName} onto an open line. The board shows it as tentative.</p>
      {account ? (
        <Checkbox label={`Only ${account.name} orders`} checked={onlyAccount} onChange={(e) => setOnlyAccount(e.target.checked)} />
      ) : null}
      {orders.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm text-subtle">
          {account && onlyAccount ? `No ${account.name} orders have an open line.` : 'No orders in this branch have an open line.'}
        </p>
      ) : (
        <ul aria-label="Orders with open lines" className="flex flex-col gap-1.5">
          {orders.map((order) => {
            const acct = env.accountsById.get(order.accountId);
            const lines = openLines(order);
            const counts = openingCounts(order);
            const isOpen = expanded === order.id;
            const panelId = `fill-${order.id}`;
            return (
              <li key={order.id} className="rounded-md border border-line bg-surface">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setExpanded(isOpen ? null : order.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {acct ? <AccountTag account={acct} /> : <span>Unknown account</span>}
                      {order.isPriority ? (
                        <>
                          <Star aria-hidden="true" className="size-3.5 shrink-0 fill-current text-warning" />
                          <span className="sr-only">Priority</span>
                        </>
                      ) : null}
                    </span>
                    <span className="block truncate text-sm">{roleShift(order)}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted">
                    <span className="block font-display text-base font-bold text-fg">{counts.toFill} to fill</span>
                    {lines.length} open {lines.length === 1 ? 'line' : 'lines'}
                  </span>
                  <ChevronDown aria-hidden="true" className={cx('size-4 shrink-0 text-muted transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen ? (
                  <div id={panelId} className="flex flex-wrap gap-1.5 border-t border-line px-2.5 py-2">
                    {lines.map(({ line, index }) => (
                      <Button
                        key={line.id}
                        size="sm"
                        icon={<Pencil aria-hidden="true" className="size-3.5" />}
                        aria-label={`Pencil ${fullName(candidate)} onto line ${index + 1} of ${roleShift(order)}`}
                        disabled={link.isPending}
                        onClick={() => void fill(order, line.id, index + 1)}
                      >
                        Line {index + 1}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
