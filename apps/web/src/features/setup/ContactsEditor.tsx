import { accountLabel, LIMITS, zEmail, type AccountContact, type AccountUnit } from '@branchsuite/shared';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import { IconButton } from '../../ui/IconButton.js';
import { newLocalId, Notice } from './setupUi.js';

/** Invalid emails, duplicates and contacts pointing at a removed unit. [] when valid. */
export function contactErrors(contacts: AccountContact[], units: AccountUnit[]): string[] {
  const errors: string[] = [];
  const unitIds = new Set(units.map((u) => u.id));
  const seen = new Set<string>();
  for (const c of contacts) {
    const email = c.email.trim().toLowerCase();
    if (!zEmail.safeParse(email).success) errors.push(`"${c.email || '(blank)'}" is not a valid email address.`);
    else if (seen.has(email)) errors.push(`${email} is listed twice.`);
    seen.add(email);
    if (c.unitId !== null && !unitIds.has(c.unitId)) errors.push(`${email || 'A contact'} refers to a unit that no longer exists.`);
  }
  return errors;
}

export interface ContactsEditorProps {
  contacts: AccountContact[];
  onChange: (contacts: AccountContact[]) => void;
  units: AccountUnit[];
  accountName: string;
  savedIds: ReadonlySet<string>;
}

/** Manager-only: client contacts whose email routes straight to this account (and unit). */
export function ContactsEditor({ contacts, onChange, units, accountName, savedIds }: ContactsEditorProps) {
  const errors = contactErrors(contacts, units);
  const patch = (id: string, change: Partial<AccountContact>) => onChange(contacts.map((c) => (c.id === id ? { ...c, ...change } : c)));
  const unitOptions = units.filter((u) => u.active).map((u) => ({ id: u.id, label: accountLabel({ name: accountName, units }, u.id).split(' › ').slice(1).join(' › ') }));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Mail from a contact routes to this account with no guessing. Contacts are visible to managers only. Archive a contact instead of deleting it so its history stays readable.
      </p>
      {errors.length > 0 ? (
        <Notice tone="danger" role="alert" title="Fix the contacts before saving">
          <ul className="list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {contacts.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-sm text-muted">No contacts yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {contacts.map((c, i) => {
            const label = c.email || `contact ${i + 1}`;
            const badEmail = !zEmail.safeParse(c.email.trim()).success;
            return (
              <li key={c.id} className={cx('grid gap-2 rounded-md border p-2.5 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end', c.active ? 'border-line bg-surface' : 'border-dashed border-line-strong bg-surface-2/50')}>
                <label className="flex flex-col gap-0.5 text-xs font-semibold text-muted">
                  Email
                  <input
                    type="email"
                    value={c.email}
                    onChange={(e) => patch(c.id, { email: e.target.value })}
                    placeholder="name@client.example"
                    aria-invalid={badEmail || undefined}
                    className={cx('h-8 rounded-md border bg-surface px-2 text-sm font-normal text-fg', badEmail ? 'border-danger' : 'border-line-strong')}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-xs font-semibold text-muted">
                  Name
                  <input value={c.name} maxLength={100} onChange={(e) => patch(c.id, { name: e.target.value })} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm font-normal text-fg" />
                </label>
                <label className="flex flex-col gap-0.5 text-xs font-semibold text-muted">
                  Unit
                  <select
                    aria-label={`Unit for ${label}`}
                    value={c.unitId ?? ''}
                    onChange={(e) => patch(c.id, { unitId: e.target.value || null })}
                    className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm font-normal text-fg"
                  >
                    <option value="">Whole account</option>
                    {unitOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-1.5">
                  <label className="inline-flex h-8 items-center gap-1.5 text-sm font-semibold">
                    <input type="checkbox" checked={c.active} onChange={(e) => patch(c.id, { active: e.target.checked })} className="size-4 accent-accent" />
                    Active
                  </label>
                  {savedIds.has(c.id) ? null : (
                    <IconButton label={`Remove ${label}`} size="sm" onClick={() => onChange(contacts.filter((x) => x.id !== c.id))}>
                      <Trash2 />
                    </IconButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button
          size="sm"
          icon={<Plus aria-hidden="true" className="size-4" />}
          disabled={contacts.length >= LIMITS.maxContactsPerAccount}
          onClick={() => onChange([...contacts, { id: newLocalId('con'), email: '', name: '', unitId: null, active: true }])}
        >
          Add contact
        </Button>
      </div>
    </div>
  );
}
