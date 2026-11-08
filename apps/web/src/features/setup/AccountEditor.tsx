import { LIMITS, zDomain, type Account, type AccountContact, type AccountUnit, type AccountUpdateInput, type WallCode } from '@branchsuite/shared';
import { useMemo, useState } from 'react';
import { useMeContext } from '../../app/MeContext.js';
import { useUpdateAccount, type RosterEntry } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { Drawer } from '../../ui/Dialog.js';
import { Select, TextField } from '../../ui/Field.js';
import { TabPanel, Tabs } from '../../ui/Tabs.js';
import { useToast } from '../../ui/Toast.js';
import { WallGlyph } from '../../ui/WallGlyph.js';
import { contactErrors, ContactsEditor } from './ContactsEditor.js';
import { ChipInput, ErrorNote, Notice, Switch } from './setupUi.js';
import { unitTreeErrors, UnitsEditor } from './UnitsEditor.js';
import { WallCodeCard, wallCodeErrors } from './WallCodeCard.js';

type TabId = 'details' | 'units' | 'contacts' | 'wall';

interface Draft {
  name: string;
  accountNumber: string;
  aliases: string[];
  domains: string[];
  ownerId: string | null;
  isPriority: boolean;
  active: boolean;
  units: AccountUnit[];
  contacts: AccountContact[];
  wall: WallCode;
}

function draftOf(a: Account): Draft {
  return {
    name: a.name,
    accountNumber: a.accountNumber ?? '',
    aliases: a.aliases,
    domains: a.domains,
    ownerId: a.ownerId,
    isPriority: a.isPriority,
    active: a.active,
    units: a.units,
    contacts: a.contacts ?? [],
    wall: a.wall,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only the fields that changed, shaped for PATCH. */
export function accountPatch(account: Account, d: Draft, includeContacts: boolean): AccountUpdateInput {
  const base = draftOf(account);
  const input: AccountUpdateInput = {};
  if (d.name.trim() !== base.name) input.name = d.name.trim();
  if (d.accountNumber.trim() !== base.accountNumber) input.accountNumber = d.accountNumber.trim() || null;
  if (!same(d.aliases, base.aliases)) input.aliases = d.aliases;
  if (!same(d.domains, base.domains)) input.domains = d.domains;
  if (d.ownerId !== base.ownerId) input.ownerId = d.ownerId;
  if (d.isPriority !== base.isPriority) input.isPriority = d.isPriority;
  if (d.active !== base.active) input.active = d.active;
  if (!same(d.units, base.units)) input.units = d.units.map((u) => ({ ...u, name: u.name.trim() }));
  if (includeContacts && !same(d.contacts, base.contacts)) input.contacts = d.contacts.map((c) => ({ ...c, email: c.email.trim().toLowerCase(), name: c.name.trim() }));
  if (!same(d.wall, base.wall)) input.wall = d.wall;
  return input;
}

export interface AccountEditorProps {
  account: Account;
  /** All accounts in the branch (for wall code uniqueness). */
  accounts: readonly Account[];
  people: readonly RosterEntry[];
  onClose: () => void;
  initialTab?: TabId;
}

export function AccountEditor({ account, accounts, people, onClose, initialTab = 'details' }: AccountEditorProps) {
  const { canManage } = useMeContext();
  const showContacts = canManage(account.branchId);
  const [tab, setTab] = useState<TabId>(initialTab);
  const [draft, setDraft] = useState<Draft>(() => draftOf(account));
  const update = useUpdateAccount();
  const { toast } = useToast();

  const savedUnitIds = useMemo(() => new Set(account.units.map((u) => u.id)), [account.units]);
  const savedContactIds = useMemo(() => new Set((account.contacts ?? []).map((c) => c.id)), [account.contacts]);
  const others = accounts.filter((a) => a.id !== account.id).map((a) => ({ name: a.name, wall: a.wall }));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const problems = {
    details: draft.name.trim() ? [] : ['Enter an account name.'],
    units: unitTreeErrors(draft.units),
    contacts: showContacts ? contactErrors(draft.contacts, draft.units) : [],
    wall: wallCodeErrors(draft.wall, others),
  } satisfies Record<TabId, string[]>;
  const blocking = (Object.keys(problems) as TabId[]).filter((k) => problems[k].length > 0);
  const input = accountPatch(account, draft, showContacts);
  const dirty = Object.keys(input).length > 0;

  const save = () => {
    if (blocking.length > 0) {
      setTab(blocking[0]!);
      return;
    }
    update.mutate(
      { branchId: account.branchId, accountId: account.id, input },
      {
        onSuccess: (a) => {
          toast({ tone: 'success', title: `Saved ${a.name}` });
          onClose();
        },
      },
    );
  };

  const owners = people.filter((p) => p.active || p.id === draft.ownerId);
  const tabLabel = (id: TabId, text: string) => (problems[id].length > 0 ? `${text} (needs fixing)` : text);
  const items = [
    { id: 'details' as const, label: tabLabel('details', 'Details') },
    { id: 'units' as const, label: tabLabel('units', 'Units'), count: draft.units.length },
    ...(showContacts ? [{ id: 'contacts' as const, label: tabLabel('contacts', 'Contacts'), count: draft.contacts.length }] : []),
    { id: 'wall' as const, label: tabLabel('wall', 'Wall code') },
  ];

  return (
    <Drawer
        open
        width="46rem"
        onClose={onClose}
        closeOnBackdrop={false}
        title={
          <span className="flex items-center gap-2.5">
            <WallGlyph glyph={draft.wall.glyph} color={draft.wall.color} code={draft.wall.code} size={32} />
            <span className="min-w-0 truncate">{draft.name.trim() || account.name}</span>
          </span>
        }
        description={account.reserved ? `Reserved ${account.reserved} routing account` : account.accountNumber ? `Account ${account.accountNumber}` : undefined}
        footer={
          <>
            {blocking.length > 0 ? (
              <p role="status" className="mr-auto self-center text-sm font-semibold text-danger">
                Fix {blocking.length === 1 ? 'one tab' : `${blocking.length} tabs`} before saving.
              </p>
            ) : dirty ? (
              <p className="mr-auto self-center text-sm text-muted">Unsaved changes</p>
            ) : null}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} loading={update.isPending} disabled={!dirty}>
              Save account
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <ErrorNote error={update.error} />
          {account.reserved ? (
            <Notice tone="info" title="Reserved routing account">
              Mail from its contacts{account.reserved === 'internal' ? ' or internal domains' : ''} routes here. It never appears on the board or the wall.
            </Notice>
          ) : null}
          <Tabs idBase="acct" label="Account sections" items={items} value={tab} onChange={setTab} />

          <TabPanel idBase="acct" id="details" value={tab} className="flex flex-col gap-4 outline-none">
            <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
              <TextField label="Account name" value={draft.name} onChange={(e) => set('name', e.target.value)} required maxLength={LIMITS.maxShortText} error={problems.details[0]} />
              <TextField label="Account number" value={draft.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} maxLength={50} inputClassName="font-mono" />
            </div>
            <ChipInput
              label="Aliases"
              values={draft.aliases}
              onChange={(v) => set('aliases', v)}
              validate={(v) => (v.length < 2 ? 'Aliases need at least 2 characters.' : null)}
              max={LIMITS.maxAliases}
              hint="Other names clients use in subject lines and signatures. Routing looks for them as whole words."
            />
            <ChipInput
              label="Email domains"
              values={draft.domains}
              onChange={(v) => set('domains', v)}
              normalize={(v) => v.trim().toLowerCase().replace(/^@/, '')}
              validate={(v) => (zDomain.safeParse(v).success ? null : `"${v}" is not a domain (example: client.example).`)}
              max={LIMITS.maxDomains}
              placeholder="client.example"
              hint="Mail from anyone at these domains routes to this account when no contact matches."
            />
            <Select
              label="Owner"
              value={draft.ownerId ?? ''}
              onChange={(e) => set('ownerId', e.target.value || null)}
              options={[{ value: '', label: 'No owner' }, ...owners.map((p) => ({ value: p.id, label: `${p.name} (${p.initials})` }))]}
              hint="The recruiter whose marker shows on this account's orders."
            />
            <Switch checked={draft.isPriority} onChange={(v) => set('isPriority', v)} label="Priority account" description="New orders for this account start as priority and sort to the top." />
            <Switch
              checked={draft.active}
              onChange={(v) => set('active', v)}
              label="Active"
              description={draft.active ? 'Shown in pickers, routing and on the wall.' : 'Archived: hidden from pickers, routing and the wall. History stays.'}
            />
          </TabPanel>

          <TabPanel idBase="acct" id="units" value={tab} className="outline-none">
            <UnitsEditor units={draft.units} onChange={(u) => set('units', u)} people={people} savedIds={savedUnitIds} />
          </TabPanel>

          {showContacts ? (
            <TabPanel idBase="acct" id="contacts" value={tab} className="outline-none">
              <ContactsEditor contacts={draft.contacts} onChange={(c) => set('contacts', c)} units={draft.units} accountName={draft.name || account.name} savedIds={savedContactIds} />
            </TabPanel>
          ) : null}

          <TabPanel idBase="acct" id="wall" value={tab} className="outline-none">
            <WallCodeCard wall={draft.wall} onChange={(w) => set('wall', w)} others={others} accountName={draft.name || account.name} />
          </TabPanel>
        </div>
      </Drawer>
  );
}
