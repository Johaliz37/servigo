import { Hono } from 'hono';
import type { ClientTenant } from '@shared/tenant';
import type { AppEnv } from './env';
import { buildHead } from './html';
import { apiError, type Ctx } from './http';
import { adminRoutes } from './routes/admin';
import { publicRoutes } from './routes/public';
import { superadminRoutes } from './routes/superadmin';
import { anonClient } from './supabase';
import { tenantMiddleware } from './tenant';

const app = new Hono<AppEnv>();

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
app.route('/api/admin', adminRoutes);
app.route('/api/superadmin', superadminRoutes);

app.all('/api/*', (c) => apiError(c, 404, 'not_found', 'Ruta no encontrada'));

// Resto: SPA desde Static Assets con meta/SEO y `window.__TENANT__` (00 D8, fase 03 §1).
app.all('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (!res.headers.get('content-type')?.includes('text/html')) return res;

  const head = buildHead(clientTenant(c), new URL(c.req.url).pathname);
  const rewritten = new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(head.title);
      },
    })
    .on('head', {
      element(el) {
        el.append(head.tags, { html: true });
      },
    })
    .transform(res);

  // El HTML depende del Host: nunca se reutiliza entre tenants y siempre se revalida.
  const headers = new Headers(rewritten.headers);
  headers.set('cache-control', 'no-cache');
  headers.append('vary', 'Host');
  return new Response(rewritten.body, { status: rewritten.status, headers });
});

export default app satisfies ExportedHandler<Env>;
