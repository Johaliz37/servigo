import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button } from '@client/components/ui/button';
import { messageOf } from '@client/lib/messages';

/** Página "no encontrada" dentro de la SPA (la del tenant inexistente la sirve el Worker). */
export function NotFoundPage() {
  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Página no encontrada</h1>
      <p className="text-muted-foreground">La dirección no existe o cambió.</p>
      <Button asChild variant="outline">
        <Link to="/">Ir al inicio</Link>
      </Button>
    </div>
  );
}

/** `ErrorBoundary` de cada ruta: un fallo en una pantalla no tumba toda la app. */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;

  // Un chunk que ya no existe tras un despliegue: recargar trae la versión nueva.
  const staleChunk =
    error instanceof TypeError && /dynamically imported module|Importing a module script/i.test(error.message);
  console.error(error);

  return (
    <div role="alert" className="flex min-h-[60svh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{staleChunk ? 'Hay una versión nueva' : 'Algo salió mal'}</h1>
      <p className="max-w-md text-muted-foreground">
        {staleChunk ? 'Recarga la página para continuar.' : messageOf(error)}
      </p>
      <Button onClick={() => window.location.reload()}>Recargar</Button>
    </div>
  );
}
