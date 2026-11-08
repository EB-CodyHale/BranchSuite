import type { FilteredMail } from '@branchsuite/shared';
import { ArrowUpRight, CircleCheck, MailX } from 'lucide-react';
import { relativeAge, relativeAgeLong } from '../../lib/format.js';
import { useFilteredMail, usePromoteFiltered } from '../../lib/queries.js';
import { Badge } from '../../ui/Badge.js';
import { Button } from '../../ui/Button.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';
import { useSetupBranch } from './SetupBranchContext.js';
import { ErrorNote, SectionHeader } from './setupUi.js';

const STAGE: Record<FilteredMail['stage'], string> = { prefilter: 'Rule filter', model: 'AI triage' };

/** Mail the pipeline decided was not actionable, kept 30 days so a manager can catch mistakes. */
export function FilteredMailSection() {
  const { branchId } = useSetupBranch();
  const filtered = useFilteredMail(branchId);
  const promote = usePromoteFiltered();
  const { toast } = useToast();
  const list = [...(filtered.data ?? [])].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  return (
    <div>
      <SectionHeader
        title="Filtered mail"
        branchScoped
        description="Auto-replies, newsletters and other mail that did not become a task. Promote anything that should have. Kept for 30 days."
      />
      <ErrorNote error={filtered.error} className="mb-3" />
      {filtered.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<MailX />} title="Nothing filtered" description="No mail has been set aside in the last 30 days." />
      ) : (
        <ul aria-label="Filtered messages" className="flex flex-col gap-2">
          {list.map((m) => {
            const busy = promote.isPending && promote.variables?.filteredId === m.id;
            return (
              <li key={m.id} className="rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-tight">{m.subject || '(no subject)'}</p>
                    <p className="mt-0.5 truncate text-sm text-muted">
                      {m.fromName ? `${m.fromName} · ` : ''}
                      <span className="break-all">{m.fromAddress}</span>
                    </p>
                  </div>
                  <time dateTime={m.receivedAt} title={relativeAgeLong(m.receivedAt)} className="shrink-0 text-xs font-semibold tabular-nums text-subtle">
                    {relativeAge(m.receivedAt)}
                  </time>
                </div>
                {m.excerpt ? <p className="mt-1.5 line-clamp-2 text-sm text-muted">{m.excerpt}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                  <Badge>{STAGE[m.stage]}</Badge>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="sr-only">Reason: </span>
                    {m.reason}
                  </span>
                  {m.promotedTaskId ? (
                    <Badge tone="success" icon={<CircleCheck />}>
                      Promoted
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      icon={<ArrowUpRight aria-hidden="true" className="size-4" />}
                      loading={busy}
                      aria-label={`Promote to task: ${m.subject || m.fromAddress}`}
                      onClick={() =>
                        promote.mutate(
                          { scopeId: m.scopeId, filteredId: m.id },
                          {
                            onSuccess: (task) => toast({ tone: 'success', title: 'Task created', description: task.title }),
                            onError: (e) => toast({ tone: 'danger', title: 'Could not promote', description: e.message }),
                          },
                        )
                      }
                    >
                      Promote to task
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
