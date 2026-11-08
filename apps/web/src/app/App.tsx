import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { BoardPage } from '../features/board/BoardPage.js';
import { InboxPage } from '../features/inbox/InboxPage.js';
import { PipelinePage } from '../features/pipeline/PipelinePage.js';
import { SetupPage } from '../features/setup/SetupPage.js';
import { WallDisplayPage } from '../features/wall/WallDisplayPage.js';
import { WallPreviewPage } from '../features/wall/WallPreviewPage.js';
import { ToastProvider } from '../ui/Toast.js';
import { AppShell } from './AppShell.js';
import { AuthGate } from './auth/AuthGate.js';
import { RouteErrorPage } from './ErrorBoundary.js';
import { RequireManager, RequirePipeline } from './guards.js';
import { NotFoundPage } from './NotFoundPage.js';
import { createQueryClient } from './queryClient.js';

/**
 * Route table. `/wall` sits outside AuthGate: a lobby TV has no user session and must never
 * request /api/me. Everything else resolves the roster user first.
 */
export const routes: RouteObject[] = [
  { path: '/wall', element: <WallDisplayPage />, errorElement: <RouteErrorPage /> },
  {
    element: <AuthGate />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <BoardPage /> },
          { path: 'board/wall-preview', element: <WallPreviewPage /> },
          {
            path: 'pipeline',
            element: (
              <RequirePipeline>
                <PipelinePage />
              </RequirePipeline>
            ),
          },
          { path: 'inbox', element: <InboxPage /> },
          {
            path: 'setup/*',
            element: (
              <RequireManager>
                <SetupPage />
              </RequireManager>
            ),
          },
          { path: '*', element: <NotFoundPage /> },
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
