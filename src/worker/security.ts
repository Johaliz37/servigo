/**
 * Cabeceras de seguridad (fase 13 §1). Funciones puras para probarlas sin el runtime.
 *
 * CSP del HTML: scripts solo propios, de Turnstile o inline con el nonce de la respuesta
 * (`window.__TENANT__`, `window.__PUBLIC__` y, en desarrollo, el preámbulo de Vite). Estilos
 * inline permitidos: la marca va en `<html style>` y Vite inyecta CSS en desarrollo. Imágenes
 * directas de Supabase Storage (D14). El sitio no se puede embeber (`frame-ancestors 'none'`).
 */

/** Nonce aleatorio por respuesta (128 bits, base64). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

const TURNSTILE = 'https://challenges.cloudflare.com';

export function contentSecurityPolicy(supabaseUrl: string, nonce: string): string {
  const supabase = new URL(supabaseUrl).origin;
  const realtime = supabase.replace(/^http/, 'ws');
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, TURNSTILE],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', supabase],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", supabase, realtime, TURNSTILE],
    'frame-src': [TURNSTILE],
    // La compresión de imágenes corre en un worker `blob:` que carga la librería desde /assets.
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

/** Cabeceras para toda respuesta del Worker (HTML, API, robots, sitemap). */
export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'strict-transport-security': 'max-age=31536000',
  'cross-origin-opener-policy': 'same-origin',
};

/** Respuestas que no son HTML: nada que ejecutar ni embeber. */
export const NON_HTML_CSP = "default-src 'none'; frame-ancestors 'none'";

export function applySecurityHeaders(headers: Headers, csp: string): void {
  for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) headers.set(k, v);
  headers.set('content-security-policy', csp);
}

/** Añade el nonce a los `<script>` inline que genera el Worker. */
export const withNonce = (html: string, nonce: string) => html.replaceAll('<script>', `<script nonce="${nonce}">`);
