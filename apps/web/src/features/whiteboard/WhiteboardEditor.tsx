import { WHITEBOARD_LIMITS, type WhiteboardBlock, type WhiteboardBlockKind } from '@branchsuite/shared';
import { ArrowDown, ArrowUp, BarChart3, ChevronDown, ClipboardList, GripVertical, ImagePlus, ListChecks, Plus, StickyNote, Star, Trash2, type LucideIcon } from 'lucide-react';
import { useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Button } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import { TextField } from '../../ui/Field.js';
import { IconButton } from '../../ui/IconButton.js';
import { Menu, MenuItem } from '../../ui/Menu.js';
import { useToast } from '../../ui/Toast.js';
import { AssignmentsEditor, MetricsEditor, NoteEditor, PriorityOrdersEditor, TalkingPointsEditor } from './BlockEditors.js';
import type { BlockOf } from './EditorContext.js';
import { ImageBlockEditor } from './ImageBlockEditor.js';
import { BLOCK_KINDS, blockKindLabel, imageFromTransfer, moveItem, newBlock, type WhiteboardDraft } from './model.js';
import { NOTE_TONES } from './WhiteboardSlide.js';

const KIND_ICONS: Record<WhiteboardBlockKind, LucideIcon> = {
  talking_points: ListChecks,
  assignments: ClipboardList,
  priority_orders: Star,
  image: ImagePlus,
  note: StickyNote,
  metrics: BarChart3,
};

const MAX_BLOCKS_MESSAGE = `A whiteboard holds up to ${WHITEBOARD_LIMITS.maxBlocks} blocks. Remove one to add another.`;

export interface WhiteboardEditorProps {
  draft: WhiteboardDraft;
  update: (fn: (d: WhiteboardDraft) => WhiteboardDraft) => void;
}

/**
 * The manager's block list: add (menu), reorder (drag handle, or Move up / Move down, or arrow keys
 * on the handle), delete with an Undo toast. Pasting a screenshot anywhere in the editor adds a
 * Graph block for it.
 */
export function WhiteboardEditor({ draft, update }: WhiteboardEditorProps) {
  const { toast } = useToast();
  const blocks = draft.blocks;
  const full = blocks.length >= WHITEBOARD_LIMITS.maxBlocks;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pasted, setPasted] = useState<{ blockId: string; file: File } | null>(null);
  const [announce, setAnnounce] = useState('');

  const setBlocks = (fn: (list: WhiteboardBlock[]) => WhiteboardBlock[]) => update((d) => ({ ...d, blocks: fn(d.blocks) }));

  const add = (kind: WhiteboardBlockKind): WhiteboardBlock | null => {
    if (full) {
      toast({ title: 'No room for another block', description: MAX_BLOCKS_MESSAGE, tone: 'danger' });
      return null;
    }
    const block = newBlock(kind);
    setBlocks((list) => [...list, block]);
    setAnnounce(`${blockKindLabel(kind)} block added at position ${blocks.length + 1}.`);
    requestAnimationFrame(() => document.getElementById(`wb-block-${block.id}`)?.focus());
    return block;
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    const label = blockKindLabel(blocks[from]!.kind);
    setBlocks((list) => moveItem(list, from, to));
    setAnnounce(`${label} moved to position ${to + 1} of ${blocks.length}.`);
  };

  const remove = (index: number) => {
    const block = blocks[index]!;
    setBlocks((list) => list.filter((b) => b.id !== block.id));
    toast({
      title: `${blockKindLabel(block.kind)} block deleted`,
      action: {
        label: 'Undo',
        onClick: () =>
          setBlocks((list) => {
            if (list.some((b) => b.id === block.id) || list.length >= WHITEBOARD_LIMITS.maxBlocks) return list;
            const next = [...list];
            next.splice(Math.min(index, next.length), 0, block);
            return next;
          }),
      },
      durationMs: 8000,
    });
  };

  const replace = (next: WhiteboardBlock) => setBlocks((list) => list.map((b) => (b.id === next.id ? next : b)));

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const file = imageFromTransfer(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    const block = add('image');
    if (block) setPasted({ blockId: block.id, file });
  };

  const onDrop = (e: DragEvent, index: number) => {
    if (!dragId) return;
    e.preventDefault();
    const from = blocks.findIndex((b) => b.id === dragId);
    setDragId(null);
    setOverId(null);
    if (from >= 0) move(from, index);
  };

  return (
    <div className="flex flex-col gap-4" onPaste={onPaste}>
      <TextField
        label="Whiteboard title"
        className="max-w-md"
        maxLength={100}
        value={draft.title}
        placeholder="Morning huddle"
        onChange={(e) => {
          const title = e.target.value;
          update((d) => ({ ...d, title }));
        }}
      />

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface px-4 py-8 text-center">
          <p className="font-display text-xl font-semibold">Nothing on this whiteboard yet</p>
          <p className="mt-1 text-sm text-muted">Add talking points, assignments, priority orders, a note, today's numbers, or paste a screenshot (Ctrl+V).</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Whiteboard blocks">
          {blocks.map((block, index) => (
            <li
              key={block.id}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                if (overId !== block.id) setOverId(block.id);
              }}
              onDrop={(e) => onDrop(e, index)}
              className={cx('rounded-lg', overId === block.id && dragId !== block.id && 'outline-2 outline-dashed outline-accent', dragId === block.id && 'wb-dragging')}
            >
              <BlockCard
                block={block}
                index={index}
                count={blocks.length}
                onMove={move}
                onRemove={() => remove(index)}
                onChange={replace}
                pastedFile={pasted?.blockId === block.id ? pasted.file : null}
                onPastedFileTaken={() => setPasted(null)}
                onDragStart={(e) => {
                  setDragId(block.id);
                  try {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', block.id);
                  } catch {
                    // Some environments expose a read-only DataTransfer; state carries the drag.
                  }
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
              />
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Menu
          label="Add block"
          placement="bottom-start"
          trigger={(props) => (
            <Button {...props} variant="primary" icon={<Plus aria-hidden="true" className="size-4" />} aria-disabled={full || undefined}>
              Add block
              <ChevronDown aria-hidden="true" className="size-4" />
            </Button>
          )}
        >
          {BLOCK_KINDS.map(({ kind, label }) => {
            const Icon = KIND_ICONS[kind];
            return (
              <MenuItem key={kind} icon={<Icon />} disabled={full} onSelect={() => add(kind)}>
                {label}
              </MenuItem>
            );
          })}
        </Menu>
        <span className="text-sm text-muted">
          {blocks.length} of {WHITEBOARD_LIMITS.maxBlocks} blocks
        </span>
        {full ? (
          <p role="status" className="text-sm font-medium text-muted">
            {MAX_BLOCKS_MESSAGE}
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface BlockCardProps {
  block: WhiteboardBlock;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  onChange: (b: WhiteboardBlock) => void;
  pastedFile: File | null;
  onPastedFileTaken: () => void;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

function BlockCard({ block, index, count, onMove, onRemove, onChange, pastedFile, onPastedFileTaken, onDragStart, onDragEnd }: BlockCardProps) {
  const label = blockKindLabel(block.kind);
  const Icon = KIND_ICONS[block.kind];
  const position = `${label}, block ${index + 1} of ${count}`;
  const tone = block.kind === 'note' ? NOTE_TONES[block.tone] : null;

  const onHandleKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onMove(index, index - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onMove(index, index + 1);
    }
  };

  return (
    <article
      id={`wb-block-${block.id}`}
      tabIndex={-1}
      aria-label={position}
      data-block-kind={block.kind}
      className={cx('flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 shadow-card focus-visible:outline-2 focus-visible:outline-focus', tone && cx('border-l-4', tone.card))}
    >
      <header className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={onHandleKey}
          aria-label={`Reorder ${label} block. Drag, or press Arrow Up or Arrow Down.`}
          title="Drag to reorder"
          className="inline-flex size-8 cursor-grab items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg active:cursor-grabbing"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </span>
        <TextField
          label={`${label} title`}
          hideLabel
          className="min-w-40 flex-1"
          maxLength={80}
          placeholder={block.kind === 'note' ? 'Title (optional)' : block.kind === 'image' ? 'Title, e.g. Fill rate by week' : label}
          value={block.title}
          onChange={(e) => onChange({ ...block, title: e.target.value })}
        />
        <span className="ml-auto flex items-center">
          <IconButton label={`Move ${label} block up`} size="sm" disabled={index === 0} onClick={() => onMove(index, index - 1)}>
            <ArrowUp />
          </IconButton>
          <IconButton label={`Move ${label} block down`} size="sm" disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>
            <ArrowDown />
          </IconButton>
          <IconButton label={`Delete ${label} block`} size="sm" onClick={onRemove} className="hover:text-danger">
            <Trash2 />
          </IconButton>
        </span>
      </header>
      <BlockBodyEditor block={block} onChange={onChange} pastedFile={pastedFile} onPastedFileTaken={onPastedFileTaken} />
    </article>
  );
}

function BlockBodyEditor({
  block,
  onChange,
  pastedFile,
  onPastedFileTaken,
}: {
  block: WhiteboardBlock;
  onChange: (b: WhiteboardBlock) => void;
  pastedFile: File | null;
  onPastedFileTaken: () => void;
}) {
  switch (block.kind) {
    case 'talking_points':
      return <TalkingPointsEditor block={block} onChange={onChange as (b: BlockOf<'talking_points'>) => void} />;
    case 'assignments':
      return <AssignmentsEditor block={block} onChange={onChange as (b: BlockOf<'assignments'>) => void} />;
    case 'priority_orders':
      return <PriorityOrdersEditor block={block} onChange={onChange as (b: BlockOf<'priority_orders'>) => void} />;
    case 'image':
      return <ImageBlockEditor block={block} onChange={onChange as (b: BlockOf<'image'>) => void} pastedFile={pastedFile} onPastedFileTaken={onPastedFileTaken} />;
    case 'note':
      return <NoteEditor block={block} onChange={onChange as (b: BlockOf<'note'>) => void} />;
    case 'metrics':
      return <MetricsEditor />;
  }
}
