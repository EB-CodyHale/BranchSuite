import {
  accountLabel,
  DEFAULT_SHIFTS,
  LIMITS,
  ROLE_CATEGORIES,
  type AccountLite,
  type RoleCategory,
  type Task,
  type TaskOrderInput,
} from '@branchsuite/shared';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../lib/api.js';
import { useCreateOrderFromTask } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Select, TextField, Textarea } from '../../ui/Field.js';
import { useToast } from '../../ui/Toast.js';
import { boardOrderHref } from './inboxModel.js';

export interface OrderFormState {
  accountId: string;
  unitId: string;
  role: string;
  roleCategory: RoleCategory;
  shift: string;
  days: string;
  hours: string;
  payRate: string;
  openingCount: string;
  note: string;
}

type Errors = Partial<Record<keyof OrderFormState, string>>;

/** Prefill from the task's extracted staffing request and its (or its only candidate's) account. */
export function orderPrefill(task: Pick<Task, 'title' | 'accountId' | 'unitId' | 'routing' | 'staffingRequest'>): OrderFormState {
  const sr = task.staffingRequest;
  const only = task.routing.candidates.length === 1 ? task.routing.candidates[0] : undefined;
  const accountId = task.accountId ?? only?.accountId ?? '';
  const unitId = task.accountId ? (task.unitId ?? '') : (only?.unitId ?? '');
  return {
    accountId,
    unitId,
    role: sr?.role || task.title,
    roleCategory: sr?.roleCategory ?? 'other',
    shift: sr?.shift ?? '',
    days: sr?.days ?? '',
    hours: sr?.hours ?? '',
    payRate: sr?.payRate != null ? String(sr.payRate) : '',
    openingCount: sr?.headcount != null ? String(sr.headcount) : '',
    note: sr?.notes ?? '',
  };
}

export function validateOrder(f: OrderFormState): Errors {
  const e: Errors = {};
  if (!f.accountId) e.accountId = 'Choose the account this order is for.';
  if (!f.role.trim()) e.role = 'Enter the role.';
  else if (f.role.trim().length > LIMITS.maxShortText) e.role = `Keep the role under ${LIMITS.maxShortText} characters.`;
  if (f.shift.trim().length > LIMITS.maxShiftText) e.shift = `Keep the shift under ${LIMITS.maxShiftText} characters.`;
  if (f.payRate.trim() !== '') {
    const rate = Number(f.payRate);
    if (!Number.isFinite(rate) || rate <= 0) e.payRate = 'Pay rate must be greater than $0.';
    else if (rate > LIMITS.maxPayRate) e.payRate = `Pay rate must be $${LIMITS.maxPayRate} or less.`;
  }
  const n = Number(f.openingCount);
  if (f.openingCount.trim() === '' || !Number.isInteger(n) || n < 1 || n > LIMITS.maxOpeningsPerOrder) {
    e.openingCount = `Enter a whole number from 1 to ${LIMITS.maxOpeningsPerOrder}.`;
  }
  if (f.note.length > LIMITS.maxNote) e.note = `Keep the note under ${LIMITS.maxNote} characters.`;
  return e;
}

export function toOrderInput(f: OrderFormState): TaskOrderInput {
  return {
    accountId: f.accountId,
    unitId: f.unitId || null,
    role: f.role.trim(),
    roleCategory: f.roleCategory,
    shift: f.shift.trim(),
    days: f.days.trim(),
    hours: f.hours.trim(),
    payRate: f.payRate.trim() === '' ? null : Number(f.payRate),
    openingCount: Number(f.openingCount),
    note: f.note.trim(),
  };
}

export interface CreateOrderDialogProps {
  task: Task;
  /** Accounts of the task's branch. */
  accounts: readonly AccountLite[];
  shiftOptions?: readonly string[];
  onClose: () => void;
}

/** Manager confirms the fields extracted from a staffing-request email, then creates the order. */
export function CreateOrderDialog({ task, accounts, shiftOptions = [], onClose }: CreateOrderDialogProps) {
  const [form, setForm] = useState<OrderFormState>(() => orderPrefill(task));
  const [errors, setErrors] = useState<Errors>({});
  const create = useCreateOrderFromTask();
  const { toast } = useToast();
  const navigate = useNavigate();
  const formId = useId();
  const shiftListId = useId();
  const sr = task.staffingRequest;

  const choices = useMemo(
    () => accounts.filter((a) => a.branchId === task.branchId && a.active && a.reserved === null).sort((a, b) => a.name.localeCompare(b.name)),
    [accounts, task.branchId],
  );
  const account = choices.find((a) => a.id === form.accountId);
  const units = (account?.units ?? []).filter((u) => u.active);
  const candidateIds = new Set(task.routing.candidates.map((c) => c.accountId));

  const set = <K extends keyof OrderFormState>(key: K, value: OrderFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value, ...(key === 'accountId' ? { unitId: '' } : {}) }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateOrder(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    create.mutate(
      { scopeId: task.scopeId, taskId: task.id, input: toOrderInput(form) },
      {
        onSuccess: ({ order }) => {
          toast({
            title: 'Order created',
            description: `${order.role} · ${order.openings.length} ${order.openings.length === 1 ? 'opening' : 'openings'} added to the board.`,
            tone: 'success',
            action: { label: 'View on board', onClick: () => navigate(boardOrderHref(order.id)) },
          });
          onClose();
        },
      },
    );
  };

  const shifts = [...new Set([...DEFAULT_SHIFTS, ...shiftOptions])];

  return (
    <Dialog
      open
      width="40rem"
      onClose={onClose}
      closeOnBackdrop={false}
      title="Create order from email"
      description="Check the details pulled from the email before the order goes on the board."
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={create.isPending}>
            Create order
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
        {sr?.blockedReason ? (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning sm:col-span-2">
            <span className="font-semibold">Not created automatically:</span> {sr.blockedReason}
          </p>
        ) : null}
        <Select
          label="Account"
          required
          value={form.accountId}
          onChange={(e) => set('accountId', e.target.value)}
          error={errors.accountId}
          options={[
            { value: '', label: 'Choose an account…' },
            ...choices.map((a) => ({ value: a.id, label: candidateIds.has(a.id) ? `${a.name} (suggested)` : a.name })),
          ]}
        />
        <Select
          label="Unit"
          value={form.unitId}
          onChange={(e) => set('unitId', e.target.value)}
          disabled={units.length === 0}
          hint={units.length === 0 ? 'This account has no units.' : undefined}
          options={[
            { value: '', label: 'Whole account' },
            ...(account ? units.map((u) => ({ value: u.id, label: accountLabel(account, u.id).split(' › ').slice(1).join(' › ') })) : []),
          ]}
        />
        <TextField label="Role" required value={form.role} onChange={(e) => set('role', e.target.value)} error={errors.role} maxLength={LIMITS.maxShortText} />
        <Select
          label="Role category"
          value={form.roleCategory}
          onChange={(e) => set('roleCategory', e.target.value as RoleCategory)}
          options={ROLE_CATEGORIES.map((r) => ({ value: r.id, label: r.label }))}
        />
        <TextField label="Shift" value={form.shift} onChange={(e) => set('shift', e.target.value)} error={errors.shift} list={shiftListId} />
        <datalist id={shiftListId}>
          {shifts.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <TextField label="Days" value={form.days} onChange={(e) => set('days', e.target.value)} placeholder="M-F" />
        <TextField label="Hours" value={form.hours} onChange={(e) => set('hours', e.target.value)} placeholder="6a-2:30p" />
        <TextField
          label="Pay rate ($/hr)"
          inputMode="decimal"
          value={form.payRate}
          onChange={(e) => set('payRate', e.target.value)}
          error={errors.payRate}
          inputClassName="tabular-nums"
        />
        <TextField
          label="Openings"
          required
          inputMode="numeric"
          value={form.openingCount}
          onChange={(e) => set('openingCount', e.target.value)}
          error={errors.openingCount}
          hint={sr && sr.headcount === null && sr.headcountText ? `The email said “${sr.headcountText}”. Confirm a number.` : undefined}
          inputClassName="tabular-nums"
        />
        <Textarea label="Note" className="sm:col-span-2" value={form.note} onChange={(e) => set('note', e.target.value)} error={errors.note} rows={3} />
      </form>
    </Dialog>
  );
}
