import { type PipelineStage } from '@branchsuite/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/api.js';
import { useCreateCandidate } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Select, TextField, Textarea } from '../../ui/Field.js';
import { useToast } from '../../ui/Toast.js';
import { emptyForm, editForm, validateForm, type CandidateFormState, type FormErrors } from './candidateForm.js';
import { usePipelineEnv } from './PipelineContext.js';
import { ACTIVE_STAGES } from './pipelineModel.js';

export interface AddCandidateDialogProps {
  onClose: () => void;
  /** Called with the new candidate's id (e.g. to open their drawer). */
  onCreated?: (candidateId: string) => void;
  /** Preselected account, e.g. from the active account filter. */
  defaultAccountId?: string;
}

const STAGE_OPTIONS = ACTIVE_STAGES.map((s) => ({ value: s.id, label: s.label }));

export function AddCandidateDialog({ onClose, onCreated, defaultAccountId }: AddCandidateDialogProps) {
  const env = usePipelineEnv();
  const create = useCreateCandidate();
  const { toast } = useToast();
  const formId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const meInBranch = env.recruiters.some((p) => p.id === env.viewerId);
  const [form, setForm] = useState<CandidateFormState>(() => emptyForm(meInBranch ? env.viewerId : '', defaultAccountId ?? ''));
  const [stage, setStage] = useState<PipelineStage>('sourced');
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const set = (patch: Partial<CandidateFormState>) => {
    setForm((f) => editForm(f, patch));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch) as Array<keyof CandidateFormState>) delete next[k];
      return next;
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateForm(form, 'create');
    setErrors(found);
    if (Object.keys(found).length > 0) {
      if (found.firstName) firstRef.current?.focus();
      return;
    }
    setServerError(null);
    try {
      const candidate = await create.mutateAsync({
        branchId: env.branchId,
        input: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim().toLowerCase() || undefined,
          recruiterId: form.recruiterId || null,
          accountId: form.accountId || null,
          stage,
          notes: form.notes.trim() || undefined,
        },
      });
      toast({ title: `${candidate.firstName} ${candidate.lastName}`.trim() + ' added', description: `In ${ACTIVE_STAGES.find((s) => s.id === stage)?.label}.`, tone: 'success' });
      onCreated?.(candidate.id);
      onClose();
    } catch (err) {
      setServerError(errorMessage(err));
    }
  };

  const recruiterOptions = [{ value: '', label: 'Unassigned' }, ...env.recruiters.map((p) => ({ value: p.id, label: p.id === env.viewerId ? `${p.name} (me)` : p.name }))];
  const accountOptions = [{ value: '', label: 'No account yet' }, ...env.accounts.map((a) => ({ value: a.id, label: a.name }))];

  return (
    <Dialog
      open
      onClose={() => !create.isPending && onClose()}
      closeOnBackdrop={false}
      title="Add candidate"
      description="Board initials come from the name; candidates appear on the board only once penciled onto a line."
      initialFocusRef={firstRef}
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={create.isPending}>
            Add candidate
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField ref={firstRef} label="First name" required autoComplete="off" maxLength={60} value={form.firstName} error={errors.firstName} onChange={(e) => set({ firstName: e.target.value })} />
        <TextField label="Last name" autoComplete="off" maxLength={60} value={form.lastName} error={errors.lastName} onChange={(e) => set({ lastName: e.target.value })} hint={form.initials ? `Board initials: ${form.initials}` : undefined} />
        <TextField label="Phone" type="tel" autoComplete="off" maxLength={30} value={form.phone} error={errors.phone} onChange={(e) => set({ phone: e.target.value })} />
        <TextField label="Email" type="email" autoComplete="off" maxLength={254} value={form.email} error={errors.email} onChange={(e) => set({ email: e.target.value })} />
        <Select label="Account" value={form.accountId} options={accountOptions} onChange={(e) => set({ accountId: e.target.value })} />
        <Select label="Recruiter" value={form.recruiterId} options={recruiterOptions} onChange={(e) => set({ recruiterId: e.target.value })} />
        <Select label="Stage" value={stage} options={STAGE_OPTIONS} onChange={(e) => setStage(e.target.value as PipelineStage)} className="sm:col-span-2" />
        <Textarea label="Notes" maxLength={2000} value={form.notes} error={errors.notes} onChange={(e) => set({ notes: e.target.value })} className="sm:col-span-2" />
        {serverError ? (
          <p role="alert" className="text-sm font-medium text-danger sm:col-span-2">
            {serverError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
