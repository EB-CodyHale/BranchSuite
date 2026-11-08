import type { Account } from '@branchsuite/shared';
import { Plus, RefreshCcw, Search, Star, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState, type FormEvent } from 'react';
import { useAccounts, useCreateAccount, useRotateWallCodes, useUpdateAccount, useUsers } from '../../lib/queries.js';
import { Badge } from '../../ui/Badge.js';
import { Button } from '../../ui/Button.js';
import { ToggleChip } from '../../ui/Chip.js';
import { cx } from '../../ui/cx.js';
import { Dialog } from '../../ui/Dialog.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { TextField } from '../../ui/Field.js';
import { MarkerDot } from '../../ui/MarkerDot.js';
import { Segmented } from '../../ui/Segmented.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';
import { WallGlyph } from '../../ui/WallGlyph.js';
import { AccountEditor } from './AccountEditor.js';
import { useSetupBranch } from './SetupBranchContext.js';
import { ErrorNote, SectionHeader } from './setupUi.js';

type ActiveFilter = 'active' | 'archived' | 'all';

export function matchesAccount(a: Account, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [a.name, a.accountNumber ?? '', a.wall.code, ...a.aliases, ...a.domains, ...a.units.map((u) => u.name)].some((s) => s.toLowerCase().includes(needle));
}

export function AccountsSection() {
  const { branchId, branch } = useSetupBranch();
  const accounts = useAccounts(branchId);
  const people = useUsers(branchId);
  const update = useUpdateAccount();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [filter, setFilter] = useState<ActiveFilter>('active');
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rotating, setRotating] = useState(false);

  const list = accounts.data ?? [];
  const peopleById = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p])), [people.data]);
  const rows = list
    .filter((a) => (filter === 'all' ? true : filter === 'active' ? a.active : !a.active))
    .filter((a) => !priorityOnly || a.isPriority)
    .filter((a) => matchesAccount(a, deferred))
    .sort((a, b) => Number(b.isPriority) - Number(a.isPriority) || Number(a.reserved !== null) - Number(b.reserved !== null) || a.name.localeCompare(b.name));
  const editing = list.find((a) => a.id === editingId) ?? null;

  const togglePriority = (a: Account) =>
    update.mutate(
      { branchId, accountId: a.id, input: { isPriority: !a.isPriority } },
      { onError: (e) => toast({ tone: 'danger', title: `Could not update ${a.name}`, description: e.message }) },
    );

  return (
    <div>
      <SectionHeader
        title="Accounts"
        branchScoped
        description="Clients this branch staffs for, their units and contacts, and the code each one wears on the lobby wall."
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<RefreshCcw aria-hidden="true" className="size-4" />} onClick={() => setRotating(true)} disabled={list.length === 0}>
              Rotate all wall codes
            </Button>
            <Button size="sm" variant="primary" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setCreating(true)}>
              New account
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <input
            type="search"
            aria-label="Search accounts"
            placeholder="Search name, number, alias, code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-md border border-line-strong bg-surface pl-8 pr-8 text-[0.9375rem] placeholder:text-subtle"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted hover:text-fg">
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
        <Segmented
          label="Show"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
            { value: 'all', label: 'All' },
          ]}
        />
        <ToggleChip pressed={priorityOnly} onPressedChange={setPriorityOnly} icon={<Star />}>
          Priority
        </ToggleChip>
      </div>

      <ErrorNote error={accounts.error} className="mb-3" />
      {accounts.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={list.length === 0 ? 'No accounts yet' : 'No accounts match'}
          description={list.length === 0 ? 'Add the clients this branch staffs for, or ask an admin to import them.' : 'Try a different search or filter.'}
        />
      ) : (
        <ul aria-label={`Accounts in ${branch?.name ?? 'branch'}`} className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          {rows.map((a) => {
            const owner = a.ownerId ? peopleById.get(a.ownerId) : undefined;
            return (
              <li key={a.id} className={cx('flex items-center gap-3 px-3 py-2.5', !a.active && 'bg-surface-2/60')}>
                <WallGlyph glyph={a.wall.glyph} color={a.wall.color} code={a.wall.code} size={36} />
                <button type="button" onClick={() => setEditingId(a.id)} className="min-w-0 flex-1 rounded-sm text-left">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cx('font-display text-lg font-semibold leading-tight', !a.active && 'text-muted line-through decoration-1')}>{a.name}</span>
                    {a.accountNumber ? <span className="font-mono text-xs text-subtle">#{a.accountNumber}</span> : null}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                    <span className="tabular-nums">{a.units.length} {a.units.length === 1 ? 'unit' : 'units'}</span>
                    <span className="tabular-nums">{(a.contacts ?? []).filter((c) => c.active).length} contacts</span>
                    {a.aliases.length ? <span className="truncate">aka {a.aliases.slice(0, 2).join(', ')}{a.aliases.length > 2 ? '…' : ''}</span> : null}
                  </span>
                </button>
                <span className="hidden items-center gap-1.5 text-sm sm:flex">
                  {owner ? (
                    <>
                      <MarkerDot marker={owner.marker} label={null} />
                      <span className="max-w-[9rem] truncate">{owner.name}</span>
                    </>
                  ) : (
                    <span className="text-subtle">No owner</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {a.reserved ? <Badge tone="accent">Reserved</Badge> : null}
                  {!a.active ? <Badge>Archived</Badge> : null}
                  <button
                    type="button"
                    aria-pressed={a.isPriority}
                    aria-label={`Priority account: ${a.name}`}
                    title={a.isPriority ? 'Priority account (select to clear)' : 'Mark as priority'}
                    onClick={() => togglePriority(a)}
                    className={cx('inline-flex size-8 items-center justify-center rounded-md hover:bg-surface-2', a.isPriority ? 'text-warning' : 'text-subtle hover:text-fg')}
                  >
                    <Star aria-hidden="true" className="size-[1.1rem]" fill={a.isPriority ? 'currentColor' : 'none'} />
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(a.id)} aria-label={`Edit ${a.name}`}>
                    Edit
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? <AccountEditor key={editing.id} account={editing} accounts={list} people={people.data ?? []} onClose={() => setEditingId(null)} /> : null}
      {creating ? (
        <NewAccountDialog
          branchId={branchId}
          onClose={() => setCreating(false)}
          onCreated={(a) => {
            setCreating(false);
            setEditingId(a.id);
          }}
        />
      ) : null}
      <RotateCodesDialog open={rotating} branchId={branchId} count={list.filter((a) => a.active).length} onClose={() => setRotating(false)} />
    </div>
  );
}

function NewAccountDialog({ branchId, onClose, onCreated }: { branchId: string; onClose: () => void; onCreated: (a: Account) => void }) {
  const create = useCreateAccount();
  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const nameError = submitted && !name.trim() ? 'Enter the account name.' : null;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!name.trim()) return;
    create.mutate({ branchId, input: { name: name.trim(), accountNumber: accountNumber.trim() || null } }, { onSuccess: onCreated });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="New account"
      description="A wall code is assigned automatically. Units, contacts and aliases come next."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-account-form" loading={create.isPending}>
            Create and edit
          </Button>
        </>
      }
    >
      <form id="new-account-form" noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
        <ErrorNote error={create.error} />
        <TextField label="Account name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} error={nameError} autoFocus />
        <TextField label="Account number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} maxLength={50} inputClassName="font-mono" hint="Optional. Helps match future imports." />
      </form>
    </Dialog>
  );
}

function RotateCodesDialog({ open, branchId, count, onClose }: { open: boolean; branchId: string; count: number; onClose: () => void }) {
  const rotate = useRotateWallCodes();
  const { toast } = useToast();
  const [understood, setUnderstood] = useState(false);
  const close = () => {
    if (rotate.isPending) return;
    setUnderstood(false);
    rotate.reset();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Rotate every wall code?"
      footer={
        <>
          <Button onClick={close} disabled={rotate.isPending}>
            Keep current codes
          </Button>
          <Button
            variant="danger"
            disabled={!understood}
            loading={rotate.isPending}
            onClick={() =>
              rotate.mutate(
                { branchId },
                {
                  onSuccess: (list) => {
                    toast({ tone: 'success', title: `New wall codes for ${list.length} accounts`, description: 'Print or share the new staff legend from Board → Wall preview.' });
                    close();
                  },
                },
              )
            }
          >
            Rotate all codes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <ErrorNote error={rotate.error} />
        <p>
          Every account in this branch ({count} active) gets a <strong>new code, color and shape</strong> at once. The lobby wall switches on its next refresh.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>Staff must re-learn every code. Old printed legends become wrong.</li>
          <li>Use this when codes may have become known to the public, for example after a client name was linked to a code.</li>
          <li>This cannot be undone. Codes you set by hand are replaced too.</li>
        </ul>
        <label className="flex items-start gap-2 rounded-md border border-danger/50 bg-danger-soft px-3 py-2 font-semibold">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 size-4 accent-accent" />I understand staff must re-learn all wall codes.
        </label>
      </div>
    </Dialog>
  );
}
