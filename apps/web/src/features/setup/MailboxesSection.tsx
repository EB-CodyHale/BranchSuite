import { zEmail, type Mailbox } from '@branchsuite/shared';
import { Ban, CircleAlert, CircleCheck, Clock, Pencil, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useMeContext } from '../../app/MeContext.js';
import { relativeAge, relativeAgeLong } from '../../lib/format.js';
import { useBranches, useCreateMailbox, useMailboxes, useSyncMailbox, useUpdateMailbox } from '../../lib/queries.js';
import { Badge, type BadgeTone } from '../../ui/Badge.js';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { TextField } from '../../ui/Field.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';
import { BranchChecklist, ErrorNote, Panel, ReadOnlyNote, SectionHeader, Switch } from './setupUi.js';

export const MAILBOX_STATUS: Record<Mailbox['status'], { label: string; tone: BadgeTone; icon: typeof Clock; help: string }> = {
  pending: { label: 'Pending', tone: 'neutral', icon: Clock, help: 'Waiting for the first sync.' },
  ok: { label: 'Syncing', tone: 'success', icon: CircleCheck, help: 'Mail is arriving normally.' },
  no_access: { label: 'No access', tone: 'danger', icon: ShieldAlert, help: 'The app cannot read this mailbox. Add it to the mailbox access group.' },
  error: { label: 'Error', tone: 'danger', icon: CircleAlert, help: 'The last sync failed. See the error below.' },
  disabled: { label: 'Disabled', tone: 'neutral', icon: Ban, help: 'Turned off. No mail is read.' },
};

/** Admins add and edit mailboxes; managers see the mailboxes of their branches read-only. */
export function MailboxesSection() {
  const { isAdmin, me } = useMeContext();
  const mailboxes = useMailboxes();
  const { data: branches } = useBranches();
  const sync = useSyncMailbox();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Mailbox | 'new' | null>(null);
  const branchName = new Map((branches ?? me.branches).map((b) => [b.id, b.name]));
  const list = [...(mailboxes.data ?? [])].sort((a, b) => a.kind.localeCompare(b.kind) || a.address.localeCompare(b.address));

  return (
    <div>
      <SectionHeader
        title="Mailboxes"
        description="Shared branch mailboxes (and approved personal ones) that BranchSuite reads to create tasks and draft orders."
        actions={
          isAdmin ? (
            <Button variant="primary" size="sm" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEditing('new')}>
              Add mailbox
            </Button>
          ) : null
        }
      />
      {!isAdmin ? <ReadOnlyNote>Only an admin can add or change mailboxes. Ask an admin if a status shows a problem.</ReadOnlyNote> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <ErrorNote error={mailboxes.error} className="mb-3" />
          {mailboxes.isPending ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : list.length === 0 ? (
            <EmptyState title="No mailboxes" description={isAdmin ? 'Add the branch shared mailbox to start reading client email.' : 'No mailbox serves your branches yet.'} />
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((m) => {
                const s = MAILBOX_STATUS[m.status];
                return (
                  <li key={m.id} className="rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="break-all font-semibold">{m.address}</p>
                        <p className="mt-0.5 text-sm text-muted">
                          {m.kind === 'personal' ? 'Personal mailbox' : m.branchIds.map((id) => branchName.get(id) ?? id).join(', ')}
                          {m.brand ? ` · ${m.brand}` : ''}
                        </p>
                      </div>
                      <Badge tone={s.tone} icon={<s.icon />} className="px-2 py-1">
                        {s.label}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {s.help}{' '}
                      {m.lastSyncAt ? (
                        <span title={new Date(m.lastSyncAt).toLocaleString()}>
                          Last sync <time dateTime={m.lastSyncAt}>{relativeAge(m.lastSyncAt) === 'just now' ? 'just now' : `${relativeAgeLong(m.lastSyncAt)}`}</time>.
                        </span>
                      ) : (
                        'Never synced.'
                      )}
                    </p>
                    {m.lastError ? (
                      <p className="mt-1.5 rounded-sm bg-danger-soft px-2 py-1 font-mono text-xs text-danger">
                        <span className="sr-only">Last error: </span>
                        {m.lastError}
                      </p>
                    ) : null}
                    {isAdmin ? (
                      <div className="mt-2.5 flex flex-wrap gap-2 border-t border-line pt-2.5">
                        <Button size="sm" icon={<Pencil aria-hidden="true" className="size-4" />} onClick={() => setEditing(m)} aria-label={`Edit ${m.address}`}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<RefreshCw aria-hidden="true" className="size-4" />}
                          disabled={!m.enabled}
                          loading={sync.isPending && sync.variables?.mailboxId === m.id}
                          onClick={() =>
                            sync.mutate(
                              { mailboxId: m.id },
                              {
                                onSuccess: () => toast({ tone: 'success', title: 'Sync queued', description: `Recent mail for ${m.address} is processed now; any backlog continues on the 2-minute sync.` }),
                                onError: (e) => toast({ tone: 'danger', title: 'Could not start a sync', description: e.message }),
                              },
                            )
                          }
                        >
                          Sync now
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <MailAccessHelp />
      </div>
      {editing ? <MailboxDialog mailbox={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function MailAccessHelp() {
  return (
    <Panel title="Mailbox access" className="self-start">
      <div className="flex flex-col gap-2 text-sm text-muted">
        <p>
          BranchSuite reads mail with its own Azure identity. It has <strong className="text-fg">no tenant-wide mail access</strong>.
        </p>
        <p>
          Exchange grants access only to mailboxes in the mail-enabled security group <code className="rounded-sm bg-surface-2 px-1 font-mono text-xs text-fg">BranchSuite-Mailboxes</code> (Exchange RBAC for Applications).
        </p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>An Exchange admin adds the mailbox to that group.</li>
          <li>Add the mailbox here and pick its branches.</li>
          <li>Status turns to Syncing after the next sync (every 2 minutes). "No access" means step 1 is missing or still propagating (up to an hour).</li>
        </ol>
        <p>
          Full steps: <code className="font-mono text-xs text-fg">docs/MAIL.md</code> and <code className="font-mono text-xs text-fg">docs/DEPLOYMENT.md</code> (Exchange RBAC section).
        </p>
      </div>
    </Panel>
  );
}

function MailboxDialog({ mailbox, onClose }: { mailbox: Mailbox | null; onClose: () => void }) {
  const { me } = useMeContext();
  const { data: branches } = useBranches();
  const create = useCreateMailbox();
  const update = useUpdateMailbox();
  const { toast } = useToast();
  const isNew = mailbox === null;
  const isPersonal = mailbox?.kind === 'personal';
  const mutation = isNew ? create : update;
  const [address, setAddress] = useState(mailbox?.address ?? '');
  const [branchIds, setBranchIds] = useState<string[]>(mailbox?.branchIds ?? []);
  const [brand, setBrand] = useState(mailbox?.brand ?? '');
  const [enabled, setEnabled] = useState(mailbox?.enabled ?? true);
  const [submitted, setSubmitted] = useState(false);

  const options = (branches ?? me.branches).filter((b) => b.active || branchIds.includes(b.id)).sort((a, b) => a.name.localeCompare(b.name));
  const errors = {
    address: isNew && !zEmail.safeParse(address).success ? 'Enter the mailbox address, e.g. branch0412@company.example.' : null,
    branchIds: !isPersonal && branchIds.length === 0 ? 'Choose at least one branch.' : null,
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.address || errors.branchIds) return;
    const done = (m: Mailbox) => {
      toast({ tone: 'success', title: isNew ? `Added ${m.address}` : `Saved ${m.address}` });
      onClose();
    };
    if (isNew) create.mutate({ address: address.trim(), branchIds, brand: brand.trim(), enabled }, { onSuccess: done });
    else update.mutate({ mailboxId: mailbox.id, input: isPersonal ? { enabled } : { branchIds, brand: brand.trim(), enabled } }, { onSuccess: done });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={isNew ? 'Add a mailbox' : `Edit ${mailbox.address}`}
      description={isNew ? 'The mailbox must also be in the BranchSuite-Mailboxes group in Exchange.' : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="mailbox-form" loading={mutation.isPending}>
            {isNew ? 'Add mailbox' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="mailbox-form" noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <ErrorNote error={mutation.error} />
        <TextField label="Address" type="email" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!isNew} required error={submitted ? errors.address : null} autoComplete="off" />
        {isPersonal ? null : (
          <>
            <BranchChecklist
              legend="Branches served"
              options={options.map((b) => ({ id: b.id, name: b.name, code: b.code }))}
              value={branchIds}
              onChange={setBranchIds}
              error={submitted ? errors.branchIds : null}
              hint="One mailbox for several branches routes each email by account."
            />
            <TextField label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={60} hint="Optional label, e.g. the company brand this mailbox recruits for." />
          </>
        )}
        <Switch checked={enabled} onChange={setEnabled} label="Enabled" description={enabled ? 'Mail is read every 2 minutes.' : 'No mail is read. Existing tasks stay.'} />
      </form>
    </Dialog>
  );
}
