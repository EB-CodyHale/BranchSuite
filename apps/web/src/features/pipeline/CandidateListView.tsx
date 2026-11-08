import { PIPELINE_STAGES, type Candidate } from '@branchsuite/shared';
import { Archive, Clock } from 'lucide-react';
import { useMemo } from 'react';
import { markerInkVar } from '../../app/theme.js';
import { Badge } from '../../ui/Badge.js';
import { cx } from '../../ui/cx.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { AccountTag, CandidateAvatar, LineStatusPill, MoveMenu } from './PipelineBits.js';
import { usePipelineActions, usePipelineEnv } from './PipelineContext.js';
import { fullName, isStale, linkedLine, roleShift, stageDays, startInfo } from './pipelineModel.js';

const STAGE_ORDER = new Map(PIPELINE_STAGES.map((s, i) => [s.id, i]));

/** Table alternative to the kanban: one row per candidate. */
export function CandidateListView({ candidates }: { candidates: Candidate[] }) {
  const env = usePipelineEnv();
  const { openCandidate } = usePipelineActions();
  const rows = useMemo(
    () =>
      [...candidates].sort(
        (a, b) => (STAGE_ORDER.get(a.stage) ?? 0) - (STAGE_ORDER.get(b.stage) ?? 0) || fullName(a).localeCompare(fullName(b)),
      ),
    [candidates],
  );

  return (
    <div className="relative overflow-x-auto rounded-lg border border-line bg-paper shadow-card">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <caption className="sr-only">Candidates, {rows.length} shown</caption>
        <thead>
          <tr className="border-b border-line text-left font-display text-xs font-bold uppercase tracking-wider text-muted">
            <th scope="col" className="px-3 py-2">Name</th>
            <th scope="col" className="px-3 py-2">Stage</th>
            <th scope="col" className="px-3 py-2">Account</th>
            <th scope="col" className="px-3 py-2">Order</th>
            <th scope="col" className="px-3 py-2">Recruiter</th>
            <th scope="col" className="px-3 py-2 text-right">In stage</th>
            <th scope="col" className="px-3 py-2">Start</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const recruiter = c.recruiterId ? env.peopleById.get(c.recruiterId) : undefined;
            const account = c.accountId ? env.accountsById.get(c.accountId) : undefined;
            const link = linkedLine(c, env.ordersById);
            const days = stageDays(c);
            const stale = isStale(days) && c.stage !== 'started' && c.stage !== 'dropped';
            const start = startInfo(c.startDate, env.today);
            return (
              <tr key={c.id} className="border-b border-rule/70 last:border-b-0 hover:bg-surface-2/50">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <CandidateAvatar candidate={c} recruiter={recruiter} />
                    <button type="button" onClick={() => openCandidate(c.id)} className="font-display text-base font-bold underline-offset-2 hover:underline">
                      {fullName(c)}
                    </button>
                    {c.status === 'archived' ? (
                      <Badge icon={<Archive />}>Archived</Badge>
                    ) : null}
                  </span>
                </th>
                <td className="px-3 py-2">
                  <MoveMenu candidate={c} variant="button" />
                </td>
                <td className="max-w-48 px-3 py-2">{account ? <AccountTag account={account} /> : <span className="text-subtle">—</span>}</td>
                <td className="px-3 py-2">
                  {link ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span>{roleShift(link.order)}</span>
                      <LineStatusPill line={link.line} />
                    </span>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {recruiter ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MarkerDot marker={recruiter.marker} label={null} size="sm" />
                      <span className="font-bold" style={{ color: `var(${markerInkVar(recruiter.marker)})` }}>
                        {recruiter.initials}
                      </span>
                      <span className="text-muted">{recruiter.name}</span>
                    </span>
                  ) : (
                    <span className="italic text-subtle">Unassigned</span>
                  )}
                </td>
                <td className={cx('px-3 py-2 text-right tabular-nums', stale ? 'font-semibold text-warning' : 'text-muted')}>
                  <span className="inline-flex items-center gap-1">
                    {stale ? <Clock aria-hidden="true" className="size-3.5" /> : null}
                    {days}d{stale ? <span className="sr-only"> (stalled)</span> : null}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">{start ? start.label : <span className="text-subtle">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
