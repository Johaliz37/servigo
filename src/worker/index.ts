import { Hono } from 'hono';
import { robotsTxt, sitemapXml } from '@shared/public-site';
import type { ClientTenant } from '@shared/tenant';
import type { AppEnv } from './env';
import { buildHead } from './html';
import { apiError, type Ctx } from './http';
import { adminRoutes } from './routes/admin';
import { bookingRoutes } from './routes/bookings';
import { publicRoutes } from './routes/public';
import { superadminRoutes } from './routes/superadmin';
import { clientErrorRoutes, requestLog } from './observability';
import { anonClient } from './supabase';
import { applySecurityHeaders, contentSecurityPolicy, createNonce, NON_HTML_CSP, withNonce } from './security';
import { loadSitemap, lookupPage } from './seo';
import { brandStyle, publicShell } from './shell';
import { tenantMiddleware } from './tenant';

const app = new Hono<AppEnv>();

// Primero: envuelven también las respuestas tempranas del tenant (404, redirecciones).
app.use('*', requestLog);
app.use('*', async (c, next) => {
  const nonce = createNonce();
  c.set('nonce', nonce);
  await next();
  const html = c.res.headers.get('content-type')?.includes('text/html') ?? false;
  // Las respuestas de ASSETS tienen cabeceras inmutables: se copia la respuesta.
  const res = new Response(c.res.body, c.res);
  applySecurityHeaders(res.headers, html ? contentSecurityPolicy(c.env.SUPABASE_URL, nonce) : NON_HTML_CSP);
  c.res = res;
});
app.use('*', tenantMiddleware);

/** Tenant listo para la SPA (solo plataforma o empresa activa llegan hasta aquí). */
function clientTenant(c: Ctx): ClientTenant {
  const tenant = c.get('tenant');
  const company = c.get('company');
  if (tenant.type === 'company' && company) return { type: 'company', slug: company.slug, company };
  return { type: 'platform' };
}

// `?db=1` comprueba también Supabase (`ping()`); lo usa el keep-alive de la fase 04.
app.get('/api/health', async (c) => {
  const tenant = c.get('tenant');
  const body = {
    ok: true,
    tenant: tenant.type === 'company' ? tenant.slug : null,
    platform: tenant.type === 'platform',
  };
  if (c.req.query('db') !== '1') return c.json(body);
  const { error } = await anonClient(c.env).rpc('ping');
  return error ? c.json({ ...body, ok: false, db: false }, 503) : c.json({ ...body, db: true });
});

// Respaldo de `window.__TENANT__` si la página no pasó por el HTMLRewriter.
app.get('/api/public/tenant', (c) => c.json(clientTenant(c), 200, { 'cache-control': 'no-store' }));

app.route('/api/public', publicRoutes);
app.route('/api/bookings', bookingRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/superadmin', superadminRoutes);
app.route('/api/client-errors', clientErrorRoutes);

app.all('/api/*', (c) => apiError(c, 404, 'not_found', 'Ruta no encontrada'));

// SEO por tenant (fase 09 §2).
app.get('/robots.txt', (c) => {
  const origin = new URL(c.req.url).origin;
  return c.text(robotsTxt(origin, !!c.get('company')), 200, { 'cache-control': 'public, max-age=3600' });
});

app.get('/sitemap.xml', async (c) => {
  const company = c.get('company');
  if (!company) return c.text('Not found', 404);
  const data = await loadSitemap(c.env, company);
  if (!data) return c.text('Not found', 404);
  return c.body(sitemapXml(new URL(c.req.url).origin, data), 200, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  });
});

// Resto: SPA desde Static Assets con meta/SEO y `window.__TENANT__` (00 D8, fase 03 §1).
app.all('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (!res.headers.get('content-type')?.includes('text/html')) return res;

  const path = new URL(c.req.url).pathname;
  const company = c.get('company');
  const page = company
    ? await lookupPage(c.env, company, path)
    : { meta: null, status: 200 as const, data: {}, shell: null };
  const head = buildHead(clientTenant(c), path, page.meta, page.data);
  const nonce = c.get('nonce');
  const shell = company ? publicShell(c.env.SUPABASE_URL, company, page.shell) : null;
  const style = company ? brandStyle(company) : '';
  const rewritten = new HTMLRewriter()
    .on('html', {
      element(el) {
        if (style) el.setAttribute('style', style);
      },
    })
    .on('div#root', {
      element(el) {
        if (shell) el.setInnerContent(shell, { html: true });
      },
    })
    .on('title', {
      element(el) {
        el.setInnerContent(head.title);
      },
    })
    // Scripts inline del propio HTML (en desarrollo, el preámbulo de Vite).
    .on('script:not([src])', {
      element(el) {
        el.setAttribute('nonce', nonce);
      },
    })
    .on('head', {
      element(el) {
        el.append(withNonce(head.tags, nonce), { html: true });
      },
    })
    .transform(res);

  // El HTML depende del Host: nunca se reutiliza entre tenants y siempre se revalida.
  const headers = new Headers(rewritten.headers);
  headers.set('cache-control', 'no-cache');
  headers.append('vary', 'Host');
  const status = page.status === 404 && rewritten.status === 200 ? 404 : rewritten.status;
  return new Response(rewritten.body, { status, headers });
});

export default app satisfies ExportedHandler<Env>;
