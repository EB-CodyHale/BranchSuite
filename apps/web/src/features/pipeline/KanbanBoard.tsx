import { type Candidate, type PipelineStage } from '@branchsuite/shared';
import { ChevronsLeft, ChevronsRight, UserX } from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { readStorage, writeStorage } from '../../lib/storage.js';
import { cx } from '../../ui/cx.js';
import { CandidateCard, DRAG_TYPE } from './CandidateCard.js';
import { usePipelineActions } from './PipelineContext.js';
import { ACTIVE_STAGES, DROPPED, groupByStage, STAGE_LABEL } from './pipelineModel.js';

const DROPPED_KEY = 'bs.pipeline.droppedOpen';

export interface KanbanBoardProps {
  candidates: Candidate[];
}

/** Stage columns, sourced → started, with Dropped as a collapsible column at the end. */
export function KanbanBoard({ candidates }: KanbanBoardProps) {
  const { requestMove } = usePipelineActions();
  const groups = useMemo(() => groupByStage(candidates), [candidates]);
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [droppedOpen, setDroppedOpen] = useState(() => readStorage(DROPPED_KEY) === '1');
  const dragRef = useRef<string | null>(null);

  const toggleDropped = () =>
    setDroppedOpen((v) => {
      writeStorage(DROPPED_KEY, v ? '0' : '1');
      return !v;
    });

  const onDragStart = useCallback((id: string) => {
    dragRef.current = id;
    setDraggingId(id);
  }, []);
  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    setDraggingId(null);
  }, []);

  const dropOn = (stage: PipelineStage, e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const id = e.dataTransfer.getData(DRAG_TYPE) || dragRef.current;
    onDragEnd();
    const candidate = id ? byId.get(id) : undefined;
    if (candidate) requestMove(candidate, stage);
  };

  const dragged = draggingId ? byId.get(draggingId) : undefined;
  const columnProps = (stage: PipelineStage) => ({
    stage,
    accepting: dragged !== undefined && dragged.stage !== stage,
    onDrop: (e: DragEvent<HTMLElement>) => dropOn(stage, e),
  });

  const dropped = groups.get(DROPPED) ?? [];

  // `relative` makes the scroller the containing block for the columns' absolutely positioned sr-only
  // labels. Without it they anchor to <body>, escape the overflow clip and widen the whole page.
  return (
    <div className="relative -mx-4 overflow-x-auto px-4 pb-2 sm:-mx-5 sm:px-5 xl:mr-0 xl:pr-0" role="region" aria-label="Pipeline stages">
      <div className="flex min-h-[24rem] snap-x snap-mandatory gap-3 sm:snap-none">
        {ACTIVE_STAGES.map((s) => (
          <StageColumn key={s.id} {...columnProps(s.id)} count={groups.get(s.id)?.length ?? 0}>
            {(groups.get(s.id) ?? []).map((c) => (
              <li key={c.id}>
                <CandidateCard candidate={c} dragging={draggingId === c.id} onDragStart={onDragStart} onDragEnd={onDragEnd} />
              </li>
            ))}
          </StageColumn>
        ))}

        {droppedOpen ? (
          <StageColumn
            {...columnProps(DROPPED)}
            count={dropped.length}
            tone="dropped"
            headerAction={
              <button
                type="button"
                onClick={toggleDropped}
                aria-expanded="true"
                aria-label="Collapse Dropped column"
                title="Collapse"
                className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
              >
                <ChevronsRight aria-hidden="true" className="size-4" />
              </button>
            }
          >
            {dropped.map((c) => (
              <li key={c.id}>
                <CandidateCard candidate={c} dragging={draggingId === c.id} onDragStart={onDragStart} onDragEnd={onDragEnd} />
              </li>
            ))}
          </StageColumn>
        ) : (
          <CollapsedDropped count={dropped.length} accepting={columnProps(DROPPED).accepting} onDrop={columnProps(DROPPED).onDrop} onExpand={toggleDropped} />
        )}
      </div>
    </div>
  );
}

interface DropTargetProps {
  accepting: boolean;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

function useDropTarget({ accepting, onDrop }: DropTargetProps) {
  const [over, setOver] = useState(false);
  return {
    over: over && accepting,
    handlers: {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!accepting) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        setOver(false);
        onDrop(e);
      },
    },
  };
}

interface StageColumnProps extends DropTargetProps {
  stage: PipelineStage;
  count: number;
  tone?: 'stage' | 'dropped';
  headerAction?: ReactNode;
  children: ReactNode;
}

function StageColumn({ stage, count, tone = 'stage', headerAction, children, ...drop }: StageColumnProps) {
  const headingId = useId();
  const { over, handlers } = useDropTarget(drop);
  const empty = count === 0;
  const index = ACTIVE_STAGES.findIndex((s) => s.id === stage);
  return (
    <section
      aria-labelledby={headingId}
      data-stage={stage}
      {...handlers}
      className={cx(
        'flex w-[min(17.5rem,82vw)] shrink-0 snap-start flex-col rounded-lg border bg-surface-2/50 transition-colors',
        over ? 'border-accent bg-accent-soft/60 ring-2 ring-accent/40' : drop.accepting ? 'border-dashed border-line-strong' : 'border-line',
      )}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        {tone === 'dropped' ? (
          <UserX aria-hidden="true" className="size-4 text-muted" />
        ) : (
          <span aria-hidden="true" className="font-display text-xs font-bold text-subtle tabular-nums">
            {index + 1}
          </span>
        )}
        <h2 id={headingId} className="flex-1 font-display text-base font-bold uppercase tracking-wide">
          {STAGE_LABEL[stage]}
          <span className="sr-only">, {count} {count === 1 ? 'candidate' : 'candidates'}</span>
        </h2>
        <span aria-hidden="true" className="min-w-6 rounded-full bg-surface px-1.5 text-center font-display text-sm font-bold tabular-nums text-muted ring-1 ring-line">
          {count}
        </span>
        {headerAction}
      </header>
      <ul className="flex min-h-24 flex-1 flex-col gap-2 p-2">
        {children}
        {empty ? (
          <li aria-hidden="true" className={cx('flex flex-1 items-center justify-center rounded-md border border-dashed border-line px-2 py-6 text-center text-xs text-subtle', over && 'border-accent text-accent')}>
            {drop.accepting ? `Drop to move to ${STAGE_LABEL[stage]}` : 'No candidates'}
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function CollapsedDropped({ count, onExpand, ...drop }: DropTargetProps & { count: number; onExpand: () => void }) {
  const { over, handlers } = useDropTarget(drop);
  return (
    <div
      {...handlers}
      data-stage={DROPPED}
      className={cx(
        'flex w-12 shrink-0 flex-col items-center rounded-lg border bg-surface-2/50 transition-colors',
        over ? 'border-accent bg-accent-soft/60 ring-2 ring-accent/40' : drop.accepting ? 'border-dashed border-line-strong' : 'border-line',
      )}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-expanded="false"
        aria-label={`Show Dropped column, ${count} ${count === 1 ? 'candidate' : 'candidates'}`}
        className="flex h-full w-full flex-col items-center gap-2 rounded-lg px-1 py-2 text-muted hover:text-fg"
      >
        <ChevronsLeft aria-hidden="true" className="size-4" />
        <span aria-hidden="true" className="min-w-6 rounded-full bg-surface px-1.5 text-center font-display text-sm font-bold tabular-nums ring-1 ring-line">
          {count}
        </span>
        <span aria-hidden="true" className="font-display text-sm font-bold uppercase tracking-wider [writing-mode:vertical-rl]">
          Dropped
        </span>
      </button>
    </div>
  );
}
