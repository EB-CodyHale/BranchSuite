/**
 * Azure Static Web Apps client principal (`x-ms-client-principal`, base64 JSON).
 * SWA strips any client-supplied copy of this header and sets it for linked backends, so its
 * presence is trusted; its content is still validated strictly.
 */
import { z } from 'zod';
import { unauthenticated } from '../http/errors.js';

const OID_CLAIMS = ['http://schemas.microsoft.com/identity/claims/objectidentifier', 'oid'];
const EMAIL_CLAIMS = ['preferred_username', 'email', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'];

const zPrincipal = z.object({
  identityProvider: z.string(),
  userId: z.string().optional(),
  userDetails: z.string().optional(),
  userRoles: z.array(z.string()).default([]),
  claims: z.array(z.object({ typ: z.string(), val: z.string() })).default([]),
});

export interface StaffIdentity {
  /** Entra object id; null when SWA did not forward claims (then the roster is matched by email only). */
  oid: string | null;
  /** Lowercased sign-in email / UPN. */
  email: string;
}

/** Returns null when the header is absent; throws 401 when it is present but unusable. */
export function parseClientPrincipal(header: string | undefined): StaffIdentity | null {
  if (!header) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    throw unauthenticated('The sign-in information could not be read. Sign in again.');
  }
  const parsed = zPrincipal.safeParse(raw);
  if (!parsed.success) throw unauthenticated('The sign-in information is incomplete. Sign in again.');
  const p = parsed.data;
  if (p.identityProvider !== 'aad' || !p.userRoles.includes('authenticated')) {
    throw unauthenticated('Sign in with your work account.');
  }
  const claim = (types: string[]) => {
    for (const t of types) {
      const value = p.claims.find((c) => c.typ === t)?.val?.trim();
      if (value) return value;
    }
    return undefined;
  };
  const oid = claim(OID_CLAIMS);
  const email = (claim(EMAIL_CLAIMS) ?? p.userDetails ?? '').trim().toLowerCase();
  if (!email.includes('@')) throw unauthenticated('The sign-in information is incomplete. Sign in again.');
  return { oid: oid ?? null, email };
}
