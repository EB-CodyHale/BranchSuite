import {
  accountLabel,
  DEFAULT_SHIFTS,
  LIMITS,
  ROLE_CATEGORIES,
  type Order,
  type OrderCreateInput,
  type OrderUpdateInput,
  type RoleCategory,
} from '@branchsuite/shared';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { useBranchScope } from '../../app/BranchScope.js';
import { errorMessage } from '../../lib/api.js';
import { useCreateOrder, useUpdateOrder } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Checkbox, Select, TextField, Textarea } from '../../ui/Field.js';
import { useToast } from '../../ui/Toast.js';
import { useBoardEnv } from './BoardContext.js';

export type OrderFormMode = { kind: 'create'; branchId?: string } | { kind: 'edit'; order: Order };

interface FormState {
  branchId: string;
  accountId: string;
  unitId: string;
  site: string;
  role: string;
  roleCategory: RoleCategory;
  shift: string;
  days: string;
  hours: string;
  payRate: string;
  note: string;
  isPriority: boolean;
  openingCount: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

export function validateOrderForm(f: FormState, creating: boolean): Errors {
  const e: Errors = {};
  if (!f.branchId) e.branchId = 'Choose a branch.';
  if (!f.accountId) e.accountId = 'Choose an account.';
  if (!f.role.trim()) e.role = 'Enter the role.';
  else if (f.role.trim().length > LIMITS.maxShortText) e.role = `Keep the role under ${LIMITS.maxShortText} characters.`;
  if (f.shift.trim().length > LIMITS.maxShiftText) e.shift = `Keep the shift under ${LIMITS.maxShiftText} characters.`;
  if (f.payRate.trim() !== '') {
    const rate = Number(f.payRate);
    if (!Number.isFinite(rate) || rate <= 0) e.payRate = 'Pay rate must be greater than $0.';
    else if (rate > LIMITS.maxPayRate) e.payRate = `Pay rate must be $${LIMITS.maxPayRate} or less.`;
  }
  if (f.note.length > LIMITS.maxNote) e.note = `Keep the note under ${LIMITS.maxNote} characters.`;
  if (creating) {
    const n = Number(f.openingCount);
    if (!Number.isInteger(n) || n < 1 || n > LIMITS.maxOpeningsPerOrder) e.openingCount = `Enter a whole number from 1 to ${LIMITS.maxOpeningsPerOrder}.`;
  }
  return e;
}

function initialState(mode: OrderFormMode, fallbackBranch: string): FormState {
  if (mode.kind === 'edit') {
    const o = mode.order;
    return {
      branchId: o.branchId,
      accountId: o.accountId,
      unitId: o.unitId ?? '',
      site: o.site,
      role: o.role,
      roleCategory: o.roleCategory,
      shift: o.shift,
      days: o.days,
      hours: o.hours,
      payRate: o.payRate === null ? '' : String(o.payRate),
      note: o.note,
      isPriority: o.isPriority,
      openingCount: String(o.openings.length),
    };
  }
  return {
    branchId: mode.branchId ?? fallbackBranch,
    accountId: '',
    unitId: '',
    site: '',
    role: '',
    roleCategory: 'general_labor',
    shift: '',
    days: '',
    hours: '',
    payRate: '',
    note: '',
    isPriority: false,
    openingCount: '1',
  };
}

/** Only the fields a manager actually changed, so the audit summary stays meaningful. */
export function changedFields(order: Order, f: FormState): OrderUpdateInput {
  const next: Required<OrderUpdateInput> = {
    accountId: f.accountId,
    unitId: f.unitId || null,
    site: f.site.trim(),
    role: f.role.trim(),
    roleCategory: f.roleCategory,
    shift: f.shift.trim(),
    days: f.days.trim(),
    hours: f.hours.trim(),
    payRate: f.payRate.trim() === '' ? null : Number(f.payRate),
    note: f.note.trim(),
    isPriority: f.isPriority,
  };
  const out: OrderUpdateInput = {};
  for (const key of Object.keys(next) as Array<keyof OrderUpdateInput>) {
    if (next[key] !== order[key]) (out as Record<string, unknown>)[key] = next[key];
  }
  return out;
}

export interface OrderFormDialogProps {
  mode: OrderFormMode;
  onClose: () => void;
}

export function OrderFormDialog({ mode, onClose }: OrderFormDialogProps) {
  const { accountsById, canManage } = useBoardEnv();
  const { branchIds, branchesById } = useBranchScope();
  const manageable = useMemo(() => branchIds.filter(canManage), [branchIds, canManage]);
  const creating = mode.kind === 'create';
  const [form, setForm] = useState<FormState>(() => initialState(mode, manageable[0] ?? ''));
  const [submitted, setSubmitted] = useState(false);
  const createOrder = useCreateOrder();
  const updateOrder = useUpdateOrder();
  const { toast } = useToast();
  const shiftListId = useId();
  const formId = useId();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const accounts = useMemo(
    () =>
      [...accountsById.values()]
        .filter((a) => a.branchId === form.branchId && a.reserved === null && (a.active || a.id === form.accountId))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [accountsById, form.branchId, form.accountId],
  );
  const account = accountsById.get(form.accountId);
  const units = useMemo(
    () =>
      (account?.units ?? [])
        .filter((u) => u.active || u.id === form.unitId)
        .map((u) => ({ value: u.id, label: accountLabel(account!, u.id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [account, form.unitId],
  );
  const shiftSuggestions = useMemo(() => {
    const extra = branchesById.get(form.branchId)?.settings.shiftOptions ?? [];
    return [...new Set([...DEFAULT_SHIFTS, ...extra])];
  }, [branchesById, form.branchId]);

  const errors = submitted ? validateOrderForm(form, creating) : {};
  const busy = createOrder.isPending || updateOrder.isPending;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(validateOrderForm(form, creating)).length > 0) return;
    const onError = (err: unknown) => toast({ title: creating ? 'Order not created' : 'Order not saved', description: errorMessage(err), tone: 'danger' });
    if (mode.kind === 'create') {
      const input: OrderCreateInput = {
        accountId: form.accountId,
        unitId: form.unitId || null,
        site: form.site.trim(),
        role: form.role.trim(),
        roleCategory: form.roleCategory,
        shift: form.shift.trim(),
        days: form.days.trim(),
        hours: form.hours.trim(),
        payRate: form.payRate.trim() === '' ? null : Number(form.payRate),
        note: form.note.trim(),
        isPriority: form.isPriority,
        openingCount: Number(form.openingCount),
      };
      createOrder.mutate(
        { branchId: form.branchId, input },
        {
          onSuccess: () => {
            toast({ title: 'Order created', tone: 'success' });
            onClose();
          },
          onError,
        },
      );
    } else {
      const input = changedFields(mode.order, form);
      if (Object.keys(input).length === 0) {
        onClose();
        return;
      }
      updateOrder.mutate(
        { branchId: mode.order.branchId, orderId: mode.order.id, input },
        {
          onSuccess: () => {
            toast({ title: 'Order saved', tone: 'success' });
            onClose();
          },
          onError,
        },
      );
    }
  };

  return (
    <Dialog
      open
      width="40rem"
      onClose={() => !busy && onClose()}
      closeOnBackdrop={false}
      title={creating ? 'New order' : 'Edit order'}
      description={creating ? 'Each opening becomes a blank line on the board.' : account ? accountLabel(account, form.unitId || null) : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {creating ? 'Create order' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {creating && manageable.length > 1 ? (
          <Select
            label="Branch"
            required
            value={form.branchId}
            error={errors.branchId}
            onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value, accountId: '', unitId: '' }))}
            options={manageable.map((id) => ({ value: id, label: branchesById.get(id)?.name ?? id }))}
            className="sm:col-span-2"
          />
        ) : null}
        <Select
          label="Account"
          required
          value={form.accountId}
          error={errors.accountId}
          onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value, unitId: '' }))}
          options={[{ value: '', label: accounts.length ? 'Choose an account…' : 'No accounts in this branch' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        />
        <Select
          label="Unit"
          value={form.unitId}
          disabled={!account || units.length === 0}
          onChange={(e) => set('unitId', e.target.value)}
          options={[{ value: '', label: 'Whole account' }, ...units]}
        />
        <TextField label="Role" required value={form.role} error={errors.role} onChange={(e) => set('role', e.target.value)} placeholder="Forklift operator" />
        <Select
          label="Role category"
          value={form.roleCategory}
          onChange={(e) => set('roleCategory', e.target.value as RoleCategory)}
          options={ROLE_CATEGORIES.map((r) => ({ value: r.id, label: r.label }))}
        />
        <TextField label="Site" value={form.site} onChange={(e) => set('site', e.target.value)} placeholder="Building or dock" />
        <div>
          <TextField label="Shift" list={shiftListId} value={form.shift} error={errors.shift} onChange={(e) => set('shift', e.target.value)} hint="Pick a suggestion or type your own." autoComplete="off" />
          <datalist id={shiftListId}>
            {shiftSuggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <TextField label="Days" value={form.days} onChange={(e) => set('days', e.target.value)} placeholder="M-F" />
        <TextField label="Hours" value={form.hours} onChange={(e) => set('hours', e.target.value)} placeholder="6:00a-2:30p" />
        <TextField
          label="Pay rate ($/hr)"
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={form.payRate}
          error={errors.payRate}
          onChange={(e) => set('payRate', e.target.value)}
          inputClassName="tabular-nums"
        />
        {creating ? (
          <TextField
            label="Openings"
            type="number"
            inputMode="numeric"
            min="1"
            max={String(LIMITS.maxOpeningsPerOrder)}
            required
            value={form.openingCount}
            error={errors.openingCount}
            onChange={(e) => set('openingCount', e.target.value)}
            inputClassName="tabular-nums"
          />
        ) : null}
        <Textarea label="Note" value={form.note} error={errors.note} onChange={(e) => set('note', e.target.value)} className="sm:col-span-2" hint="Shown to staff on the board. Never shown on the wall." />
        <Checkbox label="Priority" description="Priority orders sort first under Most to fill." checked={form.isPriority} onChange={(e) => set('isPriority', e.target.checked)} className="sm:col-span-2" />
      </form>
    </Dialog>
  );
}
