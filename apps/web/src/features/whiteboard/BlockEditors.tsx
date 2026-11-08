import { newId, openingCounts, WHITEBOARD_LIMITS } from '@branchsuite/shared';
import { ArrowDown, ArrowUp, Check, Link2, ListPlus, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import { Select, Textarea, TextField } from '../../ui/Field.js';
import { IconButton } from '../../ui/IconButton.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { Segmented } from '../../ui/Segmented.js';
import { WallGlyph } from '../../ui/WallGlyph.js';
import { shiftText } from '../wall/WallTile.js';
import { useEditorEnv, type BlockEditorProps, type BlockOf } from './EditorContext.js';
import { moveItem, newAssignment } from './model.js';
import { NOTE_TONES } from './WhiteboardSlide.js';

const L = WHITEBOARD_LIMITS;

function LimitNote({ count, max, noun }: { count: number; max: number; noun: string }) {
  if (count < max) return null;
  return (
    <p role="status" className="text-xs font-medium text-muted">
      This block holds up to {max} {noun}. Start another block for more.
    </p>
  );
}

/** Characters left, shown only near the limit. */
export function CharsLeft({ value, max, id }: { value: string; max: number; id?: string }) {
  const left = max - value.length;
  if (left > Math.max(20, max * 0.1)) return null;
  return (
    <span id={id} className={cx('text-xs tabular-nums', left < 0 ? 'font-semibold text-danger' : 'text-muted')} aria-live="polite">
      {left < 0 ? `${-left} over the limit` : `${left} left`}
    </span>
  );
}

/** Up / down / remove buttons for one list row. */
function RowControls({ index, count, noun, onMove, onRemove }: { index: number; count: number; noun: string; onMove: (to: number) => void; onRemove: () => void }) {
  return (
    <span className="flex shrink-0 items-center">
      <IconButton label={`Move ${noun} up`} size="sm" disabled={index === 0} onClick={() => onMove(index - 1)}>
        <ArrowUp />
      </IconButton>
      <IconButton label={`Move ${noun} down`} size="sm" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
        <ArrowDown />
      </IconButton>
      <IconButton label={`Remove ${noun}`} size="sm" onClick={onRemove}>
        <X />
      </IconButton>
    </span>
  );
}

/** Focus a row input after React has rendered it (Enter adds the next item and moves there). */
function useFocusAfterRender() {
  const refs = useRef(new Map<string, HTMLInputElement>());
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    refs.current.get(pending)?.focus();
    setPending(null);
  });
  const register = (id: string) => (el: HTMLInputElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };
  return { register, focus: setPending };
}

// =====================================================================================
// talking points
// =====================================================================================

export function TalkingPointsEditor({ block, onChange }: BlockEditorProps<'talking_points'>) {
  const { register, focus } = useFocusAfterRender();
  const items = block.items;
  const full = items.length >= L.maxItemsPerBlock;
  const set = (next: BlockOf<'talking_points'>['items']) => onChange({ ...block, items: next });

  const insertAfter = (index: number) => {
    if (full) return;
    const item = { id: newId('wbi'), text: '' };
    const next = [...items];
    next.splice(index + 1, 0, item);
    set(next);
    focus(item.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      insertAfter(index);
    } else if (e.key === 'Backspace' && items[index]!.text === '' && items.length > 1) {
      e.preventDefault();
      const prev = items[Math.max(0, index - 1)]!;
      set(items.filter((_, i) => i !== index));
      if (prev.id !== items[index]!.id) focus(prev.id);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={item.id} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-5 shrink-0 text-right font-display text-sm font-bold tabular-nums text-muted">
              {i + 1}
            </span>
            <input
              ref={register(item.id)}
              value={item.text}
              maxLength={L.maxItemText}
              placeholder={i === 0 ? 'e.g. Welcome back, Jordan' : 'Next point'}
              aria-label={`Talking point ${i + 1}`}
              onChange={(e) => set(items.map((x) => (x.id === item.id ? { ...x, text: e.target.value } : x)))}
              onKeyDown={(e) => onKeyDown(e, i)}
              className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-[0.9375rem] focus-visible:outline-2 focus-visible:outline-focus"
            />
            <RowControls index={i} count={items.length} noun={`talking point ${i + 1}`} onMove={(to) => set(moveItem(items, i, to))} onRemove={() => set(items.filter((x) => x.id !== item.id))} />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" icon={<Plus aria-hidden="true" className="size-4" />} disabled={full} onClick={() => insertAfter(items.length - 1)}>
          Add point
        </Button>
        <span className="text-xs text-muted">Press Enter to add the next point.</span>
      </div>
      <LimitNote count={items.length} max={L.maxItemsPerBlock} noun="points" />
    </div>
  );
}

// =====================================================================================
// assignments
// =====================================================================================

export function AssignmentsEditor({ block, onChange }: BlockEditorProps<'assignments'>) {
  const env = useEditorEnv();
  const { register, focus } = useFocusAfterRender();
  const items = block.items;
  const full = items.length >= L.maxItemsPerBlock;
  const set = (next: BlockOf<'assignments'>['items']) => onChange({ ...block, items: next });
  const patch = (id: string, p: Partial<BlockOf<'assignments'>['items'][number]>) => set(items.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const peopleById = new Map(env.people.map((p) => [p.id, p]));
  const options = [{ value: '', label: 'Team (anyone)' }, ...env.people.map((p) => ({ value: p.id, label: p.name }))];

  const add = (after: number) => {
    if (full) return;
    const item = newAssignment();
    const next = [...items];
    next.splice(after + 1, 0, item);
    set(next);
    focus(item.id);
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => {
          const person = item.userId ? peopleById.get(item.userId) : undefined;
          const n = i + 1;
          return (
            <li key={item.id} className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-2/60 p-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-1.5 sm:w-48 sm:shrink-0">
                {person ? <MarkerDot marker={person.marker} label={null} /> : <span aria-hidden="true" className="size-3 rounded-full border border-dashed border-line-strong" />}
                <Select
                  label={`Person for assignment ${n}`}
                  hideLabel
                  className="min-w-0 flex-1"
                  value={item.userId ?? ''}
                  options={item.userId && !person ? [...options, { value: item.userId, label: 'Former team member' }] : options}
                  onChange={(e) => patch(item.id, { userId: e.target.value || null })}
                />
              </div>
              <input
                ref={register(item.id)}
                value={item.text}
                maxLength={L.maxItemText}
                placeholder="What needs doing"
                aria-label={`Assignment ${n}`}
                onChange={(e) => patch(item.id, { text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    add(i);
                  }
                }}
                className={cx(
                  'h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-[0.9375rem] focus-visible:outline-2 focus-visible:outline-focus',
                  item.done && 'text-muted line-through',
                )}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-sm font-semibold">
                  <input type="checkbox" className="size-4 accent-accent" checked={item.done} onChange={(e) => patch(item.id, { done: e.target.checked })} />
                  Done<span className="sr-only"> (assignment {n})</span>
                </label>
                {item.taskId ? (
                  <Link to="/inbox" className="inline-flex h-8 items-center gap-1 rounded-md bg-success-soft px-2 text-sm font-semibold text-success hover:underline">
                    <Check aria-hidden="true" className="size-4" />
                    Task created<span className="sr-only"> for assignment {n}, open the inbox</span>
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Link2 aria-hidden="true" className="size-4" />}
                    disabled={item.text.trim() === ''}
                    loading={env.creatingTaskFor === item.id}
                    onClick={() => void env.createTask(item.id)}
                    aria-label={`Create inbox task for assignment ${n}`}
                  >
                    Create inbox task
                  </Button>
                )}
                <RowControls index={i} count={items.length} noun={`assignment ${n}`} onMove={(to) => set(moveItem(items, i, to))} onRemove={() => set(items.filter((x) => x.id !== item.id))} />
              </div>
            </li>
          );
        })}
      </ul>
      <div>
        <Button size="sm" variant="ghost" icon={<Plus aria-hidden="true" className="size-4" />} disabled={full} onClick={() => add(items.length - 1)}>
          Add assignment
        </Button>
      </div>
      <LimitNote count={items.length} max={L.maxItemsPerBlock} noun="assignments" />
    </div>
  );
}

// =====================================================================================
// priority orders
// =====================================================================================

export function PriorityOrdersEditor({ block, onChange }: BlockEditorProps<'priority_orders'>) {
  const env = useEditorEnv();
  const items = block.items;
  const full = items.length >= L.maxPriorityOrders;
  const set = (next: BlockOf<'priority_orders'>['items']) => onChange({ ...block, items: next });
  const chosen = new Set(items.map((i) => i.orderId));
  const describe = (orderId: string) => {
    const o = env.ordersById.get(orderId);
    if (!o) return null;
    const account = env.accountsById.get(o.accountId);
    return { order: o, account, counts: openingCounts(o) };
  };
  const available = env.orders.filter((o) => !chosen.has(o.id));
  const pickOptions = [
    { value: '', label: available.length ? 'Add an order…' : 'No more open orders' },
    ...available.map((o) => {
      const account = env.accountsById.get(o.accountId)?.name ?? 'Unknown account';
      return { value: o.id, label: `${account} — ${o.role} · ${shiftText(o.shift)} · ${openingCounts(o).toFill} to fill` };
    }),
  ];

  return (
    <div className="flex flex-col gap-2">
      <Segmented<'name' | 'code'>
        label="Order labels on the whiteboard"
        size="sm"
        value={env.orderLabels}
        onChange={env.setOrderLabels}
        options={[
          { value: 'name', label: 'Account names' },
          { value: 'code', label: 'Wall codes' },
        ]}
      />
      {items.length === 0 ? <p className="text-sm text-muted">Pick the orders the team should push today.</p> : null}
      <ol className="flex flex-col gap-2">
        {items.map((item, i) => {
          const d = describe(item.orderId);
          const name = d ? (d.account?.name ?? 'Unknown account') : 'Order no longer open';
          return (
            <li key={item.orderId} className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-2/60 p-2">
              <div className="flex items-start gap-2">
                {d?.account ? <WallGlyph glyph={d.account.wall.glyph} color={d.account.wall.color} code={d.account.wall.code} size="1.75rem" /> : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{name}</p>
                  {d ? (
                    <p className="text-sm text-muted">
                      {[d.order.role, shiftText(d.order.shift)].filter(Boolean).join(' · ')} · <span className="font-semibold text-fg">{d.counts.toFill} to fill</span>
                    </p>
                  ) : (
                    <p className="text-sm text-muted">It was closed or moved; it is left off the whiteboard.</p>
                  )}
                </div>
                <RowControls index={i} count={items.length} noun={`priority order ${i + 1}`} onMove={(to) => set(moveItem(items, i, to))} onRemove={() => set(items.filter((x) => x.orderId !== item.orderId))} />
              </div>
              <TextField
                label={`Note for ${name}`}
                hideLabel
                placeholder="Optional note, e.g. Client visit Thursday"
                maxLength={200}
                value={item.note}
                onChange={(e) => set(items.map((x) => (x.orderId === item.orderId ? { ...x, note: e.target.value } : x)))}
              />
            </li>
          );
        })}
      </ol>
      <Select
        label="Add a priority order"
        hideLabel
        value=""
        disabled={full || available.length === 0}
        options={pickOptions}
        onChange={(e) => {
          if (e.target.value) set([...items, { orderId: e.target.value, note: '' }]);
        }}
      />
      <LimitNote count={items.length} max={L.maxPriorityOrders} noun="orders" />
    </div>
  );
}

// =====================================================================================
// note + metrics
// =====================================================================================

const TONE_KEYS = Object.keys(NOTE_TONES) as Array<keyof typeof NOTE_TONES>;

export function NoteEditor({ block, onChange }: BlockEditorProps<'note'>) {
  return (
    <div className="flex flex-col gap-2">
      <Segmented<BlockOf<'note'>['tone']>
        label="Tone"
        size="sm"
        value={block.tone}
        onChange={(tone) => onChange({ ...block, tone })}
        options={TONE_KEYS.map((t) => {
          const { Icon, label, icon } = NOTE_TONES[t];
          return { value: t, label, icon: <Icon aria-hidden="true" className={cx('size-4', icon)} /> };
        })}
      />
      <Textarea
        label="Note"
        hideLabel
        rows={4}
        placeholder={'Plain text. Start a line with "- " for a bullet.'}
        value={block.text}
        maxLength={L.maxNoteText}
        hint={<>Start a line with “- ” for a bullet. <CharsLeft value={block.text} max={L.maxNoteText} /></>}
        onChange={(e) => onChange({ ...block, text: e.target.value })}
      />
    </div>
  );
}

export function MetricsEditor() {
  return (
    <p className="flex items-start gap-2 text-sm text-muted">
      <ListPlus aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      Shows live counts from the board when the whiteboard is shown: openings to fill, open orders, pending, starting soon and aging orders. Nothing to set up.
    </p>
  );
}
