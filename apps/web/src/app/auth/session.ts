/** Static Web Apps auth endpoints (Entra ID provider registered as "aad"). */
import { setDevUser } from '../../lib/api.js';

export function loginUrl(returnTo: string = currentPath()): string {
  return `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(returnTo)}`;
}

export const LOGOUT_URL = '/.auth/logout?post_logout_redirect_uri=/';

function currentPath(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

/**
 * Sign out. In local development this forgets the picked dev user and returns to the picker;
 * in Azure it ends the Static Web Apps session.
 */
export function signOut(resetClientState: () => void): void {
  if (import.meta.env.DEV) {
    setDevUser(null);
    resetClientState();
    return;
  }
  window.location.assign(LOGOUT_URL);
}
