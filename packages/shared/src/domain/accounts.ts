/**
 * Account directory rules and deterministic email routing.
 */
import type { RoutingTestResult } from '../api.js';
import { LIMITS } from '../constants.js';
import type { Account, AccountUnit, Routing } from '../schemas.js';

/** Units from the given unit up to the root (unit first). Max LIMITS.maxUnitDepth, cycle-safe. [] if not found. */
export function unitPath(account: Pick<Account, 'units'>, unitId: string | null): AccountUnit[] {
  if (unitId === null) return [];
  const byId = new Map(account.units.map((u) => [u.id, u] as const));
  const path: AccountUnit[] = [];
  const seen = new Set<string>();
  let current = byId.get(unitId);
  while (current && !seen.has(current.id) && path.length < LIMITS.maxUnitDepth) {
    path.push(current);
    seen.add(current.id);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return path;
}

/** "Account › Parent › Unit" display label. */
export function accountLabel(account: Pick<Account, 'name' | 'units'>, unitId: string | null): string {
  const names = unitPath(account, unitId)
    .map((u) => u.name)
    .reverse();
  return [account.name, ...names].join(' › ');
}

/** Validation errors for a unit tree: unknown parent, cycle, depth > maxUnitDepth, duplicate ids. [] when valid. */
export function validateUnits(units: AccountUnit[]): string[] {
  const errors: string[] = [];
  const byId = new Map<string, AccountUnit>();
  const duplicates = new Set<string>();
  for (const u of units) {
    if (byId.has(u.id)) duplicates.add(u.id);
    else byId.set(u.id, u);
  }
  for (const id of duplicates) errors.push(`Duplicate unit id "${id}".`);

  const reportedCycles = new Set<string>();
  for (const u of byId.values()) {
    if (u.parentId !== null && !byId.has(u.parentId)) {
      errors.push(`Unit "${u.name}" has an unknown parent "${u.parentId}".`);
      continue;
    }
    // Walk to the root. `chain` holds the ancestry in visit order so a cycle can be isolated.
    const chain: AccountUnit[] = [];
    const index = new Map<string, number>();
    let node: AccountUnit | undefined = u;
    let brokenAncestor = false;
    while (node && !index.has(node.id)) {
      index.set(node.id, chain.length);
      chain.push(node);
      if (node.parentId === null) {
        node = undefined;
      } else {
        const parent = byId.get(node.parentId);
        if (!parent) brokenAncestor = true; // reported on that ancestor
        node = parent;
      }
    }
    if (node) {
      // Revisited a unit: the cycle is chain[start..]. Report each cycle once, only from a member.
      const members = chain.slice(index.get(node.id));
      if (index.get(node.id) === 0) {
        const key = members.map((m) => m.id).sort().join('|');
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          errors.push(`Units form a cycle: ${members.map((m) => `"${m.name}"`).join(' → ')}.`);
        }
      }
      continue;
    }
    if (!brokenAncestor && chain.length > LIMITS.maxUnitDepth) {
      errors.push(`Unit "${u.name}" is nested ${chain.length} levels deep; the maximum is ${LIMITS.maxUnitDepth}.`);
    }
  }
  return errors;
}

export interface RouteEmailInput { fromAddress: string; subject: string; body: string; internalDomains?: string[]; }

type Candidate = Routing['candidates'][number];

/** Minimum normalized length for a name or alias to count as a text match (avoids short-token false hits). */
const MIN_TERM_LENGTH = 3;
const MAX_CANDIDATES = 10;
const MAX_REASON = 200;

/** NFKD, strip diacritics, lowercase, non-alphanumerics to single spaces, padded for whole-word search. */
function normalizeText(s: string): string {
  const core = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${core} `;
}

/** Whole-word, case-insensitive search for any of `terms` in normalized text. Returns the first hit. */
function findTerm(terms: string[], text: string): string | null {
  for (const term of terms) {
    const t = normalizeText(term);
    if (t.trim().length >= MIN_TERM_LENGTH && text.includes(t)) return term;
  }
  return null;
}

function parseSender(fromAddress: string): { address: string; domain: string | null } {
  const raw = fromAddress.trim();
  const bracketed = /<([^<>]+)>/.exec(raw);
  const address = (bracketed?.[1] ?? raw).trim().toLowerCase();
  const at = address.lastIndexOf('@');
  const domain = at > 0 && at < address.length - 1 ? address.slice(at + 1) : null;
  return { address, domain };
}

function reason(text: string): string {
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text;
}

interface TextHit {
  /** Matched the account name/alias or a unit name/alias. */
  matched: boolean;
  /** The match appears in the subject line. */
  inSubject: boolean;
  term: string | null;
  /** Active units whose name or alias was found. */
  unitIds: string[];
}

function textHitsFor(account: Account, subject: string, all: string): TextHit {
  const accountTerms = [account.name, ...account.aliases];
  const accountTerm = findTerm(accountTerms, all);
  let inSubject = accountTerm !== null && findTerm(accountTerms, subject) !== null;
  let term = accountTerm;
  const unitIds: string[] = [];
  for (const unit of account.units) {
    if (!unit.active) continue;
    const unitTerms = [unit.name, ...unit.aliases];
    const hit = findTerm(unitTerms, all);
    if (hit === null) continue;
    unitIds.push(unit.id);
    term ??= hit;
    if (findTerm(unitTerms, subject) !== null) inSubject = true;
  }
  return { matched: term !== null, inSubject, term, unitIds };
}

/**
 * Deterministic routing over ACTIVE accounts (never guesses):
 * 1. Reserved: sender domain in internalDomains -> 'internal' reserved account if present.
 *    (Payroll routing is sender-contact based: a contact on the reserved 'payroll' account.)
 * 2. Exact contact email match (active contacts) -> account (+ contact.unitId). One match -> 'matched'.
 *    Multiple accounts -> try alias narrowing (step 4) else 'ambiguous' with all candidates.
 * 3. Sender domain in account.domains -> parent account only (unitId null). One -> 'matched'; several -> narrow/ambiguous.
 * 4. Alias narrowing: account/unit names and aliases found as whole words (case-insensitive) in subject+body.
 *    Narrowing may only select among existing candidates (or among all accounts if there were none, but then
 *    result is at most 'ambiguous' unless exactly one account alias AND the subject contains it -> 'matched').
 *    A unit alias match under a matched account selects that unit when unique.
 * 5. Otherwise 'unmatched'.
 * explanation: human-readable steps taken. Candidates capped at 10.
 *
 * Names and aliases shorter than 3 normalized characters never match text.
 */
export function routeEmail(input: RouteEmailInput, accounts: Account[]): RoutingTestResult {
  const explanation: string[] = [];
  const active = accounts.filter((a) => a.active);
  const clients = active.filter((a) => a.reserved === null);
  const byId = new Map(active.map((a) => [a.id, a] as const));
  const { address, domain } = parseSender(input.fromAddress);
  const subjectText = normalizeText(input.subject);
  const allText = normalizeText(`${input.subject}\n${input.body}`);
  const hitCache = new Map<string, TextHit>();
  const hits = (a: Account): TextHit => {
    let h = hitCache.get(a.id);
    if (!h) {
      h = textHitsFor(a, subjectText, allText);
      hitCache.set(a.id, h);
    }
    return h;
  };

  const done = (status: Routing['status'], candidates: Candidate[]): RoutingTestResult => ({
    routing: { status, candidates: candidates.slice(0, MAX_CANDIDATES) },
    explanation,
  });

  /** For a single matched account with no unit yet, select a unit if exactly one unit name/alias is in the text. */
  const withUnit = (c: Candidate): Candidate => {
    if (c.unitId !== null) return c;
    const account = byId.get(c.accountId);
    if (!account) return c;
    const units = hits(account).unitIds;
    if (units.length === 1) {
      const unit = account.units.find((u) => u.id === units[0]);
      explanation.push(`Unit "${unit?.name ?? units[0]}" is named in the message; selected it.`);
      return { ...c, unitId: units[0] ?? null, reason: reason(`${c.reason}; unit named in message`) };
    }
    if (units.length > 1) explanation.push(`Several units of "${account.name}" are named in the message; unit left unset.`);
    return c;
  };

  /** Narrow existing candidates (several accounts) by names/aliases in the text. */
  const narrow = (candidates: Candidate[], source: string): RoutingTestResult => {
    const accountIds = [...new Set(candidates.map((c) => c.accountId))];
    const narrowed = accountIds.filter((id) => {
      const a = byId.get(id);
      return a !== undefined && hits(a).matched;
    });
    if (narrowed.length === 1) {
      const id = narrowed[0] as string;
      const account = byId.get(id) as Account;
      explanation.push(`${source} matched ${accountIds.length} accounts; "${hits(account).term}" in the message narrows it to "${account.name}".`);
      const own = candidates.filter((c) => c.accountId === id);
      const unitIds = [...new Set(own.map((c) => c.unitId))];
      const base: Candidate = {
        accountId: id,
        unitId: unitIds.length === 1 ? (unitIds[0] ?? null) : null,
        reason: reason(`${own[0]?.reason ?? source}; narrowed by "${hits(account).term}"`),
      };
      return done('matched', [withUnit(base)]);
    }
    explanation.push(
      narrowed.length === 0
        ? `${source} matched ${accountIds.length} accounts and no account name or alias in the message narrows it. Needs review.`
        : `${source} matched ${accountIds.length} accounts and the message names ${narrowed.length} of them. Needs review.`,
    );
    return done('ambiguous', candidates);
  };

  // 1. Reserved internal sender.
  const internalDomains = (input.internalDomains ?? []).map((d) => d.trim().toLowerCase().replace(/^@/, ''));
  if (domain !== null && internalDomains.includes(domain)) {
    const internal = active.find((a) => a.reserved === 'internal');
    if (internal) {
      explanation.push(`Sender domain "${domain}" is internal; routed to the reserved Internal account.`);
      return done('matched', [{ accountId: internal.id, unitId: null, reason: reason(`Internal sender domain ${domain}`) }]);
    }
    explanation.push(`Sender domain "${domain}" is internal, but the branch has no active Internal account; continuing.`);
  }

  // 2. Exact contact match (any active account, including the reserved Payroll account).
  const contactCandidates: Candidate[] = [];
  for (const account of active) {
    for (const contact of account.contacts ?? []) {
      if (!contact.active || contact.email.trim().toLowerCase() !== address) continue;
      const unit = contact.unitId === null ? undefined : account.units.find((u) => u.id === contact.unitId && u.active);
      const label = contact.name ? `Sender is contact ${contact.name}` : 'Sender is a contact';
      if (!contactCandidates.some((c) => c.accountId === account.id && c.unitId === (unit?.id ?? null))) {
        contactCandidates.push({ accountId: account.id, unitId: unit?.id ?? null, reason: reason(label) });
      }
    }
  }
  if (contactCandidates.length > 0) {
    const accountIds = new Set(contactCandidates.map((c) => c.accountId));
    if (accountIds.size === 1) {
      const account = byId.get(contactCandidates[0]?.accountId as string) as Account;
      explanation.push(`Sender ${address} is an active contact on "${account.name}".`);
      if (contactCandidates.length === 1) return done('matched', [withUnit(contactCandidates[0] as Candidate)]);
      // Several contact records on one account with different units: pick by unit name in the text if possible.
      const named = contactCandidates.filter((c) => c.unitId !== null && hits(account).unitIds.includes(c.unitId));
      if (named.length === 1) {
        explanation.push('The message names one of the contact\'s units; selected it.');
        return done('matched', [named[0] as Candidate]);
      }
      explanation.push('The contact belongs to several units of this account; unit left unset.');
      return done('matched', [{ accountId: account.id, unitId: null, reason: contactCandidates[0]?.reason ?? 'Sender is a contact' }]);
    }
    return narrow(contactCandidates, `Sender ${address} is a contact on several accounts:`);
  }
  explanation.push(`No active contact matches ${address || 'the sender'}.`);

  // 3. Sender domain → parent account only.
  if (domain !== null) {
    const domainAccounts = clients.filter((a) => a.domains.some((d) => d.toLowerCase() === domain));
    if (domainAccounts.length === 1) {
      const account = domainAccounts[0] as Account;
      explanation.push(`Sender domain "${domain}" belongs to "${account.name}".`);
      return done('matched', [withUnit({ accountId: account.id, unitId: null, reason: reason(`Sender domain ${domain}`) })]);
    }
    if (domainAccounts.length > 1) {
      return narrow(
        domainAccounts.map((a) => ({ accountId: a.id, unitId: null, reason: reason(`Sender domain ${domain}`) })),
        `Sender domain "${domain}"`,
      );
    }
    explanation.push(`No account lists the domain "${domain}".`);
  }

  // 4. Names and aliases in the message, across all customer accounts.
  const named = clients.filter((a) => hits(a).matched);
  if (named.length === 0) {
    explanation.push('No account or unit name or alias appears in the message. Unmatched.');
    return done('unmatched', []);
  }
  const textCandidates = named.map((a) => {
    const h = hits(a);
    return {
      accountId: a.id,
      unitId: h.unitIds.length === 1 ? (h.unitIds[0] ?? null) : null,
      reason: reason(`"${h.term}" appears in the ${h.inSubject ? 'subject' : 'message'}`),
    };
  });
  if (named.length === 1) {
    const account = named[0] as Account;
    if (hits(account).inSubject) {
      explanation.push(`Only "${account.name}" is named, and the subject contains "${hits(account).term}".`);
      return done('matched', textCandidates);
    }
    explanation.push(`Only "${account.name}" is named, but only in the body. Needs review.`);
    return done('ambiguous', textCandidates);
  }
  explanation.push(`The message names ${named.length} accounts. Needs review.`);
  return done('ambiguous', textCandidates);
}
