import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompanyBySlugRow } from '@shared/tenant';
import app from './index';
import { routeLabel, scrub } from './observability';
import { contentSecurityPolicy, withNonce } from './security';

const HTML = '<!doctype html><html><head><title>Servigo</title></head><body><div id="root"></div></body></html>';

const env = {
  ROOT_DOMAIN: 'localhost',
  PLATFORM_SUBDOMAIN: 'servigo',
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  TURNSTILE_SECRET_KEY: 'x',
  ASSETS: {
    fetch: () => Promise.resolve(new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })),
  },
} as unknown as Env;

const demo: CompanyBySlugRow = {
  id: 'c1',
  slug: 'demo',
  name: 'Barbería Demo',
  status: 'active',
  timezone: 'America/Bogota',
  currency: 'COP',
  locale: 'es-CO',
  branding: { logo_path: null, favicon_path: null, primary_color: null, secondary_color: null },
  seo: {},
};

/** PostgREST simulado: empresa `demo` y `get_public_privacy`. */
function mockSupabase(privacy: unknown = { policy: null, updated_at: null }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/rpc/get_company_by_slug')) return Response.json(demo);
    if (url.endsWith('/rpc/get_public_privacy')) return Response.json(privacy);
    return Response.json({ message: 'unexpected' }, { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const req = (url: string, init?: RequestInit) => app.request(url, init, env);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// El HTML (nonce en los scripts, CSP de página) usa HTMLRewriter, que solo existe en workerd:
// lo prueba e2e/fase13.spec.ts contra `pnpm dev`.
describe('cabeceras de seguridad', () => {
  it('API: CSP cerrada y mismas cabeceras base', async () => {
    const res = await req('http://localhost/api/health');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('respuestas tempranas del tenant (empresa inexistente) también las llevan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(null)),
    );
    const res = await req('http://nadie.localhost/');
    expect(res.status).toBe(404);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('la política permite Supabase (https y wss), Turnstile e imágenes de Storage', () => {
    const csp = contentSecurityPolicy('https://abc.supabase.co', 'N');
    expect(csp).toContain("script-src 'self' 'nonce-N' https://challenges.cloudflare.com");
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
    expect(csp).toContain("img-src 'self' data: blob: https://abc.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(contentSecurityPolicy('http://127.0.0.1:54421', 'N')).toContain('ws://127.0.0.1:54421');
    expect(withNonce('<script>a</script><script>b</script>', 'N')).toBe(
      '<script nonce="N">a</script><script nonce="N">b</script>',
    );
  });
});

describe('observabilidad', () => {
  it('scrub quita correos, teléfonos, tokens, consultas y códigos de reserva', () => {
    const out = scrub(
      'Falló ana@x.co +57 300 123 4567 en /reserva/K7M2-9QXA?t=abc.def#access_token=1 eyJhbGc.eyJzdWI.firma',
    );
    expect(out).not.toMatch(/ana@|300|K7M2|abc\.def|access_token|eyJ/);
    expect(out).toContain('[email]');
    expect(scrub('x'.repeat(900)).length).toBe(500);
  });

  it('routeLabel: patrón de la API o primer segmento de la página', () => {
    expect(routeLabel('/api/bookings/:code', '/api/bookings/K7M29QXA')).toBe('/api/bookings/:code');
    expect(routeLabel('*', '/s/norte/servicios/123')).toBe('/s/*');
    expect(routeLabel('*', '/')).toBe('/');
    expect(routeLabel('/api/*', '/api/nada')).toBe('/api/*');
  });

  it('una línea JSON por petición, sin la URL completa', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await req('http://localhost/api/health?token=secreto');
    const line = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({
      msg: 'request',
      tenant: 'platform',
      method: 'GET',
      route: '/api/health',
      status: 200,
    });
    expect(typeof line.duration).toBe('number');
    expect(JSON.stringify(line)).not.toContain('secreto');
  });

  it('POST /api/client-errors registra el error limpio y responde 204', async () => {
    mockSupabase();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await req('http://demo.localhost/api/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'error', message: 'TypeError: x de ana@x.co', path: '/reserva/K7M29QXA' }),
    });
    expect(res.status).toBe(204);
    const line = JSON.parse(String(error.mock.calls.at(-1)?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ msg: 'client_error', tenant: 'demo', kind: 'error', path: '/reserva/*' });
    expect(String(line.message)).not.toContain('ana@');
  });

  it('client-errors: cuerpo no válido → 400; límite por IP → 429', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const bad = await req('http://localhost/api/client-errors', { method: 'POST', body: '{"kind":"otro"}' });
    expect(bad.status).toBe(400);
    const limited = await app.request(
      'http://localhost/api/client-errors',
      { method: 'POST', body: JSON.stringify({ kind: 'error', message: 'x' }) },
      { ...env, CLIENT_ERROR_LIMITER: { limit: () => Promise.resolve({ success: false }) } } as unknown as Env,
    );
    expect(limited.status).toBe(429);
  });
});

describe('privacidad', () => {
  it('GET /api/public/privacy devuelve la política (null = plantilla)', async () => {
    mockSupabase({ policy: '# Propia', updated_at: '2026-11-26T00:00:00Z' });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await req('http://demo.localhost/api/public/privacy');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ policy: '# Propia', updated_at: '2026-11-26T00:00:00Z' });
  });
});
