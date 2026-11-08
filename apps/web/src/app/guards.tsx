import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMeContext } from './MeContext.js';

/** Renders children only when the pipeline feature flag is on; otherwise back to the board. */
export function RequirePipeline({ children }: { children: ReactNode }) {
  const { me } = useMeContext();
  return me.features.pipeline ? children : <Navigate to="/" replace />;
}

/** Setup is for managers and admins. The API enforces this; the UI only hides the route. */
export function RequireManager({ children }: { children: ReactNode }) {
  const { canManageAny } = useMeContext();
  return canManageAny ? children : <Navigate to="/" replace />;
}
