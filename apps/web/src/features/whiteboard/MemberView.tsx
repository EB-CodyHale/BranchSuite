import type { Whiteboard, WhiteboardView } from '@branchsuite/shared';
import { Check } from 'lucide-react';
import { useMemo } from 'react';
import { WhiteboardBlockCard } from './WhiteboardSlide.js';

export interface MemberViewProps {
  view: WhiteboardView;
  whiteboard: Whiteboard | null;
  meId: string;
  /** Tick or untick one of the caller's own assignment items. */
  onToggleDone: (itemId: string, done: boolean) => void;
  pendingItemId: string | null;
}

/** Ids of assignment items assigned to `userId` (the view carries people, not ids). */
export function ownItemIds(wb: Whiteboard | null, userId: string): Set<string> {
  const out = new Set<string>();
  for (const b of wb?.blocks ?? []) if (b.kind === 'assignments') for (const i of b.items) if (i.userId === userId) out.add(i.id);
  return out;
}

/**
 * Read-only whiteboard for branch members: the resolved view in page-sized type. The caller's own
 * assignments are highlighted and carry a Done checkbox; everyone else's show their state only.
 */
export function MemberView({ view, whiteboard, meId, onToggleDone, pendingItemId }: MemberViewProps) {
  const own = useMemo(() => ownItemIds(whiteboard, meId), [whiteboard, meId]);
  const ownCount = own.size;
  return (
    <div className="flex flex-col gap-3">
      {ownCount > 0 ? (
        <p className="text-sm text-muted">
          You have {ownCount} {ownCount === 1 ? 'assignment' : 'assignments'} today. Tick them off when they are done.
        </p>
      ) : null}
      {view.blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong bg-surface px-4 py-8 text-center text-muted">Nothing on the whiteboard yet.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-3 text-[0.8rem]">
          {view.blocks.map((block) => (
            <li key={block.id} className="min-w-0">
              <WhiteboardBlockCard
                block={block}
                isOwnItem={(id) => own.has(id)}
                renderAssignmentControl={(item) =>
                  own.has(item.id) ? (
                    <label className="inline-flex shrink-0 items-center gap-1.5 text-[0.85em] font-semibold">
                      <input
                        type="checkbox"
                        className="size-4 accent-accent"
                        checked={item.done}
                        disabled={pendingItemId === item.id}
                        onChange={(e) => onToggleDone(item.id, e.target.checked)}
                      />
                      Done<span className="sr-only">: {item.text}</span>
                    </label>
                  ) : item.done ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2 text-[0.8em] font-bold text-success">
                      <Check aria-hidden="true" className="size-3.5" />
                      Done
                    </span>
                  ) : null
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
