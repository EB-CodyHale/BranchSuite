/** Form state + validation shared by the add dialog and the candidate drawer. */
import { deriveInitials, zCandidateCreateInput, zCandidateUpdateInput, type Candidate, type CandidateUpdateInput } from '@branchsuite/shared';

export interface CandidateFormState {
  firstName: string;
  lastName: string;
  initials: string;
  /** True once the person typed their own initials; until then they follow the name. */
  initialsEdited: boolean;
  phone: string;
  email: string;
  recruiterId: string;
  accountId: string;
  startDate: string;
  notes: string;
}

export type FormErrors = Partial<Record<keyof CandidateFormState, string>>;

export function emptyForm(recruiterId: string, accountId = ''): CandidateFormState {
  return { firstName: '', lastName: '', initials: '', initialsEdited: false, phone: '', email: '', recruiterId, accountId, startDate: '', notes: '' };
}

export function formFromCandidate(c: Candidate): CandidateFormState {
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    initials: c.initials,
    initialsEdited: c.initials !== deriveInitials(c.firstName, c.lastName),
    phone: c.phone,
    email: c.email,
    recruiterId: c.recruiterId ?? '',
    accountId: c.accountId ?? '',
    startDate: c.startDate ?? '',
    notes: c.notes,
  };
}

/** Apply a field edit. Name edits re-derive initials unless the initials were edited by hand. */
export function editForm(state: CandidateFormState, patch: Partial<CandidateFormState>): CandidateFormState {
  const next = { ...state, ...patch };
  if (patch.initials !== undefined) {
    next.initials = patch.initials.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    next.initialsEdited = true;
  }
  if (!next.initialsEdited && (patch.firstName !== undefined || patch.lastName !== undefined || patch.initialsEdited === false)) {
    next.initials = next.firstName.trim() || next.lastName.trim() ? deriveInitials(next.firstName, next.lastName) : '';
  }
  return next;
}

function messageOf(result: { success: boolean; error?: { issues: Array<{ message: string }> } }, fallback: string): string | undefined {
  if (result.success) return undefined;
  return fallback || result.error?.issues[0]?.message;
}

export function validateForm(state: CandidateFormState, mode: 'create' | 'update'): FormErrors {
  const shape = mode === 'create' ? zCandidateCreateInput.shape : zCandidateUpdateInput.shape;
  const errors: FormErrors = {
    firstName: messageOf(shape.firstName.safeParse(state.firstName), 'Enter a first name.'),
    lastName: messageOf(shape.lastName.safeParse(state.lastName), 'Last name is too long.'),
    phone: messageOf(shape.phone.safeParse(state.phone), 'Phone is too long.'),
    email: messageOf(shape.email.safeParse(state.email.trim()), 'Enter a valid email, or leave it blank.'),
    notes: messageOf(shape.notes.safeParse(state.notes), 'Notes are too long.'),
  };
  if (mode === 'update') {
    errors.initials = messageOf(zCandidateUpdateInput.shape.initials.safeParse(state.initials), 'Initials must be 1–4 letters.');
  }
  for (const k of Object.keys(errors) as Array<keyof FormErrors>) if (errors[k] === undefined) delete errors[k];
  return errors;
}

/** Only the fields that changed, in API shape. */
export function diffForm(c: Candidate, s: CandidateFormState): CandidateUpdateInput {
  const out: CandidateUpdateInput = {};
  if (s.firstName.trim() !== c.firstName) out.firstName = s.firstName.trim();
  if (s.lastName.trim() !== c.lastName) out.lastName = s.lastName.trim();
  if (s.initials !== c.initials) out.initials = s.initials;
  if (s.phone.trim() !== c.phone) out.phone = s.phone.trim();
  if (s.email.trim().toLowerCase() !== c.email) out.email = s.email.trim().toLowerCase();
  if ((s.recruiterId || null) !== c.recruiterId) out.recruiterId = s.recruiterId || null;
  if ((s.accountId || null) !== c.accountId) out.accountId = s.accountId || null;
  if ((s.startDate || null) !== c.startDate) out.startDate = s.startDate || null;
  if (s.notes.trim() !== c.notes) out.notes = s.notes.trim();
  return out;
}
