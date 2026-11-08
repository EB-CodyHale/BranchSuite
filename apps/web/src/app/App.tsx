import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation, type RouteObject } from 'react-router-dom';
import { ToastProvider } from '../ui/Toast.js';
import { Spinner } from '../ui/Spinner.js';
import { RouteErrorPage } from './ErrorBoundary.js';
import { RequireManager, RequirePipeline } from './guards.js';
import { ShellSkeleton } from './ShellSkeleton.js';
import { createQueryClient } from './queryClient.js';

/** React.lazy for a named export: each feature folder becomes its own chunk. */
function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

// Code-split per route. `/wall` downloads only the wall chunk (plus shared UI/vendor code): the staff
// shell, auth gate and every staff feature are separate chunks a lobby TV never fetches.
const WallDisplayPage = lazyNamed(() => import('../features/wall/WallDisplayPage.js'), 'WallDisplayPage');
const AuthGate = lazyNamed(() => import('./auth/AuthGate.js'), 'AuthGate');
const AppShell = lazyNamed(() => import('./AppShell.js'), 'AppShell');
const BoardPage = lazyNamed(() => import('../features/board/BoardPage.js'), 'BoardPage');
const WhiteboardPage = lazyNamed(() => import('../features/whiteboard/WhiteboardPage.js'), 'WhiteboardPage');
const WallPreviewPage = lazyNamed(() => import('../features/wall/WallPreviewPage.js'), 'WallPreviewPage');
const InboxPage = lazyNamed(() => import('../features/inbox/InboxPage.js'), 'InboxPage');
const PipelinePage = lazyNamed(() => import('../features/pipeline/PipelinePage.js'), 'PipelinePage');
const SetupPage = lazyNamed(() => import('../features/setup/SetupPage.js'), 'SetupPage');
const NotFoundPage = lazyNamed(() => import('./NotFoundPage.js'), 'NotFoundPage');

/** In-shell fallback while a feature chunk loads: the header and nav stay put. */
function PageLoading() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-muted">
      <Spinner label="Loading…" size="lg" />
    </div>
  );
}

/** The board lives at `/`; keep `/board?...` links (docs, bookmarks) working with their query. */
function BoardAlias() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/', search }} replace />;
}

const page = (node: ReactNode) => <Suspense fallback={<PageLoading />}>{node}</Suspense>;

/**
 * Route table. `/wall` sits outside AuthGate: a lobby TV has no user session and must never
 * request /api/me. Everything else resolves the roster user first.
 */
export const routes: RouteObject[] = [
  {
    path: '/wall',
    element: (
      <Suspense fallback={<div className="min-h-dvh bg-bg" data-theme="night" />}>
        <WallDisplayPage />
      </Suspense>
    ),
    errorElement: <RouteErrorPage />,
  },
  {
    element: (
      <Suspense fallback={<ShellSkeleton />}>
        <AuthGate />
      </Suspense>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: (
          <Suspense fallback={<ShellSkeleton />}>
            <AppShell />
          </Suspense>
        ),
        children: [
          { index: true, element: page(<BoardPage />) },
          { path: 'board', element: <BoardAlias /> },
          { path: 'board/wall-preview', element: page(<WallPreviewPage />) },
          { path: 'whiteboard', element: page(<WhiteboardPage />) },
          {
            path: 'pipeline',
            element: page(
              <RequirePipeline>
                <PipelinePage />
              </RequirePipeline>,
            ),
          },
          { path: 'inbox', element: page(<InboxPage />) },
          {
            path: 'setup/*',
            element: page(
              <RequireManager>
                <SetupPage />
              </RequireManager>,
            ),
          },
          { path: '*', element: page(<NotFoundPage />) },
        ],
      },
    ],
  },
];

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

export function App() {
  const [client] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
