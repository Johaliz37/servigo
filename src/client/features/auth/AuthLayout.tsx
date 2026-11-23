import { Outlet, useLocation } from 'react-router';
import { useTenant } from '@client/app/tenant-context';
import { useSystemDarkMode } from '@client/hooks/use-system-dark-mode';

export type AuthArea = '/admin' | '/console';

/** `/admin/*` en empresas, `/console/*` en la plataforma. */
export function useAuthArea(): AuthArea {
  return useLocation().pathname.startsWith('/console') ? '/console' : '/admin';
}

/** Marco de las pantallas de login, recuperación e invitación. */
export function Component() {
  useSystemDarkMode();
  const tenant = useTenant();
  const company = tenant.type === 'company' ? tenant.company : null;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <div className="flex items-center gap-3">
        {company?.logoUrl ? (
          <img src={company.logoUrl} alt="" className="size-10 rounded-md object-contain" />
        ) : (
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-md bg-primary text-lg font-semibold text-primary-foreground"
          >
            {(company?.name ?? 'Servigo').charAt(0).toUpperCase()}
          </span>
        )}
        <span className="text-lg font-semibold">{company?.name ?? 'Servigo'}</span>
      </div>
      <div className="w-full max-w-sm">
        <Outlet />
      </div>
      <p className="text-xs text-muted-foreground">
        {company ? 'Administración con Servigo' : 'Consola de la plataforma Servigo'}
      </p>
    </div>
  );
}
