import { TASK_CATEGORIES, TASK_PRIORITIES, type AccountLite, type Branch, type PersonLite, type TaskCategory, type TaskCreateInput, type TaskPriority } from '@branchsuite/shared';
import { useId, useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/api.js';
import { useCreateTask } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Select, TextField, Textarea } from '../../ui/Field.js';
import { useToast } from '../../ui/Toast.js';
import { branchPeople, PRIORITY_LABEL } from './inboxModel.js';

export interface AddTaskDialogProps {
  /** Branches the task may go to (the selected scope). */
  branches: readonly Branch[];
  accounts: readonly AccountLite[];
  people: readonly PersonLite[];
  viewerId: string;
  onClose: () => void;
}

/** Manual task for today's board of the selected branch. */
export function AddTaskDialog({ branches, accounts, people, viewerId, onClose }: AddTaskDialogProps) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [category, setCategory] = useState<TaskCategory | ''>('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>();
  const create = useCreateTask();
  const { toast } = useToast();
  const formId = useId();

  const owners = branchPeople(people, branchId);
  const branchAccounts = accounts.filter((a) => a.branchId === branchId && a.active).sort((a, b) => a.name.localeCompare(b.name));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError('Give the task a short title.');
      return;
    }
    const input: TaskCreateInput = {
      title: title.trim(),
      summary: summary.trim() || undefined,
      category: category || undefined,
      priority,
      assigneeId: assigneeId || null,
      accountId: accountId || null,
    };
    create.mutate(
      { branchId, input },
      {
        onSuccess: (task) => {
          toast({ title: 'Task added', description: task.title, tone: 'success' });
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title="Add task"
      description="Adds a task to today’s board."
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={create.isPending}>
            Add task
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {create.isError ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger sm:col-span-2">
            {errorMessage(create.error)}
          </p>
        ) : null}
        {branches.length > 1 ? (
          <Select
            label="Branch"
            className="sm:col-span-2"
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setAssigneeId('');
              setAccountId('');
            }}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
        ) : null}
        <TextField
          label="Title"
          required
          className="sm:col-span-2"
          value={title}
          maxLength={200}
          error={titleError}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleError(undefined);
          }}
        />
        <Textarea label="Summary" className="sm:col-span-2" value={summary} maxLength={2000} onChange={(e) => setSummary(e.target.value)} rows={3} />
        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value as TaskCategory | '')}
          hint={category === '' ? 'Chosen from the title and summary.' : undefined}
          options={[{ value: '', label: 'Automatic' }, ...TASK_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]}
        />
        <Select
          label="Priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
        />
        <Select
          label="Assignee"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          options={[{ value: '', label: 'Unclaimed' }, ...owners.map((p) => ({ value: p.id, label: p.id === viewerId ? `${p.name} (you)` : p.name }))]}
        />
        <Select
          label="Account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          options={[{ value: '', label: 'No account' }, ...branchAccounts.map((a) => ({ value: a.id, label: a.name }))]}
        />
      </form>
    </Dialog>
  );
}
