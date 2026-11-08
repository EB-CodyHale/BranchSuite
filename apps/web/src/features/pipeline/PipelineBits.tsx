import { PIPELINE_STAGES, type AccountLite, type Candidate, type Opening, type PersonLite, type PipelineStage } from '@branchsuite/shared';
import { ArrowRightLeft, Check, ChevronDown, Pencil, UserX } from 'lucide-react';
import { markerInkVar, markerWashVar } from '../../app/theme.js';
import { Badge } from '../../ui/Badge.js';
import { cx } from '../../ui/cx.js';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu.js';
import { WallGlyph } from '../../ui/WallGlyph.js';
import { usePipelineActions } from './PipelineContext.js';
import { fullName, LINE_STATUS_LABEL, STAGE_LABEL } from './pipelineModel.js';

/** Candidate initials in the recruiter's marker ink (neutral ink when nobody is assigned). */
export function CandidateAvatar({ candidate, recruiter, size = 'md' }: { candidate: Pick<Candidate, 'initials'>; recruiter: PersonLite | undefined; size?: 'md' | 'lg' }) {
  const style = recruiter
    ? { color: `var(${markerInkVar(recruiter.marker)})`, backgroundColor: `var(${markerWashVar(recruiter.marker)})`, borderColor: `var(${markerInkVar(recruiter.marker)})` }
    : undefined;
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full border-[1.5px] font-display font-bold leading-none tracking-wide',
        !recruiter && 'border-line-strong bg-surface-2 text-muted',
        size === 'md' ? 'size-9 text-[0.95rem]' : 'size-12 text-xl',
      )}
      style={style}
    >
      {candidate.initials}
    </span>
  );
}

const PILL_TONE = { tentative: 'neutral', committed: 'accent', started: 'success' } as const;
const PILL_ICON = { tentative: <Pencil />, committed: null, started: <Check strokeWidth={3} /> } as const;

/** The state of the line a candidate holds: Pencil / Committed / Started. */
export function LineStatusPill({ line, className }: { line: Opening; className?: string }) {
  if (line.state === 'open') return null;
  return (
    <Badge tone={PILL_TONE[line.state]} icon={PILL_ICON[line.state] ?? undefined} className={className}>
      <span className="sr-only">Line status: </span>
      {LINE_STATUS_LABEL[line.state]}
    </Badge>
  );
}

/** Account wall glyph + name. */
export function AccountTag({ account, className }: { account: AccountLite; className?: string }) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5', className)}>
      <WallGlyph glyph={account.wall.glyph} color={account.wall.color} size={14} label={null} />
      <span className="truncate">{account.name}</span>
    </span>
  );
}

/** Keyboard/touch alternative to drag and drop: "Move to…" menu with every other stage. */
export function MoveMenu({ candidate, variant = 'icon', className }: { candidate: Candidate; variant?: 'icon' | 'button'; className?: string }) {
  const { requestMove, movingIds } = usePipelineActions();
  const disabled = candidate.status === 'archived' || movingIds.has(candidate.id);
  const name = fullName(candidate);
  const stages = PIPELINE_STAGES.filter((s) => s.id !== candidate.stage && s.id !== 'dropped');
  return (
    <Menu
      label={`Move ${name} to`}
      placement="bottom-end"
      trigger={(props) =>
        variant === 'icon' ? (
          <button
            {...props}
            type="button"
            disabled={disabled}
            aria-label={`Move ${name} to…`}
            title="Move to…"
            className={cx(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50',
              className,
            )}
          >
            <ArrowRightLeft aria-hidden="true" className="size-4" />
          </button>
        ) : (
          <button
            {...props}
            type="button"
            disabled={disabled}
            aria-label={`Stage: ${STAGE_LABEL[candidate.stage]}. Move ${name} to…`}
            className={cx(
              'inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50',
              className,
            )}
          >
            {STAGE_LABEL[candidate.stage]}
            <ChevronDown aria-hidden="true" className="size-4 text-muted" />
          </button>
        )
      }
    >
      {stages.map((s) => (
        <MenuItem key={s.id} onSelect={() => requestMove(candidate, s.id as PipelineStage)}>
          {s.label}
        </MenuItem>
      ))}
      {candidate.stage !== 'dropped' ? (
        <>
          <MenuSeparator />
          <MenuItem tone="danger" icon={<UserX />} onSelect={() => requestMove(candidate, 'dropped')}>
            Dropped…
          </MenuItem>
        </>
      ) : null}
    </Menu>
  );
}
