import type { Display, DisplayContent } from '@branchsuite/shared';
import { CircleCheck, MonitorOff, MonitorPlay, Plus, Tv } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { relativeAgeLong } from '../../lib/format.js';
import { useClaimDisplay, useDisplays, useRevokeDisplay, useUpdateDisplay } from '../../lib/queries.js';
import { Badge, type BadgeTone } from '../../ui/Badge.js';
import { Button, buttonClasses } from '../../ui/Button.js';
import { ConfirmDialog } from '../../ui/ConfirmDialog.js';
import { cx } from '../../ui/cx.js';
import { Dialog } from '../../ui/Dialog.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Select, TextField } from '../../ui/Field.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';
import { formatPairingCode, isCompletePairingCode } from './pairingCode.js';
import { useSetupBranch } from './SetupBranchContext.js';
import { ErrorNote, SectionHeader } from './setupUi.js';

const ONLINE_MS = 5 * 60_000;

/** What a screen shows. The whiteboard holds internal huddle detail, so 'whiteboard' is for private rooms only. */
export const DISPLAY_CONTENT_OPTIONS: ReadonlyArray<{ value: DisplayContent; label: string; hint: string }> = [
  { value: 'auto', label: 'Automatic', hint: 'Coded order board; the whiteboard during the huddle window. Right for lobby screens.' },
  { value: 'whiteboard', label: 'Whiteboard all day', hint: "Today's whiteboard with full detail all day. Only for screens the public can't see, like a manager's office." },
  { value: 'board', label: 'Order board only', hint: 'Coded order board; never switches to the whiteboard.' },
];
const contentHint = (c: DisplayContent) => DISPLAY_CONTENT_OPTIONS.find((o) => o.value === c)?.hint ?? '';

export function displayStatus(d: Display, now: Date = new Date()): { label: string; tone: BadgeTone } {
  if (d.revokedAt) return { label: 'Revoked', tone: 'danger' };
  if (!d.lastSeenAt) return { label: 'Never connected', tone: 'neutral' };
  return now.getTime() - new Date(d.lastSeenAt).getTime() < ONLINE_MS ? { label: 'Online', tone: 'success' } : { label: 'Offline', tone: 'warning' };
}

export function DisplaysSection() {
  const { branchId, branch } = useSetupBranch();
  const displays = useDisplays(branchId);
  const revoke = useRevokeDisplay();
  const update = useUpdateDisplay();
  const { toast } = useToast();
  const setContent = (d: Display, content: DisplayContent) =>
    update.mutate(
      { branchId, displayId: d.id, input: { content } },
      {
        onSuccess: (next) =>
          toast({ tone: 'success', title: `${next.name}: ${DISPLAY_CONTENT_OPTIONS.find((o) => o.value === next.content)?.label ?? next.content}`, description: 'The screen switches within a few seconds.' }),
        onError: (e) => toast({ tone: 'danger', title: 'Could not change the display', description: e.message }),
      },
    );
  const [pairing, setPairing] = useState(false);
  const [revoking, setRevoking] = useState<Display | null>(null);
  const list = [...(displays.data ?? [])].sort((a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null) || a.name.localeCompare(b.name));

  return (
    <div>
      <SectionHeader
        title="Displays"
        branchScoped
        description="TVs that show this branch's wall: lobby screens show the coded order board, office screens can keep the whiteboard up. A TV holds a device key, not anyone's sign-in."
        actions={
          <>
            <Link to="/setup/wall" className={buttonClasses('ghost', 'sm')}>
              Wall settings
            </Link>
            <Button variant="primary" size="sm" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setPairing(true)}>
              Pair a display
            </Button>
          </>
        }
      />
      <ErrorNote error={displays.error} className="mb-3" />
      {displays.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Tv />}
          title="No displays yet"
          description={
            <>
              On the TV's browser, open <code className="font-mono text-fg">/wall</code>. It shows a six-character code. Then choose Pair a display here.
            </>
          }
          action={
            <Button variant="primary" onClick={() => setPairing(true)}>
              Pair a display
            </Button>
          }
        />
      ) : (
        <ul aria-label={`Displays for ${branch?.name ?? 'branch'}`} className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          {list.map((d) => {
            const s = displayStatus(d);
            const revoked = d.revokedAt !== null;
            return (
              <li key={d.id} className={cx('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3', revoked && 'bg-surface-2/60')}>
                <span aria-hidden="true" className={cx('inline-flex size-9 items-center justify-center rounded-md', revoked ? 'bg-surface-2 text-subtle' : 'bg-accent-soft text-accent')}>
                  {revoked ? <MonitorOff className="size-5" /> : <MonitorPlay className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cx('font-display text-lg font-semibold leading-tight', revoked && 'text-muted')}>{d.name}</p>
                  <p className="text-xs text-muted">
                    Key <span className="font-mono text-fg">{d.tokenPrefix}…</span>
                    {' · '}
                    {d.lastSeenAt ? <>Last seen <time dateTime={d.lastSeenAt}>{relativeAgeLong(d.lastSeenAt)}</time></> : 'Not seen yet'}
                  </p>
                </div>
                <Badge tone={s.tone} className="px-2 py-1">
                  {s.label}
                </Badge>
                {revoked ? null : (
                  <Select
                    label={`What ${d.name} shows`}
                    hideLabel
                    value={d.content ?? 'auto'}
                    onChange={(e) => setContent(d, e.target.value as DisplayContent)}
                    disabled={update.isPending}
                    options={DISPLAY_CONTENT_OPTIONS}
                    title={contentHint(d.content ?? 'auto')}
                    className="w-full sm:w-auto"
                    selectClassName="w-full sm:w-52"
                  />
                )}
                {revoked ? null : (
                  <Button size="sm" variant="ghost" onClick={() => setRevoking(d)} aria-label={`Revoke ${d.name}`}>
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pairing ? <PairDisplayDialog branchId={branchId} onClose={() => setPairing(false)} /> : null}
      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke ${revoking?.name ?? 'display'}?`}
        tone="danger"
        confirmLabel="Revoke now"
        loading={revoke.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() =>
          revoking &&
          revoke.mutate(
            { branchId, displayId: revoking.id },
            {
              onSuccess: (d) => {
                toast({ tone: 'success', title: `${d.name} revoked` });
                setRevoking(null);
              },
              onError: (e) => toast({ tone: 'danger', title: 'Could not revoke the display', description: e.message }),
            },
          )
        }
        description={
          <div className="space-y-2">
            <p>
              The TV stops showing orders on its <strong className="text-fg">next request, within about a minute</strong>, and goes back to a pairing screen.
            </p>
            <p>Use this for a lost, replaced or moved screen. To use it again, pair it with a new code.</p>
          </div>
        }
      />
    </div>
  );
}

export function PairingCodeInput({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | null }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        Code on the TV
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(formatPairingCode(e.target.value))}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={7}
        placeholder="K7Q-29M"
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-h${error ? ` ${id}-e` : ''}`}
        className={cx(
          'h-16 w-full max-w-[16rem] rounded-lg border-2 bg-paper px-4 text-center font-display text-4xl font-bold uppercase tracking-[0.18em] tabular-nums text-ink placeholder:text-subtle/50',
          error ? 'border-danger' : 'border-line-strong',
        )}
      />
      {error ? (
        <p id={`${id}-e`} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <p id={`${id}-h`} className="text-xs text-muted">
        Six letters and digits. Codes expire after 10 minutes; reload /wall on the TV for a fresh one.
      </p>
    </div>
  );
}

function PairDisplayDialog({ branchId, onClose }: { branchId: string; onClose: () => void }) {
  const claim = useClaimDisplay();
  const { branch } = useSetupBranch();
  const [code, setCode] = useState('');
  const [name, setName] = useState('Lobby TV');
  const [content, setContent] = useState<DisplayContent>('auto');
  const [submitted, setSubmitted] = useState(false);
  const doneRef = useRef<HTMLButtonElement>(null);
  const codeError = submitted && !isCompletePairingCode(code) ? 'Enter all six characters.' : null;
  const nameError = submitted && !name.trim() ? 'Name the screen, e.g. Lobby TV.' : null;
  const paired = claim.data;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!isCompletePairingCode(code) || !name.trim()) return;
    claim.mutate({ branchId, input: { code, name: name.trim(), content } });
  };

  if (paired) {
    return (
      <Dialog open onClose={onClose} title="Display paired" initialFocusRef={doneRef} footer={<Button ref={doneRef} variant="primary" onClick={onClose}>Done</Button>}>
        <div role="status" className="flex flex-col items-center gap-2 py-4 text-center">
          <CircleCheck aria-hidden="true" className="size-12 text-success" />
          <p className="font-display text-2xl font-bold">{paired.name}</p>
          <p className="text-sm text-muted">
            The TV now shows the {branch?.name ?? 'branch'} wall. It reconnects by itself after a power cut.
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title="Pair a display"
      description={`Connects a TV to the ${branch?.name ?? 'branch'} wall.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="pair-form" loading={claim.isPending}>
            Pair display
          </Button>
        </>
      }
    >
      <form id="pair-form" noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted">
          <li>
            On the TV, open <code className="font-mono text-fg">/wall</code> in the browser.
          </li>
          <li>Type the code it shows below.</li>
        </ol>
        <ErrorNote error={claim.error} />
        <PairingCodeInput value={code} onChange={setCode} error={codeError} />
        <TextField label="Screen name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required error={nameError} hint="Where it hangs, so you can find it later." />
        <Select label="What this screen shows" value={content} onChange={(e) => setContent(e.target.value as DisplayContent)} options={DISPLAY_CONTENT_OPTIONS} hint={contentHint(content)} />
      </form>
    </Dialog>
  );
}
