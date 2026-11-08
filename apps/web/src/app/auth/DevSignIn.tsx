import { ROLES, type Role } from '@branchsuite/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage, setDevUser, type ApiError } from '../../lib/api.js';
import { keys } from '../../lib/queryKeys.js';
import { Button } from '../../ui/Button.js';
import { TextField } from '../../ui/Field.js';
import { Spinner } from '../../ui/Spinner.js';
import { ProductMark } from '../ProductMark.js';

/** Row returned by the dev-only GET /api/dev/users (AUTH_MODE=dev). */
export interface DevUser {
  email: string;
  name: string;
  role: Role;
}

const DEV_USERS_PATH = '/api/dev/users';

function isDevUser(v: unknown): v is DevUser {
  if (typeof v !== 'object' || v === null) return false;
  const u = v as Record<string, unknown>;
  return typeof u.email === 'string' && typeof u.name === 'string' && typeof u.role === 'string' && (ROLES as readonly string[]).includes(u.role);
}

const ROLE_ORDER: Record<Role, number> = { admin: 0, manager: 1, member: 2 };

/** Local development sign-in: choose a seeded roster user; requests then carry x-dev-user. */
export function DevSignIn() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const users = useQuery<DevUser[], ApiError>({
    queryKey: keys.devUsers(),
    queryFn: async ({ signal }) => {
      const rows = await api.get<unknown>(DEV_USERS_PATH, { signal });
      return (Array.isArray(rows) ? rows.filter(isDevUser) : []).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
    },
    retry: false,
  });

  const signInAs = (address: string) => {
    setDevUser(address.trim().toLowerCase());
    void qc.resetQueries();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim()) signInAs(email);
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-card">
        <ProductMark />
        <h1 className="mt-5 font-display text-2xl font-semibold">Sign in as…</h1>
        <p className="mt-1 text-sm text-muted">Local development only. Pick a fictional roster user from the dev seed.</p>

        <div className="mt-5">
          {users.isPending ? (
            <Spinner label="Loading dev users" />
          ) : users.isError ? (
            <p className="text-sm text-danger" role="alert">
              Could not load dev users: {errorMessage(users.error)}
            </p>
          ) : users.data.length === 0 ? (
            <p className="text-sm text-muted">The dev API returned no users.</p>
          ) : (
            <ul className="flex flex-col gap-1.5" aria-label="Dev users">
              {users.data.map((u) => (
                <li key={u.email}>
                  <button
                    type="button"
                    onClick={() => signInAs(u.email)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-left hover:border-line-strong hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{u.name}</span>
                      <span className="block truncate text-xs text-muted">{u.email}</span>
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-subtle">{u.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={onSubmit} className="mt-6 flex items-end gap-2 border-t border-line pt-5">
          <TextField className="flex-1" label="Or enter an email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          <Button type="submit" variant="primary" disabled={!email.trim()}>
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
