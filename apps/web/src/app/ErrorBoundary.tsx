import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { errorMessage } from '../lib/api.js';
import { Button } from '../ui/Button.js';

export function ErrorPanel({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-12 text-center">
      <TriangleAlert aria-hidden="true" className="size-8 text-danger" />
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <p className="text-sm text-muted">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="primary" icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

class Boundary extends Component<BoundaryProps, { error: unknown }> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  private reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error !== null) return <ErrorPanel title="This view hit a problem" error={this.state.error} onRetry={this.reset} />;
    return this.props.children;
  }
}

/** Catches render errors in a subtree; "Try again" resets the boundary and failed queries. */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  return <QueryErrorResetBoundary>{({ reset }) => <Boundary onReset={reset}>{children}</Boundary>}</QueryErrorResetBoundary>;
}

/** Router-level fallback (errors outside a feature boundary, unknown loaders). */
export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? new Error(`${error.status} ${error.statusText}`) : error;
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <ErrorPanel title="Something went wrong" error={message} onRetry={() => window.location.reload()} />
    </main>
  );
}
