import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import type { ClientTenant } from '@shared/tenant';
import { Toaster } from '@client/components/ui/sonner';
import { createRouter } from './router';
import { TenantProvider } from './tenant-context';

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
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createRouter(tenant));

  return (
    <TenantProvider tenant={tenant}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster position="top-right" closeButton />
      </QueryClientProvider>
    </TenantProvider>
  );
}
