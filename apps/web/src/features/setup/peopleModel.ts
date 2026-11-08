/** Pure helpers for the People section (initials, duplicates, role choices). */
import { canEditUser, LIMITS, zUserCreateInput, type Permissions, type Role, type User } from '@branchsuite/shared';
import type { RosterEntry } from '../../lib/queries.js';

export const ROLE_OPTIONS: ReadonlyArray<{ id: Role; label: string; hint: string }> = [
  { id: 'member', label: 'Team member', hint: 'Writes on lines, works tasks and the pipeline.' },
  { id: 'manager', label: 'Branch manager', hint: 'Also creates orders and runs setup for their branches.' },
  { id: 'admin', label: 'Admin', hint: 'Every branch, mailboxes, imports and other admins.' },
];

/** Roles the actor may hand out. Only admins can grant admin. */
export function assignableRoles(actorIsAdmin: boolean): Role[] {
  return actorIsAdmin ? ['member', 'manager', 'admin'] : ['member', 'manager'];
}

const lettersOf = (word: string) => word.normalize('NFKD').replace(/[^A-Za-z]/g, '').toUpperCase();

/**
 * Suggested board initials from a name: first + last word ("Avery Quinn" -> "AQ"). When that is
 * taken, try first two letters + last ("AVQ"), then all word initials. Always 1-4 letters, or ''.
 */
export function suggestInitials(name: string, taken: ReadonlySet<string> = new Set()): string {
  const words = name.trim().split(/\s+/).map(lettersOf).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0]!;
  const last = words.length > 1 ? words[words.length - 1]! : '';
  const candidates = [
    last ? `${first[0]}${last[0]}` : first.slice(0, 2),
    last ? `${first.slice(0, 2)}${last[0]}` : first.slice(0, 3),
    words.map((w) => w[0]).join(''),
    last ? `${first[0]}${last.slice(0, 2)}` : first.slice(0, 4),
  ].map((c) => c.slice(0, LIMITS.maxInitialsLength));
  return candidates.find((c) => c && !taken.has(c)) ?? candidates[0]!;
}

/** Initials already used by other active people who share one of `branchIds`. */
export function takenInitials(roster: readonly RosterEntry[], branchIds: readonly string[], excludeId?: string): Set<string> {
  const set = new Set<string>();
  for (const p of roster) {
    if (p.id === excludeId || !p.active) continue;
    if (p.branchIds.some((b) => branchIds.includes(b))) set.add(p.initials);
  }
  return set;
}

/** Names of active people sharing a branch who already use these initials. */
export function duplicateInitials(roster: readonly RosterEntry[], initials: string, branchIds: readonly string[], excludeId?: string): RosterEntry[] {
  const want = initials.trim().toUpperCase();
  if (!want) return [];
  return roster.filter((p) => p.id !== excludeId && p.active && p.initials === want && p.branchIds.some((b) => branchIds.includes(b)));
}

export interface PersonForm {
  email: string;
  name: string;
  initials: string;
  role: Role;
  branchIds: string[];
  marker: User['marker'];
}

export type PersonErrors = Partial<Record<keyof PersonForm | 'form', string>>;

/**
 * Client-side check before POST/PATCH: the shared zod schema for field shape, then the shared
 * permission rule (managers cannot grant admin or assign branches they do not manage).
 */
export function validatePerson(
  form: PersonForm,
  actor: { id: string; role: Role; perms: Permissions },
  target: Pick<User, 'id' | 'role' | 'branchIds'> | null,
): PersonErrors {
  const errors: PersonErrors = {};
  const parsed = zUserCreateInput.safeParse(form);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof PersonForm | undefined;
      if (!key || errors[key]) continue;
      errors[key] = FIELD_MESSAGES[key] ?? issue.message;
    }
  }
  const verdict = canEditUser({ id: actor.id, role: actor.role, perms: actor.perms }, target, { role: form.role, branchIds: form.branchIds });
  if (!verdict.ok) {
    if (form.role === 'admin' && actor.role !== 'admin') errors.role = verdict.reason;
    else if (!errors.branchIds && /branch/i.test(verdict.reason)) errors.branchIds = verdict.reason;
    else errors.form = verdict.reason;
  }
  return errors;
}

const FIELD_MESSAGES: Partial<Record<keyof PersonForm, string>> = {
  email: 'Enter a valid work email address.',
  name: 'Enter the person’s name.',
  initials: 'Initials are 1-4 letters A-Z.',
  branchIds: 'Choose at least one branch.',
  marker: 'Pick a marker color.',
};

/**
 * Names of a person's branches for the roster. Branches the viewer cannot see have no name here; they
 * are counted ("+1 other branch") rather than shown as raw ids.
 */
export function branchListLabel(branchIds: readonly string[], names: ReadonlyMap<string, string>): string {
  const known = branchIds.flatMap((id) => {
    const name = names.get(id);
    return name ? [name] : [];
  });
  const hidden = branchIds.length - known.length;
  if (hidden > 0) known.push(`+${hidden} other ${hidden === 1 ? 'branch' : 'branches'}`);
  return known.join(', ');
}
