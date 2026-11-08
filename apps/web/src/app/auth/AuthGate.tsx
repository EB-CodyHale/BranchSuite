import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { isApiError } from '../../lib/api.js';
import { useMe } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { Spinner } from '../../ui/Spinner.js';
import { BranchScopeProvider } from '../BranchScope.js';
import { ErrorPanel } from '../ErrorBoundary.js';
import { MeProvider } from '../MeContext.js';
import { ProductMark } from '../ProductMark.js';
import { ShellSkeleton } from '../ShellSkeleton.js';
import { DevSignIn } from './DevSignIn.js';
import { loginUrl, signOut } from './session.js';

/**
 * Resolves the signed-in roster user before anything else renders.
 * 401 -> sign in (dev picker locally, Entra redirect in Azure); 403 not_provisioned -> roster screen.
 */
export function AuthGate() {
  const me = useMe();

  if (me.isPending) return <ShellSkeleton />;

  // A failed background refetch keeps the app usable unless the session itself is gone.
  const sessionError = me.isError && (isApiError(me.error, 'unauthenticated') || isApiError(me.error, 'not_provisioned'));
  if (me.data && !sessionError) {
    return (
      <MeProvider me={me.data}>
        <BranchScopeProvider>
          <Outlet />
        </BranchScopeProvider>
      </MeProvider>
    );
  }

  if (isApiError(me.error, 'unauthenticated')) return import.meta.env.DEV ? <DevSignIn /> : <SignInRedirect />;
  if (isApiError(me.error, 'not_provisioned')) return <NotProvisioned />;
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <ErrorPanel title="BranchSuite could not load" error={me.error} onRetry={() => void me.refetch()} />
    </main>
  );
}

function SignInRedirect() {
  useEffect(() => {
    window.location.assign(loginUrl());
  }, []);
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="flex items-center gap-3 text-muted">
        <Spinner label={null} />
        <span role="status">Redirecting to sign-in…</span>
      </div>
    </main>
  );
}

export function NotProvisioned() {
  const qc = useQueryClient();
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-card">
        <ProductMark />
        <h1 className="mt-5 font-display text-2xl font-semibold">You're signed in, but not on the roster</h1>
        <p className="mt-2 text-muted">Ask your branch manager to add you to BranchSuite. Once they do, reload this page.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button onClick={() => signOut(() => void qc.resetQueries())}>{import.meta.env.DEV ? 'Switch dev user' : 'Sign out'}</Button>
        </div>
      </div>
    </main>
  );
}
