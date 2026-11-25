import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompanyBySlugRow, TenantCompany } from '@shared/tenant';
import { buildHead } from './html';
import app from './index';
import { lookupPage } from './seo';

// Fase 09: endpoints del sitio público, robots/sitemap y meta por ruta.

const env = {
  ROOT_DOMAIN: 'localhost',
  PLATFORM_SUBDOMAIN: 'servigo',
  SUPABASE_URL: 'http://sb.test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  ASSETS: { fetch: () => Promise.resolve(new Response('<html></html>')) },
} as unknown as Env;

const demoRow: CompanyBySlugRow = {
  id: 'c1',
  slug: 'demo',
  name: 'Barbería Demo',
  status: 'active',
  timezone: 'America/Bogota',
  currency: 'COP',
  locale: 'es-CO',
  branding: { logo_path: null, favicon_path: null, primary_color: '#1F4E79', secondary_color: null },
  seo: {},
};

const company: TenantCompany = {
  id: 'c1',
  slug: 'demo',
  name: 'Barbería Demo',
  status: 'active',
  timezone: 'America/Bogota',
  currency: 'COP',
  locale: 'es-CO',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#1F4E79',
  secondaryColor: null,
  seo: {},
};

const ITEM_ID = '30000000-0000-4000-a000-000000000001';
const item = {
  id: ITEM_ID,
  kind: 'service',
  name: 'Corte <clásico>',
  short_description: 'A tijera',
  description: null,
  photos: [{ path: 'c1/catalog/a.webp', thumb_path: null, alt: null }],
  cover: null,
};
const branch = {
  branch: {
    name: 'Sede Centro',
    slug: 'centro',
    address: 'Calle 10',
    city: 'Bogotá',
    header: { subtitle: 'Lunes a sábado' },
    cover_image_path: 'c1/branches/c.webp',
  },
};

/** PostgREST simulado: devuelve `responses[fn]` (o null) y registra las llamadas. */
function mockSupabase(responses: Record<string, unknown>, status = 200) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const fn = url.split('/rest/v1/rpc/')[1] ?? '';
      const args = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (fn === 'get_company_by_slug') return Response.json(args.p_slug === 'demo' ? demoRow : null);
      calls.push({ fn, args });
      if (status !== 200) return new Response('down', { status });
      return Response.json(responses[fn] ?? null);
    }),
  );
  return calls;
}

const req = (path: string, host = 'demo.localhost:5273') => app.request(`http://${host}${path}`, undefined, env);

afterEach(() => vi.unstubAllGlobals());

describe('API pública del sitio', () => {
  it('/site responde el JSON de la RPC con caché pública de 60 s', async () => {
    const calls = mockSupabase({ get_public_site: { company: { name: 'Barbería Demo' }, branches: [] } });
    const res = await req('/api/public/site');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=300');
    expect(await res.json()).toEqual({ company: { name: 'Barbería Demo' }, branches: [] });
    expect(calls).toEqual([{ fn: 'get_public_site', args: { p_slug: 'demo' } }]);
  });

  it('/branch normaliza el slug y responde 404 si la sede no existe', async () => {
    const calls = mockSupabase({});
    const res = await req('/api/public/branch/CENTRO');
    expect(res.status).toBe(404);
    expect(calls[0]).toEqual({ fn: 'get_public_branch', args: { p_slug: 'demo', p_branch_slug: 'centro' } });
  });

  it('rechaza slugs e ids mal formados sin consultar la BD', async () => {
    const calls = mockSupabase({});
    expect((await req('/api/public/branch/a--b')).status).toBe(404);
    expect((await req('/api/public/item/centro/no-es-uuid')).status).toBe(404);
    expect((await req('/api/public/about?branch=-x')).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('/item y /about pasan la sede y el ítem', async () => {
    const calls = mockSupabase({ get_public_item: item, get_public_about: [] });
    expect((await req(`/api/public/item/centro/${ITEM_ID.toUpperCase()}`)).status).toBe(200);
    expect((await req('/api/public/about?branch=norte')).status).toBe(200);
    expect(calls).toEqual([
      { fn: 'get_public_item', args: { p_slug: 'demo', p_branch_slug: 'centro', p_item_id: ITEM_ID } },
      { fn: 'get_public_about', args: { p_slug: 'demo', p_branch_slug: 'norte' } },
    ]);
  });

  it('BD caída → 503; en la plataforma → 404', async () => {
    mockSupabase({}, 502);
    expect((await req('/api/public/site')).status).toBe(503);
    expect((await req('/api/public/site', 'localhost:5273')).status).toBe(404);
  });
});

describe('SEO por tenant', () => {
  it('robots.txt: el sitio de una empresa apunta a su sitemap; la plataforma oculta la consola', async () => {
    mockSupabase({});
    const robots = await (await req('/robots.txt')).text();
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Sitemap: http://demo.localhost:5273/sitemap.xml');
    const platform = await (await req('/robots.txt', 'localhost:5273')).text();
    expect(platform).toContain('Disallow: /console');
    expect(platform).not.toContain('Sitemap');
  });

  it('sitemap.xml lista inicio, sedes y fichas', async () => {
    mockSupabase({
      get_public_sitemap: {
        about_visible: false,
        branches: [{ slug: 'centro', items: [{ id: ITEM_ID, kind: 'service' }] }],
      },
    });
    const res = await req('/sitemap.xml');
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toContain('<loc>http://demo.localhost:5273/s/centro</loc>');
    expect(xml).toContain(`<loc>http://demo.localhost:5273/s/centro/servicios/${ITEM_ID}</loc>`);
    expect(xml).not.toContain('/acerca');
    expect((await req('/sitemap.xml', 'localhost:5273')).status).toBe(404);
  });

  it('la ficha de un servicio da título e imagen para compartir', async () => {
    mockSupabase({ get_public_item: item });
    const page = await lookupPage(env, company, `/s/centro/servicios/${ITEM_ID}`);
    expect(page).toEqual({
      status: 200,
      meta: {
        title: 'Corte <clásico> · Barbería Demo',
        description: 'A tijera',
        image: 'http://sb.test/storage/v1/object/public/media/c1/catalog/a.webp',
      },
    });
    const head = buildHead({ type: 'company', slug: 'demo', company }, '/s/centro', page.meta);
    expect(head.title).toBe('Corte <clásico> · Barbería Demo');
    expect(head.tags).toContain('<meta property="og:title" content="Corte &lt;clásico&gt; · Barbería Demo">');
    expect(head.tags).toContain('summary_large_image');
  });

  it('ruta de producto con id de servicio, sede o ítem inexistente → 404', async () => {
    mockSupabase({ get_public_item: item });
    expect((await lookupPage(env, company, `/s/centro/productos/${ITEM_ID}`)).status).toBe(404);
    mockSupabase({});
    expect((await lookupPage(env, company, '/s/nada')).status).toBe(404);
    expect(await lookupPage(env, company, '/acerca')).toEqual({ meta: null, status: 200 });
  });

  it('la página de sede usa su encabezado; si la BD falla quedan los meta de la empresa', async () => {
    mockSupabase({ get_public_branch: branch });
    const page = await lookupPage(env, company, '/s/centro/');
    expect(page.meta?.title).toBe('Sede Centro · Barbería Demo');
    expect(page.meta?.description).toBe('Lunes a sábado');
    expect(page.meta?.image).toContain('/c1/branches/c.webp');
    mockSupabase({}, 500);
    expect(await lookupPage(env, company, '/s/centro')).toEqual({ meta: null, status: 200 });
  });

  it('los meta de página no se aplican al panel', () => {
    const head = buildHead({ type: 'company', slug: 'demo', company }, '/admin', { title: 'X' });
    expect(head.title).toBe('Administración · Barbería Demo');
  });
});
