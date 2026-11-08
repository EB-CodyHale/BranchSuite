import { isDayKey, shortDay, todayKey, type MarkerId, type User, type UserUpdateInput } from '@branchsuite/shared';
import { CalendarX, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useMeContext } from '../../app/MeContext.js';
import { dayLabel } from '../../lib/format.js';
import { useBranches, useCreateUser, useUpdateUser, type RosterEntry } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { Dialog } from '../../ui/Dialog.js';
import { Select, TextField } from '../../ui/Field.js';
import { useToast } from '../../ui/Toast.js';
import { MarkerPicker } from './MarkerPicker.js';
import { assignableRoles, duplicateInitials, ROLE_OPTIONS, suggestInitials, takenInitials, validatePerson, type PersonErrors, type PersonForm } from './peopleModel.js';
import { BranchChecklist, ErrorNote, Notice, Switch } from './setupUi.js';

export interface PersonDialogProps {
  /** null creates a new person. */
  person: User | null;
  roster: readonly RosterEntry[];
  /** Branch preselected for a new person and used for "today" in out dates. */
  branchId: string;
  onClose: () => void;
}

export function PersonDialog({ person, roster, branchId, onClose }: PersonDialogProps) {
  const { me, permissions, isAdmin } = useMeContext();
  const { data: allBranches } = useBranches();
  const create = useCreateUser();
  const update = useUpdateUser();
  const { toast } = useToast();
  const isNew = person === null;
  const mutation = isNew ? create : update;

  const [form, setForm] = useState<PersonForm>(() =>
    person
      ? { email: person.email, name: person.name, initials: person.initials, role: person.role, branchIds: person.branchIds, marker: person.marker }
      : { email: '', name: '', initials: '', role: 'member', branchIds: branchId ? [branchId] : [], marker: 'blue' },
  );
  const [initialsTouched, setInitialsTouched] = useState(!isNew);
  const [outDates, setOutDates] = useState<string[]>(person?.outDates ?? []);
  const [newOutDate, setNewOutDate] = useState('');
  const [errors, setErrors] = useState<PersonErrors>({});

  const branches = allBranches ?? me.branches;
  const managed = new Set(permissions.manageBranchIds);
  const branchOptions = branches
    .filter((b) => (b.active && (isAdmin || managed.has(b.id))) || form.branchIds.includes(b.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => ({ id: b.id, name: b.name, code: b.code }));
  // A manager may not add or remove branches they do not manage.
  const locked = isAdmin ? [] : form.branchIds.filter((id) => !managed.has(id));
  const roles = ROLE_OPTIONS.filter((r) => assignableRoles(isAdmin).includes(r.id) || r.id === person?.role);
  const isSelf = person?.id === me.user.id;

  const tz = branches.find((b) => b.id === (form.branchIds[0] ?? branchId))?.timeZone ?? 'America/Chicago';
  const today = todayKey(tz);

  const taken = useMemo(() => takenInitials(roster, form.branchIds, person?.id), [roster, form.branchIds, person?.id]);
  const duplicates = duplicateInitials(roster, form.initials, form.branchIds, person?.id);
  const markerUsage = useMemo(() => {
    const usage: Partial<Record<MarkerId, string[]>> = {};
    for (const p of roster) {
      if (p.id === person?.id || !p.active || !p.branchIds.some((b) => form.branchIds.includes(b))) continue;
      (usage[p.marker] ??= []).push(p.initials);
    }
    return usage;
  }, [roster, form.branchIds, person?.id]);

  const set = <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === 'name' && !initialsTouched) next.initials = suggestInitials(String(v), taken);
      return next;
    });
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = { ...form, email: form.email.trim(), name: form.name.trim(), initials: form.initials.trim().toUpperCase() };
    const found = validatePerson(clean, { id: me.user.id, role: me.user.role, perms: permissions }, person);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    const done = (u: User) => {
      toast({ tone: 'success', title: isNew ? `Added ${u.name}` : `Saved ${u.name}` });
      onClose();
    };
    if (isNew) {
      create.mutate(clean, { onSuccess: done });
      return;
    }
    const input: UserUpdateInput = {};
    if (clean.name !== person.name) input.name = clean.name;
    if (clean.initials !== person.initials) input.initials = clean.initials;
    if (clean.role !== person.role) input.role = clean.role;
    if (clean.marker !== person.marker) input.marker = clean.marker;
    if ([...clean.branchIds].sort().join() !== [...person.branchIds].sort().join()) input.branchIds = clean.branchIds;
    if ([...outDates].sort().join() !== [...person.outDates].sort().join()) input.outDates = [...outDates].sort();
    if (Object.keys(input).length === 0) {
      onClose();
      return;
    }
    update.mutate({ userId: person.id, input }, { onSuccess: done });
  };

  const outToday = outDates.includes(today);
  const addOutDate = () => {
    if (!isDayKey(newOutDate) || outDates.includes(newOutDate)) return;
    setOutDates((d) => [...d, newOutDate].sort());
    setNewOutDate('');
  };

  return (
    <Dialog
      open
      width="40rem"
      onClose={onClose}
      closeOnBackdrop={false}
      title={isNew ? 'Add a person' : `Edit ${person.name}`}
      description={isNew ? 'They sign in with their work account. Initials and marker color identify them on the board.' : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="person-form" loading={mutation.isPending}>
            {isNew ? 'Add person' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="person-form" noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <ErrorNote error={mutation.error} />
        {errors.form ? <Notice tone="danger" role="alert" title={errors.form} /> : null}
        <TextField
          label="Work email"
          type="email"
          autoComplete="off"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          disabled={!isNew}
          required
          error={errors.email}
          hint={isNew ? 'Must match their Microsoft sign-in.' : 'Email cannot change. Add a new person instead.'}
        />
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          <TextField label="Name" autoComplete="off" value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={100} error={errors.name} />
          <TextField
            label="Initials"
            value={form.initials}
            onChange={(e) => {
              setInitialsTouched(true);
              set('initials', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
            }}
            required
            maxLength={4}
            inputClassName="font-display text-lg font-bold tracking-wider uppercase"
            error={errors.initials}
            hint={initialsTouched ? undefined : 'Suggested from the name.'}
          />
        </div>
        {duplicates.length > 0 ? (
          <Notice tone="warning" role="status" title={`${form.initials} is already used in this branch`}>
            {duplicates.map((d) => d.name).join(', ')} {duplicates.length === 1 ? 'has' : 'have'} the same initials. Lines on the board would look alike. Consider a third letter.
          </Notice>
        ) : null}

        <Select
          label="Role"
          value={form.role}
          onChange={(e) => set('role', e.target.value as PersonForm['role'])}
          disabled={isSelf}
          options={roles.map((r) => ({ value: r.id, label: r.label }))}
          error={errors.role}
          hint={isSelf ? 'You cannot change your own role.' : ROLE_OPTIONS.find((r) => r.id === form.role)?.hint}
        />

        <BranchChecklist
          legend="Branches"
          options={branchOptions}
          value={form.branchIds}
          onChange={(ids) => set('branchIds', ids)}
          locked={locked}
          error={errors.branchIds}
          hint={isAdmin ? undefined : 'You can assign only branches you manage.'}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">
            Marker color
          </span>
          <MarkerPicker value={form.marker} onChange={(m) => set('marker', m)} usage={markerUsage} />
          <p className="text-xs text-muted">The ink color of everything they write on the board. A number shows how many teammates already use it.</p>
        </div>

        {isNew ? null : (
          <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
            <legend className="px-1 font-display text-lg font-semibold">Out of office</legend>
            <Switch
              checked={outToday}
              onChange={(v) => setOutDates((d) => (v ? [...d, today].sort() : d.filter((x) => x !== today)))}
              label="Out today"
              description="Their open tasks show as unattended and the board flags them as out."
            />
            <div className="flex flex-wrap items-end gap-2">
              <TextField label="Add a day out" type="date" value={newOutDate} min={today} onChange={(e) => setNewOutDate(e.target.value)} className="min-w-[11rem]" />
              <Button size="md" onClick={addOutDate} disabled={!isDayKey(newOutDate) || outDates.includes(newOutDate) || outDates.length >= 60}>
                Add day
              </Button>
            </div>
            {outDates.length > 0 ? (
              <ul aria-label="Days out" className="flex flex-wrap gap-1.5">
                {outDates.map((d) => (
                  <li key={d} className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface-2 py-0.5 pl-2 pr-0.5 text-sm font-medium tabular-nums">
                    <CalendarX aria-hidden="true" className="size-3.5 text-subtle" />
                    {dayLabel(d, today) || shortDay(d)}
                    <button type="button" aria-label={`Remove ${d}`} onClick={() => setOutDates((list) => list.filter((x) => x !== d))} className="inline-flex size-5 items-center justify-center rounded-sm text-muted hover:bg-surface hover:text-fg">
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No days out scheduled.</p>
            )}
          </fieldset>
        )}
      </form>
    </Dialog>
  );
}
