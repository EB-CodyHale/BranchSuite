import { canEditUser, todayKey, type User } from '@branchsuite/shared';
import { CalendarX, MoreHorizontal, Pencil, Plus, UserCheck, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ROLE_LABELS } from '../../app/AppShell.js';
import { useMeContext } from '../../app/MeContext.js';
import { isFullUser, useUpdateUser, useUsers, type RosterEntry } from '../../lib/queries.js';
import { Badge } from '../../ui/Badge.js';
import { Button } from '../../ui/Button.js';
import { ToggleChip } from '../../ui/Chip.js';
import { ConfirmDialog } from '../../ui/ConfirmDialog.js';
import { cx } from '../../ui/cx.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { MarkerDot, markerLabel } from '../../ui/MarkerDot.js';
import { Menu, MenuItem } from '../../ui/Menu.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';
import { PersonDialog } from './PersonDialog.js';
import { useSetupBranch } from './SetupBranchContext.js';
import { ErrorNote, SectionHeader } from './setupUi.js';

export function PeopleSection() {
  const { me, permissions, isAdmin } = useMeContext();
  const { branchId, branch, branches } = useSetupBranch();
  // The whole visible roster: needed for duplicate-initials checks across a person's branches.
  const roster = useUsers();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [toggling, setToggling] = useState<User | null>(null);
  const update = useUpdateUser();
  const { toast } = useToast();

  const today = todayKey(branch?.timeZone ?? 'America/Chicago');
  const branchName = useMemo(() => new Map([...me.branches, ...branches].map((b) => [b.id, b.name])), [me.branches, branches]);
  const all = roster.data ?? [];
  const inBranch = all.filter((p) => p.branchIds.includes(branchId));
  const rows = inBranch
    .filter((p) => showInactive || p.active)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const inactiveCount = inBranch.filter((p) => !p.active).length;
  const actor = { id: me.user.id, role: me.user.role, perms: permissions };
  const editable = (p: RosterEntry): p is User => isFullUser(p) && canEditUser(actor, p, {}).ok;

  const setActive = (p: User, active: boolean) =>
    update.mutate(
      { userId: p.id, input: { active } },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: active ? `${p.name} reactivated` : `${p.name} deactivated` });
          setToggling(null);
        },
        onError: (e) => toast({ tone: 'danger', title: `Could not update ${p.name}`, description: e.message }),
      },
    );

  return (
    <div>
      <SectionHeader
        title="People"
        branchScoped
        description="Who can sign in, their role, and the marker color their writing shows in on the board."
        actions={
          <>
            {inactiveCount > 0 ? (
              <ToggleChip pressed={showInactive} onPressedChange={setShowInactive} count={inactiveCount}>
                Show inactive
              </ToggleChip>
            ) : null}
            <Button variant="primary" size="sm" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEditing('new')}>
              Add person
            </Button>
          </>
        }
      />
      <ErrorNote error={roster.error} className="mb-3" />
      {roster.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Nobody here yet" description="Add the recruiters and managers who work this branch." />
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">People in {branch?.name}</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wider text-subtle">
                <th scope="col" className="px-3 py-2">Person</th>
                <th scope="col" className="px-3 py-2">Initials</th>
                <th scope="col" className="px-3 py-2">Marker</th>
                <th scope="col" className="px-3 py-2">Role</th>
                <th scope="col" className="px-3 py-2">Branches</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const out = p.outDates.includes(today);
                const canEdit = editable(p);
                return (
                  <tr key={p.id} className={cx('border-b border-line last:border-b-0', !p.active && 'text-muted')}>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="flex items-center gap-2.5">
                        <MarkerDot marker={p.marker} label={null} size="lg" />
                        <span className="min-w-0">
                          <span className="block font-semibold text-fg">{p.name}</span>
                          {isFullUser(p) ? <span className="block truncate text-xs text-muted">{p.email}</span> : null}
                        </span>
                      </span>
                    </th>
                    <td className="px-3 py-2 font-display text-base font-bold tracking-wider">{p.initials}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <MarkerDot marker={p.marker} label={null} size="sm" />
                        {markerLabel(p.marker)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{ROLE_LABELS[p.role]}</td>
                    <td className="max-w-[14rem] px-3 py-2">
                      <span className="line-clamp-2">{p.branchIds.map((id) => branchName.get(id) ?? id).join(', ')}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {p.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                        {out && p.active ? (
                          <Badge tone="warning" icon={<CalendarX />}>
                            Out today
                          </Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {canEdit ? (
                        <span className="inline-flex items-center gap-1">
                          <Button size="sm" variant="ghost" icon={<Pencil aria-hidden="true" className="size-4" />} onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                            <span className="max-sm:sr-only">Edit</span>
                          </Button>
                          {p.id === me.user.id ? null : (
                            <Menu
                              label={`More for ${p.name}`}
                              trigger={(props) => (
                                <button {...props} type="button" aria-label={`More actions for ${p.name}`} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
                                  <MoreHorizontal aria-hidden="true" className="size-4" />
                                </button>
                              )}
                            >
                              {p.active ? (
                                <MenuItem icon={<UserX />} onSelect={() => setToggling(p)}>
                                  Deactivate
                                </MenuItem>
                              ) : (
                                <MenuItem icon={<UserCheck />} onSelect={() => setActive(p, true)}>
                                  Reactivate
                                </MenuItem>
                              )}
                            </Menu>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-subtle">{p.role === 'admin' && !isAdmin ? 'Admin-managed' : ''}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing ? <PersonDialog person={editing === 'new' ? null : editing} roster={all} branchId={branchId} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={toggling !== null}
        title={`Deactivate ${toggling?.name ?? ''}?`}
        tone="danger"
        confirmLabel="Deactivate"
        loading={update.isPending}
        onCancel={() => setToggling(null)}
        onConfirm={() => toggling && setActive(toggling, false)}
        description={
          <div className="space-y-2">
            <p>They lose access on their next request. Their name stays on past lines and history.</p>
            <p>Accounts and units they own keep them as owner until you change it.</p>
          </div>
        }
      />
    </div>
  );
}
