/**
 * Errores del navegador → `POST /api/client-errors` (fase 13 §5), que los deja en Workers Logs.
 * Sin servicios externos. Máximo 5 por carga de página y sin repetir el mismo mensaje; el
 * Worker limpia datos personales y limita por IP. Incluye las violaciones de la CSP.
 */
type Kind = 'error' | 'unhandledrejection' | 'react' | 'csp';

const MAX_PER_PAGE = 5;
let sent = 0;
const seen = new Set<string>();

// Ruido que no es nuestro: extensiones, scripts de otros orígenes, avisos de ResizeObserver.
const IGNORE = /ResizeObserver loop|^Script error\.?$|chrome-extension:|moz-extension:|safari-extension:/;

function endpoint(): string {
  const tenant = new URLSearchParams(window.location.search).get('tenant');
  return tenant ? `/api/client-errors?tenant=${encodeURIComponent(tenant)}` : '/api/client-errors';
}

export function reportError(kind: Kind, error: unknown): void {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : typeof error === 'string' ? error : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  if (!message || IGNORE.test(message) || (stack && IGNORE.test(stack))) return;
  if (sent >= MAX_PER_PAGE || seen.has(message)) return;
  seen.add(message);
  sent++;
  try {
    void fetch(endpoint(), {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind,
        message: message.slice(0, 2000),
        ...(stack ? { stack: stack.slice(0, 8000) } : {}),
        path: window.location.pathname,
      }),
    }).catch(() => undefined);
  } catch {
    // Nunca romper la página por informar un error.
  }
}

export function installErrorReporting(): void {
  window.addEventListener('error', (e) => reportError('error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportError('unhandledrejection', e.reason));
  window.addEventListener('securitypolicyviolation', (e) =>
    reportError('csp', `${e.effectiveDirective} bloqueó ${e.blockedURI || 'inline'} (${e.sourceFile ?? ''})`),
  );
}
