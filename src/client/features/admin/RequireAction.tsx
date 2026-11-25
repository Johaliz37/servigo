import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import type { Action } from '@shared/permissions';
import { useMembership } from '@client/features/auth/membership';

/** Pantalla solo para quien puede `action` (staff no ve configuración ni contenido). */
export function RequireAction({ action, children }: { action: Action; children: ReactNode }) {
  const { can } = useMembership();
  if (!can(action)) return <Navigate to="/admin" replace />;
  return children;
}
