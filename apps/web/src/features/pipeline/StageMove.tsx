import { DROP_REASONS, isDayKey, openingStateForStage, type Candidate, type CandidateStageInput, type DropReason, type PipelineStage } from '@branchsuite/shared';
import { useCallback, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '../../lib/api.js';
import { useCandidateStage } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Select, TextField, Textarea } from '../../ui/Field.js';
import { useToast } from '../../ui/Toast.js';
import { DROP_REASON_LABEL, fullName, LINE_STATUS_LABEL, START_DATE_STAGES, STAGE_LABEL } from './pipelineModel.js';

interface MoveRequest {
  candidate: Candidate;
  stage: PipelineStage;
}

export interface StageMover {
  requestMove: (candidate: Candidate, stage: PipelineStage) => void;
  /** Optimistic stage per candidate while the write is in flight. */
  pending: ReadonlyMap<string, PipelineStage>;
  dialogs: ReactNode;
}

/** Owns the stage-move flow: direct moves, the drop-reason dialog and the start-date prompt. */
export function useStageMover(): StageMover {
  const mutation = useCandidateStage();
  const { toast } = useToast();
  const [request, setRequest] = useState<MoveRequest | null>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, PipelineStage>>(new Map());
  const ref = useRef({ mutate: mutation.mutateAsync, toast });
  ref.current = { mutate: mutation.mutateAsync, toast };

  const commit = useCallback(async (candidate: Candidate, input: CandidateStageInput, fromDialog: boolean): Promise<string | null> => {
    setPending((m) => new Map(m).set(candidate.id, input.stage));
    try {
      const result = await ref.current.mutate({ branchId: candidate.branchId, candidateId: candidate.id, input });
      const lineState = openingStateForStage(input.stage);
      const lineNote =
        result.orders.length === 0
          ? undefined
          : lineState && lineState !== 'open'
            ? `Their board line is now ${LINE_STATUS_LABEL[lineState]}.`
            : 'Their board line is open again.';
      ref.current.toast({ title: `${fullName(candidate)} moved to ${STAGE_LABEL[input.stage]}`, description: lineNote, tone: 'success' });
      return null;
    } catch (e) {
      const message = errorMessage(e);
      if (!fromDialog) ref.current.toast({ title: `${fullName(candidate)} was not moved`, description: message, tone: 'danger' });
      return message;
    } finally {
      setPending((m) => {
        const next = new Map(m);
        next.delete(candidate.id);
        return next;
      });
    }
  }, []);

  const requestMove = useCallback(
    (candidate: Candidate, stage: PipelineStage) => {
      if (stage === candidate.stage || candidate.status === 'archived') return;
      if (stage === 'dropped' || START_DATE_STAGES.has(stage)) setRequest({ candidate, stage });
      else void commit(candidate, { stage }, false);
    },
    [commit],
  );

  const close = () => setRequest(null);
  const submit = async (input: CandidateStageInput): Promise<string | null> => {
    if (!request) return null;
    const error = await commit(request.candidate, input, true);
    if (error === null) setRequest(null);
    return error;
  };

  const dialogs = request ? (
    request.stage === 'dropped' ? (
      <DropDialog key={request.candidate.id} candidate={request.candidate} onCancel={close} onSubmit={submit} />
    ) : (
      <StartDateDialog key={request.candidate.id + request.stage} candidate={request.candidate} stage={request.stage} onCancel={close} onSubmit={submit} />
    )
  ) : null;

  return useMemo(() => ({ requestMove, pending, dialogs }), [requestMove, pending, dialogs]);
}

interface MoveDialogProps {
  candidate: Candidate;
  onCancel: () => void;
  /** Resolves to an error message, or null on success. */
  onSubmit: (input: CandidateStageInput) => Promise<string | null>;
}

const REASON_OPTIONS = [{ value: '', label: 'Choose a reason…' }, ...DROP_REASONS.map((r) => ({ value: r, label: DROP_REASON_LABEL[r] }))];

export function DropDialog({ candidate, onCancel, onSubmit }: MoveDialogProps) {
  const formId = useId();
  const [reason, setReason] = useState<DropReason | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason) {
      setError('Choose why the candidate dropped.');
      return;
    }
    setBusy(true);
    setServerError(await onSubmit({ stage: 'dropped', dropReason: reason, note: note.trim() || undefined }));
    setBusy(false);
  };

  return (
    <Dialog
      open
      onClose={() => !busy && onCancel()}
      closeOnBackdrop={false}
      title={`Drop ${fullName(candidate)}`}
      description={
        candidate.orderId
          ? 'Their penciled line goes back to open on the board.'
          : 'They leave the active pipeline. You can re-engage them later.'
      }
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={busy}>
            Drop candidate
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={save} className="flex flex-col gap-3" noValidate>
        <Select
          label="Reason"
          required
          value={reason}
          error={error}
          options={REASON_OPTIONS}
          onChange={(e) => {
            setReason(e.target.value as DropReason | '');
            setError(null);
          }}
        />
        <Textarea label="Note" hint="Optional. Kept in the stage history." maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        {serverError ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {serverError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

export function StartDateDialog({ candidate, stage, onCancel, onSubmit }: MoveDialogProps & { stage: PipelineStage }) {
  const formId = useId();
  const [date, setDate] = useState(candidate.startDate ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (date && !isDayKey(date)) {
      setError('Enter a real date, or leave it blank.');
      return;
    }
    const startDate = date ? date : candidate.startDate ? null : undefined;
    setBusy(true);
    setServerError(await onSubmit({ stage, startDate, note: note.trim() || undefined }));
    setBusy(false);
  };

  return (
    <Dialog
      open
      onClose={() => !busy && onCancel()}
      closeOnBackdrop={false}
      title={`Move to ${STAGE_LABEL[stage]}`}
      description={`${fullName(candidate)}. Add a start date if you have one; it shows on their board line.`}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            Move
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={save} className="flex flex-col gap-3" noValidate>
        <TextField
          label="Start date"
          type="date"
          hint="Optional"
          value={date}
          error={error}
          onChange={(e) => {
            setDate(e.target.value);
            setError(null);
          }}
        />
        <Textarea label="Note" hint="Optional. Kept in the stage history." maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        {serverError ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {serverError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
