import { type Candidate } from '@branchsuite/shared';
import { Archive, RotateCcw } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/api.js';
import { relativeAgeLong } from '../../lib/format.js';
import { Badge } from '../../ui/Badge.js';
import { Button } from '../../ui/Button.js';
import { ConfirmDialog } from '../../ui/ConfirmDialog.js';
import { Drawer } from '../../ui/Dialog.js';
import { Select, TextField, Textarea } from '../../ui/Field.js';
import { useToast } from '../../ui/Toast.js';
import { diffForm, editForm, formFromCandidate, validateForm, type CandidateFormState, type FormErrors } from './candidateForm.js';
import { FillSection } from './FillSection.js';
import { CandidateAvatar, MoveMenu } from './PipelineBits.js';
import { usePipelineEnv } from './PipelineContext.js';
import { useArchive, useSaveCandidate } from './pipelineHooks.js';
import { DROP_REASON_LABEL, fullName, isStale, STAGE_LABEL, stageDays } from './pipelineModel.js';

export function CandidateDrawer({ candidate, onClose }: { candidate: Candidate; onClose: () => void }) {
  const env = usePipelineEnv();
  const save = useSaveCandidate();
  const archive = useArchive();
  const { toast } = useToast();
  const formId = useId();
  const [form, setForm] = useState<CandidateFormState>(() => formFromCandidate(candidate));
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archived = candidate.status === 'archived';
  const recruiter = candidate.recruiterId ? env.peopleById.get(candidate.recruiterId) : undefined;
  const days = stageDays(candidate);
  const changes = diffForm(candidate, form);
  const dirty = Object.keys(changes).length > 0;

  // A server update (another recruiter, realtime) resets a clean form to the new values.
  const [seen, setSeen] = useState(candidate.updatedAt);
  useEffect(() => {
    if (candidate.updatedAt !== seen) {
      setSeen(candidate.updatedAt);
      if (!dirty) setForm(formFromCandidate(candidate));
    }
  }, [candidate, seen, dirty]);

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
    const found = validateForm(form, 'update');
    setErrors(found);
    if (Object.keys(found).length > 0 || !dirty) return;
    setServerError(null);
    try {
      const result = await save.mutateAsync({ branchId: candidate.branchId, candidateId: candidate.id, input: changes });
      setForm(formFromCandidate(result.candidate));
      setSeen(result.candidate.updatedAt);
      toast({ title: 'Candidate saved', tone: 'success' });
    } catch (err) {
      setServerError(errorMessage(err));
    }
  };

  const doArchive = async () => {
    try {
      await archive.run(candidate);
      setConfirmArchive(false);
      toast({ title: `${fullName(candidate)} archived`, description: candidate.orderId ? 'Their line on the board is open again.' : undefined, tone: 'success' });
      onClose();
    } catch (err) {
      setConfirmArchive(false);
      toast({ title: 'Candidate not archived', description: errorMessage(err), tone: 'danger' });
    }
  };

  const linked = candidate.orderId !== null;
  const recruiterOptions = [
    { value: '', label: 'Unassigned' },
    ...env.recruiters.map((p) => ({ value: p.id, label: p.id === env.viewerId ? `${p.name} (me)` : p.name })),
    ...(candidate.recruiterId && !env.recruiters.some((p) => p.id === candidate.recruiterId)
      ? [{ value: candidate.recruiterId, label: env.peopleById.get(candidate.recruiterId)?.name ?? 'Former teammate' }]
      : []),
  ];
  const accountOptions = [
    { value: '', label: 'No account yet' },
    ...env.accounts.map((a) => ({ value: a.id, label: a.name })),
    ...(candidate.accountId && !env.accounts.some((a) => a.id === candidate.accountId)
      ? [{ value: candidate.accountId, label: env.accountsById.get(candidate.accountId)?.name ?? 'Inactive account' }]
      : []),
  ];

  return (
    <>
      <Drawer
        open
        width="34rem"
        onClose={onClose}
        closeOnBackdrop={!dirty}
        title={fullName(candidate)}
        description={`${STAGE_LABEL[candidate.stage]}${recruiter ? ` · ${recruiter.name}` : ''}`}
        footer={
          archived ? undefined : (
            <>
              <Button variant="ghost" className="mr-auto text-danger" icon={<Archive aria-hidden="true" className="size-4" />} onClick={() => setConfirmArchive(true)}>
                Archive
              </Button>
              {dirty ? (
                <Button onClick={() => setForm(formFromCandidate(candidate))} disabled={save.isPending}>
                  Discard
                </Button>
              ) : null}
              <Button type="submit" form={formId} variant="primary" disabled={!dirty} loading={save.isPending}>
                Save changes
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <CandidateAvatar candidate={{ initials: form.initials || candidate.initials }} recruiter={recruiter} size="lg" />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {archived ? <Badge icon={<Archive />}>Archived · {STAGE_LABEL[candidate.stage]}</Badge> : <MoveMenu candidate={candidate} variant="button" />}
              <span className={isStale(days) && candidate.stage !== 'started' && candidate.stage !== 'dropped' ? 'text-sm font-semibold text-warning tabular-nums' : 'text-sm text-muted tabular-nums'}>
                {days} {days === 1 ? 'day' : 'days'} in stage
              </span>
            </div>
          </div>

          <FillSection candidate={candidate} />

          <section aria-labelledby={`${formId}-details`} className="flex flex-col gap-2">
            <h3 id={`${formId}-details`} className="font-display text-sm font-bold uppercase tracking-wider text-muted">
              Details
            </h3>
            <form id={formId} onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <fieldset disabled={archived} className="contents">
                <TextField label="First name" required maxLength={60} value={form.firstName} error={errors.firstName} onChange={(e) => set({ firstName: e.target.value })} />
                <TextField label="Last name" maxLength={60} value={form.lastName} error={errors.lastName} onChange={(e) => set({ lastName: e.target.value })} />
                <div className="flex items-end gap-2">
                  <TextField
                    label="Initials"
                    className="flex-1"
                    maxLength={4}
                    value={form.initials}
                    error={errors.initials}
                    hint={form.initialsEdited ? 'Edited by hand' : 'From the name'}
                    inputClassName="font-display font-bold uppercase tracking-wider"
                    onChange={(e) => set({ initials: e.target.value })}
                  />
                  {form.initialsEdited && !archived ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mb-5"
                      icon={<RotateCcw aria-hidden="true" className="size-3.5" />}
                      onClick={() => set({ initialsEdited: false })}
                      aria-label="Derive initials from the name"
                    >
                      Auto
                    </Button>
                  ) : null}
                </div>
                <TextField label="Start date" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
                <TextField label="Phone" type="tel" maxLength={30} value={form.phone} error={errors.phone} onChange={(e) => set({ phone: e.target.value })} />
                <TextField label="Email" type="email" maxLength={254} value={form.email} error={errors.email} onChange={(e) => set({ email: e.target.value })} />
                <Select label="Recruiter" value={form.recruiterId} options={recruiterOptions} onChange={(e) => set({ recruiterId: e.target.value })} />
                <Select
                  label="Account"
                  value={form.accountId}
                  options={accountOptions}
                  disabled={linked}
                  hint={linked ? 'Unlink from the order to change the account.' : undefined}
                  onChange={(e) => set({ accountId: e.target.value })}
                />
                <Textarea label="Notes" rows={4} maxLength={2000} value={form.notes} error={errors.notes} onChange={(e) => set({ notes: e.target.value })} className="sm:col-span-2" />
              </fieldset>
              {serverError ? (
                <p role="alert" className="text-sm font-medium text-danger sm:col-span-2">
                  {serverError}
                </p>
              ) : null}
            </form>
          </section>

          <StageHistory candidate={candidate} />
        </div>
      </Drawer>
      <ConfirmDialog
        open={confirmArchive}
        title={`Archive ${fullName(candidate)}?`}
        description={
          candidate.orderId
            ? 'They leave the pipeline and their penciled line goes back to open on the board.'
            : 'They leave the pipeline. Archived candidates stay searchable with "Show archived".'
        }
        confirmLabel="Archive"
        tone="danger"
        loading={archive.isPending}
        onConfirm={() => void doArchive()}
        onCancel={() => setConfirmArchive(false)}
      />
    </>
  );
}

function StageHistory({ candidate }: { candidate: Candidate }) {
  const env = usePipelineEnv();
  const headingId = useId();
  const events = [...candidate.history].reverse();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="font-display text-sm font-bold uppercase tracking-wider text-muted">
        Stage history
      </h3>
      {events.length === 0 ? (
        <p className="text-sm text-muted">No stage changes yet.</p>
      ) : (
        <ol className="relative ml-1.5 flex flex-col gap-3 border-l-2 border-line pl-4">
          {events.map((ev, i) => {
            const by = env.peopleById.get(ev.by);
            const when = new Date(ev.at);
            return (
              <li key={`${ev.at}-${i}`} className="relative">
                <span
                  aria-hidden="true"
                  className={
                    ev.stage === 'dropped'
                      ? 'absolute -left-[1.4rem] top-1 size-3 rounded-full border-2 border-danger bg-surface'
                      : i === 0
                        ? 'absolute -left-[1.4rem] top-1 size-3 rounded-full border-2 border-accent bg-accent'
                        : 'absolute -left-[1.4rem] top-1 size-3 rounded-full border-2 border-line-strong bg-surface'
                  }
                />
                <p className="text-sm">
                  <span className="font-display text-base font-bold">{STAGE_LABEL[ev.stage]}</span>
                  {ev.dropReason ? <span className="font-semibold text-danger"> · {DROP_REASON_LABEL[ev.dropReason]}</span> : null}
                </p>
                <p className="text-xs text-muted">
                  {by ? by.name : 'Someone'} ·{' '}
                  <time dateTime={ev.at} title={when.toLocaleString()}>
                    {relativeAgeLong(ev.at)}
                  </time>
                </p>
                {ev.note ? <p className="mt-1 whitespace-pre-line text-sm italic text-fg">{ev.note}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
