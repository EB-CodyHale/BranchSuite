import { DEFAULT_SHIFTS, DEFAULT_TIME_ZONE, LIMITS, zBranch, zDomain, type Branch, type BranchSettings, type BranchUpdateInput } from '@branchsuite/shared';
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useMeContext } from '../../app/MeContext.js';
import { useBranches, useCreateBranch, useUpdateBranch } from '../../lib/queries.js';
import { Badge } from '../../ui/Badge.js';
import { Button } from '../../ui/Button.js';
import { ConfirmDialog } from '../../ui/ConfirmDialog.js';
import { cx } from '../../ui/cx.js';
import { Dialog } from '../../ui/Dialog.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { TextField } from '../../ui/Field.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';
import { ChipInput, ErrorNote, Notice, SectionHeader, Switch } from './setupUi.js';
import { timeZoneError, TimeZoneField, US_TIME_ZONES } from './TimeZoneField.js';

const domainError = (v: string) => (zDomain.safeParse(v).success ? null : `"${v}" is not a domain (example: example.com).`);

/** Admins create and edit every branch; managers see their own and can change branch settings only. */
export function BranchesSection() {
  const { isAdmin, permissions } = useMeContext();
  const { data, isPending, error } = useBranches();
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Branch | null>(null);
  const update = useUpdateBranch();
  const { toast } = useToast();

  const visible = (data ?? [])
    .filter((b) => isAdmin || permissions.manageBranchIds.includes(b.id))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  const setActive = (b: Branch, active: boolean) =>
    update.mutate(
      { branchId: b.id, input: { active } },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: active ? `${b.name} reactivated` : `${b.name} archived` });
          setArchiving(null);
        },
        onError: (e) => toast({ tone: 'danger', title: 'Could not change the branch', description: e.message }),
      },
    );

  return (
    <div>
      <SectionHeader
        title="Branches"
        description={isAdmin ? 'Every branch in the company. Archived branches keep their history but nobody can sign in to them.' : 'The branches you manage. An admin changes names, codes and time zones; you can change branch settings.'}
        actions={
          isAdmin ? (
            <Button variant="primary" size="sm" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEditing('new')}>
              New branch
            </Button>
          ) : null
        }
      />
      <ErrorNote error={error} />
      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState title="No branches yet" description={isAdmin ? 'Create the first branch to start.' : 'You do not manage any branch.'} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {visible.map((b) => (
            <li key={b.id}>
              <BranchCard branch={b} canArchive={isAdmin} onEdit={() => setEditing(b)} onArchive={() => (b.active ? setArchiving(b) : setActive(b, true))} />
            </li>
          ))}
        </ul>
      )}
      {editing ? <BranchDialog branch={editing === 'new' ? null : editing} isAdmin={isAdmin} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={archiving !== null}
        title={`Archive ${archiving?.name ?? 'branch'}?`}
        tone="danger"
        confirmLabel="Archive branch"
        loading={update.isPending}
        onCancel={() => setArchiving(null)}
        onConfirm={() => archiving && setActive(archiving, false)}
        description={
          <div className="space-y-2">
            <p>The board, inbox and wall stop for this branch at once. People keep their records, and orders keep their history.</p>
            <p>Lobby displays paired to it go blank. You can reactivate the branch later.</p>
          </div>
        }
      />
    </div>
  );
}

function BranchCard({ branch, canArchive, onEdit, onArchive }: { branch: Branch; canArchive: boolean; onEdit: () => void; onArchive: () => void }) {
  const tz = US_TIME_ZONES.find((z) => z.id === branch.timeZone)?.label ?? branch.timeZone;
  return (
    <article aria-labelledby={`br-${branch.id}`} className={cx('flex h-full flex-col rounded-lg border bg-surface shadow-card', branch.active ? 'border-line' : 'border-dashed border-line-strong opacity-80')}>
      <div className="flex items-start gap-3 px-4 pt-3">
        <span className="mt-0.5 rounded-sm border border-line-strong px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider">{branch.code}</span>
        <div className="min-w-0 flex-1">
          <h3 id={`br-${branch.id}`} className="truncate font-display text-xl font-semibold leading-tight">
            {branch.name}
          </h3>
          <p className="text-sm text-muted">{tz}</p>
        </div>
        {branch.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral" icon={<Archive />}>Archived</Badge>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 py-3 text-sm">
        <dt className="text-subtle">Brands</dt>
        <dd className="min-w-0 truncate">{branch.brands.length ? branch.brands.join(', ') : '—'}</dd>
        <dt className="text-subtle">Email orders</dt>
        <dd>{branch.settings.autoPublishEmailOrders ? 'Go live on the board' : 'Land as drafts'}</dd>
        <dt className="text-subtle">Internal domains</dt>
        <dd className="min-w-0 truncate">{branch.settings.internalDomains.length ? branch.settings.internalDomains.join(', ') : '—'}</dd>
        <dt className="text-subtle">Extra shifts</dt>
        <dd className="min-w-0 truncate">{branch.settings.shiftOptions.length ? branch.settings.shiftOptions.join(', ') : '—'}</dd>
      </dl>
      <div className="mt-auto flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
        <Button size="sm" icon={<Pencil aria-hidden="true" className="size-4" />} onClick={onEdit} aria-label={`Edit ${branch.name}`}>
          Edit
        </Button>
        {canArchive ? (
          <Button size="sm" variant="ghost" icon={branch.active ? <Archive aria-hidden="true" className="size-4" /> : <ArchiveRestore aria-hidden="true" className="size-4" />} onClick={onArchive}>
            {branch.active ? 'Archive' : 'Reactivate'}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

interface Draft {
  code: string;
  name: string;
  timeZone: string;
  brands: string[];
  settings: BranchSettings;
}

function draftOf(b: Branch | null): Draft {
  return b
    ? { code: b.code, name: b.name, timeZone: b.timeZone, brands: b.brands, settings: b.settings }
    : { code: '', name: '', timeZone: DEFAULT_TIME_ZONE, brands: [], settings: { autoPublishEmailOrders: false, internalDomains: [], shiftOptions: [] } };
}

function BranchDialog({ branch, isAdmin, onClose }: { branch: Branch | null; isAdmin: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(branch));
  const [submitted, setSubmitted] = useState(false);
  const create = useCreateBranch();
  const update = useUpdateBranch();
  const { toast } = useToast();
  const isNew = branch === null;
  const canEditIdentity = isAdmin;
  const mutation = isNew ? create : update;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setSetting = <K extends keyof BranchSettings>(k: K, v: BranchSettings[K]) => setDraft((d) => ({ ...d, settings: { ...d.settings, [k]: v } }));

  const errors = {
    code: isNew && !zBranch.shape.code.safeParse(draft.code).success ? 'Use 1-20 letters, digits or dashes.' : null,
    name: draft.name.trim() ? null : 'Enter a branch name.',
    timeZone: timeZoneError(draft.timeZone),
  };
  const valid = !errors.code && !errors.name && !errors.timeZone;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!valid) return;
    const done = (b: Branch) => {
      toast({ tone: 'success', title: isNew ? `Created ${b.name}` : `Saved ${b.name}` });
      onClose();
    };
    if (isNew) {
      create.mutate({ code: draft.code.trim(), name: draft.name.trim(), timeZone: draft.timeZone.trim(), brands: draft.brands }, { onSuccess: done });
      return;
    }
    const input: BranchUpdateInput = { settings: draft.settings };
    if (canEditIdentity) Object.assign(input, { name: draft.name.trim(), timeZone: draft.timeZone.trim(), brands: draft.brands });
    update.mutate({ branchId: branch.id, input }, { onSuccess: done });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={isNew ? 'New branch' : `Edit ${branch.name}`}
      description={isNew ? 'Settings, mailboxes and displays are added after the branch exists.' : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="branch-form" loading={mutation.isPending}>
            {isNew ? 'Create branch' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="branch-form" noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <ErrorNote error={mutation.error} />
        {!canEditIdentity ? (
          <Notice tone="info">Only an admin can change the name, code, time zone or brands.</Notice>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <TextField
            label="Code"
            value={draft.code}
            onChange={(e) => set('code', e.target.value.toUpperCase())}
            disabled={!isNew}
            required
            maxLength={20}
            inputClassName="font-mono uppercase"
            error={submitted ? errors.code : null}
            hint={isNew ? 'Branch number, e.g. 0412.' : 'Fixed after creation.'}
          />
          <TextField label="Name" value={draft.name} onChange={(e) => set('name', e.target.value)} disabled={!canEditIdentity} required maxLength={100} error={submitted ? errors.name : null} />
        </div>
        <TimeZoneField value={draft.timeZone} onChange={(tz) => set('timeZone', tz)} disabled={!canEditIdentity} error={submitted ? errors.timeZone : null} />
        <ChipInput label="Brands" values={draft.brands} onChange={(v) => set('brands', v)} disabled={!canEditIdentity} max={10} hint="Company brands this branch recruits under. Used to label mailboxes." />

        {isNew ? null : (
          <fieldset className="flex flex-col gap-4 rounded-md border border-line p-3">
            <legend className="px-1 font-display text-lg font-semibold">Branch settings</legend>
            <Switch
              checked={draft.settings.autoPublishEmailOrders}
              onChange={(v) => setSetting('autoPublishEmailOrders', v)}
              label="Publish email orders automatically"
              description={
                draft.settings.autoPublishEmailOrders
                  ? 'On: an order read from a client email goes live on the board and the lobby wall right away.'
                  : 'Off: an order read from a client email lands as a draft. A manager checks it and publishes it.'
              }
            />
            <ChipInput
              label="Internal domains"
              values={draft.settings.internalDomains}
              onChange={(v) => setSetting('internalDomains', v)}
              normalize={(v) => v.trim().toLowerCase().replace(/^@/, '')}
              validate={domainError}
              max={LIMITS.maxDomains}
              placeholder="example.com"
              hint="Mail from these domains counts as your own team (replies, not client requests)."
            />
            <ChipInput
              label="Extra shift options"
              values={draft.settings.shiftOptions}
              onChange={(v) => setSetting('shiftOptions', v)}
              validate={(v) => (v.length > LIMITS.maxShiftText ? 'Shift labels are short, like "A" or "PM".' : null)}
              max={20}
              placeholder="A, B, AM, PM"
              hint={`Offered in the order form next to ${DEFAULT_SHIFTS.join(', ')}.`}
            />
          </fieldset>
        )}
      </form>
    </Dialog>
  );
}
