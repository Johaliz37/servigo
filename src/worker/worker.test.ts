import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientTenant, CompanyBySlugRow } from '@shared/tenant';
import { buildHead, escapeHtml, inlineJson } from './html';
import app from './index';

const env = {
  ROOT_DOMAIN: 'localhost',
  PLATFORM_SUBDOMAIN: 'servigo',
  SUPABASE_URL: 'http://sb.test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  TURNSTILE_SECRET_KEY: 'x',
  ASSETS: { fetch: () => Promise.resolve(new Response('<html><head><title>Servigo</title></head></html>')) },
} as unknown as Env;

const demoRow: CompanyBySlugRow = {
  id: 'c1',
  slug: 'demo',
  name: 'Barbería <Demo>',
  status: 'active',
  timezone: 'America/Bogota',
  currency: 'COP',
  locale: 'es-CO',
  branding: { logo_path: 'c1/logo.webp', favicon_path: null, primary_color: '#1F4E79', secondary_color: null },
  seo: { title: 'Barbería Demo', description: 'Reserva tu corte' },
};

/** Simula PostgREST: `get_company_by_slug` devuelve la fila de `rows[slug]` o null. */
function mockSupabase(rows: Record<string, CompanyBySlugRow>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/rest/v1/rpc/get_company_by_slug')) {
      const { p_slug } = JSON.parse(String(init?.body)) as { p_slug: string };
      return Response.json(rows[p_slug] ?? null);
    }
    return Response.json({ message: 'unexpected' }, { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const req = (url: string, init?: RequestInit) => app.request(url, init, env);

afterEach(() => vi.unstubAllGlobals());

describe('html', () => {
  it('escapa HTML y JSON en línea', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    const json = inlineJson({ name: '</script><!--', sep: ' ' });
    expect(json).not.toContain('<');
    expect(json).not.toContain(' ');
    expect(JSON.parse(json)).toEqual({ name: '</script><!--', sep: ' ' });
  });

  it('arma título, Open Graph y __TENANT__ de la empresa', () => {
    const tenant: ClientTenant = {
      type: 'company',
      slug: 'demo',
      company: {
        id: 'c1',
        slug: 'demo',
        name: 'Demo "Uno"',
        status: 'active',
        timezone: 'America/Bogota',
        currency: 'COP',
        locale: 'es-CO',
        logoUrl: 'http://sb/logo.webp',
        faviconUrl: null,
        primaryColor: '#1F4E79',
        secondaryColor: null,
        seo: { description: 'Cortes' },
      },
    };
    const pub = buildHead(tenant, '/');
    expect(pub.title).toBe('Demo "Uno"');
    expect(pub.tags).toContain('<meta property="og:title" content="Demo &quot;Uno&quot;">');
    expect(pub.tags).toContain('<meta property="og:image" content="http://sb/logo.webp">');
    expect(pub.tags).toContain('<link rel="icon" href="http://sb/logo.webp">');
    expect(pub.tags).toContain('window.__TENANT__=');
    expect(pub.tags).not.toContain('noindex');

    const admin = buildHead(tenant, '/admin/reservas');
    expect(admin.title).toBe('Administración · Demo "Uno"');
    expect(admin.tags).toContain('noindex');
  });
});

describe('worker', () => {
  it('health no depende de la empresa', async () => {
    mockSupabase({});
    const res = await req('http://demo.localhost:5273/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tenant: 'demo', platform: false });
  });

  it('www → 301 solo en producción; host desconocido → 404', async () => {
    const prod = { ...env, ROOT_DOMAIN: 'roquintech.com' } as unknown as Env;
    const res = await app.request('https://www.roquintech.com/x?y=1', undefined, prod);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://roquintech.com/x?y=1');
    expect((await req('http://a.b.localhost:5273/')).status).toBe(404);
  });

  it('empresa inexistente → 404 de tenant (HTML y API)', async () => {
    mockSupabase({});
    const html = await req('http://noexiste.localhost:5273/');
    expect(html.status).toBe(404);
    expect(await html.text()).toContain('Esta empresa no existe');
    const api = await req('http://noexiste.localhost:5273/api/public/tenant');
    expect(api.status).toBe(404);
  });

  it('empresa suspendida → 503', async () => {
    mockSupabase({ demo: { ...demoRow, status: 'suspended' } });
    const res = await req('http://demo.localhost:5273/admin');
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('temporalmente no disponible');
  });

  it('BD caída → 503 sin romper', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 502 })),
    );
    const res = await req('http://demo.localhost:5273/');
    expect(res.status).toBe(503);
  });

  it('/api/public/tenant devuelve la empresa con URLs de media', async () => {
    mockSupabase({ demo: demoRow });
    const res = await req('http://demo.localhost:5273/api/public/tenant');
    const body = (await res.json()) as ClientTenant;
    expect(body.type).toBe('company');
    if (body.type !== 'company') return;
    expect(body.company.name).toBe('Barbería <Demo>');
    expect(body.company.logoUrl).toBe('http://sb.test/storage/v1/object/public/media/c1/logo.webp');
  });

  it('la plataforma no consulta empresas', async () => {
    const fetchMock = mockSupabase({});
    const res = await req('http://localhost:5273/api/public/tenant');
    expect(await res.json()).toEqual({ type: 'platform' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('/api/admin exige empresa y sesión', async () => {
    mockSupabase({ demo: demoRow });
    expect((await req('http://localhost:5273/api/admin/invite', { method: 'POST' })).status).toBe(404);
    const noAuth = await req('http://demo.localhost:5273/api/admin/invite', { method: 'POST', body: '{}' });
    expect(noAuth.status).toBe(401);
    const bad = await req('http://demo.localhost:5273/api/admin/invite', {
      method: 'POST',
      headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'no-es-correo', role: 'staff' }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toBe('Escribe un correo válido');
  });

  it('/api/superadmin solo existe en la plataforma y exige sesión', async () => {
    mockSupabase({ demo: demoRow });
    expect((await req('http://demo.localhost:5273/api/superadmin/companies', { method: 'POST' })).status).toBe(404);
    expect((await req('http://localhost:5273/api/superadmin/companies', { method: 'POST' })).status).toBe(401);
  });

  it('/api/admin/purge-tenant: owner/admin recibe la empresa fresca; staff, 403', async () => {
    let allowed = true;
    let row: CompanyBySlugRow = demoRow;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith('/rpc/get_company_by_slug')) return Response.json(row);
        if (url.endsWith('/rpc/has_company_role')) return Response.json(allowed);
        return Response.json({ message: 'unexpected' }, { status: 500 });
      }),
    );
    const purge = () =>
      req('http://demo.localhost:5273/api/admin/purge-tenant', {
        method: 'POST',
        headers: { authorization: 'Bearer jwt' },
      });

    row = { ...demoRow, name: 'Nombre nuevo' };
    const ok = await purge();
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as ClientTenant;
    expect(body.type === 'company' && body.company.name).toBe('Nombre nuevo');

    allowed = false;
    expect((await purge()).status).toBe(403);
  });

  it('/api/public/slots valida la consulta, la empresa y calcula los cupos', async () => {
    const BRANCH = '20000000-0000-4000-a000-000000000001';
    const SERVICE = '30000000-0000-4000-a000-000000000001';
    let companyId = 'c1';
    let rpcBody: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith('/rpc/get_company_by_slug')) return Response.json(demoRow);
        if (url.endsWith('/rpc/get_slot_inputs')) {
          rpcBody = JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : '{}')));
          return Response.json({
            company_id: companyId,
            branch_id: BRANCH,
            timezone: 'America/Bogota',
            settings: { slot_step_minutes: 60, min_lead_minutes: 0, max_days_ahead: 3650 },
            service: {
              id: SERVICE,
              duration_minutes: 60,
              buffer_before_minutes: 0,
              buffer_after_minutes: 0,
              capacity: 1,
            },
            events: [
              {
                id: 'e1',
                kind: 'open',
                starts_at: '2030-01-07T14:00:00Z', // lunes 9:00 Bogotá
                ends_at: '2030-01-07T17:00:00Z',
                all_day: false,
                timezone: 'America/Bogota',
                rrule: 'FREQ=WEEKLY;BYDAY=MO',
                exdates: [],
                recurrence_parent_id: null,
                recurrence_original_start: null,
                service_ids: null,
                capacity_override: null,
              },
            ],
            bookings: [
              {
                block_starts_at: '2030-01-14T15:00:00Z',
                block_ends_at: '2030-01-14T16:00:00Z',
                service_id: SERVICE,
                status: 'confirmed',
              },
            ],
          });
        }
        return Response.json({ message: 'unexpected' }, { status: 500 });
      }),
    );
    const get = (qs: string) => req(`http://demo.localhost:5273/api/public/slots?${qs}`);

    expect((await get('branch=x&service=y&from=2030-01-01&to=2030-01-02')).status).toBe(400);
    expect((await get(`branch=${BRANCH}&service=${SERVICE}&from=2030-01-10&to=2030-01-01`)).status).toBe(400);
    expect((await get(`branch=${BRANCH}&service=${SERVICE}&from=2030-01-01&to=2030-03-01`)).status).toBe(400);

    const ok = await get(`branch=${BRANCH}&service=${SERVICE}&from=2030-01-07&to=2030-01-14`);
    expect(ok.status).toBe(200);
    expect(rpcBody).toMatchObject({ p_from: '2030-01-06T00:00:00Z', p_to: '2030-01-16T00:00:00Z' });
    const body = (await ok.json()) as { timezone: string; days: { date: string; slots: { start: string }[] }[] };
    expect(body.timezone).toBe('America/Bogota');
    expect(body.days.map((d) => [d.date, d.slots.length])).toEqual([
      ['2030-01-07', 3],
      ['2030-01-14', 2], // 10:00 ocupado
    ]);

    companyId = 'otra';
    expect((await get(`branch=${BRANCH}&service=${SERVICE}&from=2030-01-07&to=2030-01-14`)).status).toBe(404);
    expect((await req(`http://localhost:5273/api/public/slots?branch=${BRANCH}`)).status).toBe(404);
  });
});
