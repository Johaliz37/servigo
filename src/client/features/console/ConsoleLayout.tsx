import { useQuery } from '@tanstack/react-query';
import { LogOutIcon } from 'lucide-react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { Button } from '@client/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@client/components/ui/card';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { useSystemDarkMode } from '@client/hooks/use-system-dark-mode';
import { messageOf } from '@client/lib/errors';
import { supabase } from '@client/lib/supabase';
import { cn } from '@client/lib/utils';
import { signOut, useSession } from '@client/features/auth/session';

/** Layout de `/console/*`: exige superadmin (tabla `platform_admins`). */
export function Component() {
  useSystemDarkMode();
  const location = useLocation();
  const { status, session } = useSession();
  const userId = session?.user.id;
  const isAdmin = useQuery({
    queryKey: ['is_platform_admin', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_platform_admin');
      if (error) throw error;
      return data;
    },
  });

  if (status === 'loading') return <FullPageSpinner />;
  if (!session) {
    return <Navigate to={`/console/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  if (isAdmin.isPending) return <FullPageSpinner label="Verificando acceso…" />;
  if (isAdmin.isError || !isAdmin.data) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>No tienes acceso a la consola</CardTitle>
            <CardDescription>
              {isAdmin.isError ? messageOf(isAdmin.error) : `${session.user.email ?? ''} no es operador de Servigo.`}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => void signOut()}>Cerrar sesión</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link to="/console" className="font-semibold">
            Servigo <span className="font-normal text-muted-foreground">· Consola</span>
          </Link>
          <nav aria-label="Consola" className="flex gap-4 text-sm">
            <NavLink
              to="/console/companies"
              className={({ isActive }) =>
                cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground')
              }
            >
              Empresas
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{session.user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOutIcon aria-hidden /> Salir
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
