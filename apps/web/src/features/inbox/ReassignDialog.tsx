import type { Branch, PersonLite, Task } from '@branchsuite/shared';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/api.js';
import { useReassignTasks } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Select } from '../../ui/Field.js';
import { useToast } from '../../ui/Toast.js';
import { branchPeople } from './inboxModel.js';

export interface ReassignDialogProps {
  /** Branches the caller manages within the current scope. */
  branches: readonly Branch[];
  people: readonly PersonLite[];
  /** Open tasks on screen, to show how many each person holds. */
  tasks: readonly Task[];
  todayFor: (branchId: string) => string;
  onClose: () => void;
}

const UNASSIGNED = '__unassigned__';

/** Manager tool: move every open task from someone who is out to a coworker (or back to the pool). */
export function ReassignDialog({ branches, people, tasks, todayFor, onClose }: ReassignDialogProps) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const reassign = useReassignTasks();
  const { toast } = useToast();
  const formId = useId();

  const today = branchId ? todayFor(branchId) : '';
  const roster = branchPeople(people, branchId);
  const openCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) if (t.status === 'open' && t.branchId === branchId && t.assigneeId) m.set(t.assigneeId, (m.get(t.assigneeId) ?? 0) + 1);
    return m;
  }, [tasks, branchId]);
  // People marked out today first, then whoever holds the most open work.
  const fromChoices = [...roster].sort((a, b) => {
    const outA = a.outDates.includes(today) ? 0 : 1;
    const outB = b.outDates.includes(today) ? 0 : 1;
    return outA - outB || (openCounts.get(b.id) ?? 0) - (openCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name);
  });
  const [fromId, setFromId] = useState(() => fromChoices[0]?.id ?? '');
  const [toId, setToId] = useState(UNASSIGNED);
  const fromPerson = roster.find((p) => p.id === fromId);
  const count = openCounts.get(fromId) ?? 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!fromId || fromId === toId) return;
    reassign.mutate(
      { branchId, fromUserId: fromId, toUserId: toId === UNASSIGNED ? null : toId },
      {
        onSuccess: ({ moved }) => {
          const to = toId === UNASSIGNED ? 'the unclaimed pool' : (roster.find((p) => p.id === toId)?.name ?? 'the new owner');
          toast({ title: moved === 0 ? 'No open tasks to move' : `Moved ${moved} ${moved === 1 ? 'task' : 'tasks'}`, description: moved > 0 ? `From ${fromPerson?.name ?? 'them'} to ${to}.` : undefined, tone: 'success' });
          onClose();
        },
      },
    );
  };

  const label = (p: PersonLite) => {
    const n = openCounts.get(p.id) ?? 0;
    return `${p.name}${p.outDates.includes(today) ? ' · out today' : ''} · ${n} open`;
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Reassign open tasks"
      description="For someone who is out: move all of their open tasks at once."
      footer={
        <>
          <Button onClick={onClose} disabled={reassign.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={reassign.isPending} disabled={!fromId || fromId === toId}>
            Reassign{count > 0 ? ` ${count}` : ''}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3">
        {reassign.isError ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {errorMessage(reassign.error)}
          </p>
        ) : null}
        {branches.length > 1 ? (
          <Select
            label="Branch"
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setFromId('');
            }}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
        ) : null}
        <Select
          label="Reassign all open tasks from"
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          options={[{ value: '', label: 'Choose a person…', disabled: true }, ...fromChoices.map((p) => ({ value: p.id, label: label(p) }))]}
        />
        <Select
          label="To"
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          options={[{ value: UNASSIGNED, label: 'Unclaimed (anyone can claim)' }, ...roster.filter((p) => p.id !== fromId).map((p) => ({ value: p.id, label: p.name }))]}
        />
      </form>
    </Dialog>
  );
}
