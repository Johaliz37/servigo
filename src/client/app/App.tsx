import { lazy, Suspense, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import type { ClientTenant } from '@shared/tenant';
import { seedPublicData } from '@client/features/public/api';
import { createRouter } from './router';
import { TenantProvider } from './tenant-context';

// Diferido y solo fuera del sitio público: los clientes no ven toasts y así no descargan
// sonner (fase 09 §4). El panel lo monta al arrancar, mucho antes del primer guardado.
const Toaster = lazy(async () => ({ default: (await import('@client/components/ui/sonner')).Toaster }));

/** Panel, acceso y consola usan toasts; el sitio público de la empresa no. */
function usesToasts(tenant: ClientTenant, pathname: string): boolean {
  return tenant.type === 'platform' || /^\/admin(\/|$)/.test(pathname);
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Errores de permisos o datos no se arreglan reintentando.
        retry: (count, error) => {
          const code = (error as { code?: string }).code;
          return count < 2 && code !== '42501' && code !== 'PGRST301';
        },
      },
    },
  });
}

export function App({ tenant }: { tenant: ClientTenant }) {
  const [queryClient] = useState(() => {
    const client = createQueryClient();
    if (tenant.type === 'company') seedPublicData(client, tenant.company.id);
    return client;
  });
  const [router] = useState(() => createRouter(tenant));
  const [toasts, setToasts] = useState(() => usesToasts(tenant, router.state.location.pathname));

  // Una vez montado se queda: entrar al panel desde el sitio lo activa.
  useEffect(() => {
    if (toasts) return;
    return router.subscribe((state) => {
      if (usesToasts(tenant, state.location.pathname)) setToasts(true);
    });
  }, [router, tenant, toasts]);

  return (
    <TenantProvider tenant={tenant}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {toasts && (
          <Suspense fallback={null}>
            <Toaster position="top-right" closeButton />
          </Suspense>
        )}
      </QueryClientProvider>
    </TenantProvider>
  );
}
