import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Button } from '@client/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@client/components/ui/card';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { MembershipProvider, useMembershipQuery } from '@client/features/auth/membership';
import { signOut, useSession } from '@client/features/auth/session';

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">{children}</div>;
}

/**
 * Sin sesión → `/admin/login?next=`. Con sesión pero sin membresía en *esta* empresa →
 * "No tienes acceso". La seguridad real la da RLS; esto solo evita pantallas vacías.
 */
export function RequireMember({ children }: { children: ReactNode }) {
  const company = useCompany();
  const location = useLocation();
  const { status, session } = useSession();
  const membership = useMembershipQuery();

  if (status === 'loading') return <FullPageSpinner />;
  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/admin/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (membership.isPending) return <FullPageSpinner label="Verificando acceso…" />;

  if (membership.isError || !membership.data) {
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>
              {membership.isError ? 'No pudimos verificar tu acceso' : 'No tienes acceso a esta empresa'}
            </CardTitle>
            <CardDescription>
              {membership.isError
                ? messageOf(membership.error)
                : `Entraste como ${session.user.email}, que no es miembro de ${company.name}. Si deberías tener acceso, pide una invitación a la empresa.`}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-wrap gap-2">
            <Button onClick={() => void signOut()}>Cerrar sesión</Button>
            {membership.isError && (
              <Button variant="outline" onClick={() => void membership.refetch()}>
                Reintentar
              </Button>
            )}
          </CardFooter>
        </Card>
      </Centered>
    );
  }

  return <MembershipProvider membership={membership.data}>{children}</MembershipProvider>;
}
