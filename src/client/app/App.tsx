import { getTenant } from '@client/lib/tenant';

// Página temporal de la fase 01: muestra el tenant resuelto por el Worker.
export function App() {
  const tenant = getTenant();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6 text-center">
      {tenant.type === 'company' && <h1 className="text-3xl font-semibold">Tenant: {tenant.slug}</h1>}
      {tenant.type === 'platform' && <h1 className="text-3xl font-semibold">Plataforma</h1>}
      {tenant.type !== 'company' && tenant.type !== 'platform' && (
        <h1 className="text-3xl font-semibold">Sitio no encontrado</h1>
      )}
      <p className="text-sm text-muted-foreground">Servigo · ruta {window.location.pathname}</p>
    </main>
  );
}
