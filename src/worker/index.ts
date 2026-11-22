import { Hono } from 'hono';
import { resolveTenant, type ResolvedTenant } from '@shared/tenant';

type AppEnv = { Bindings: Env; Variables: { tenant: ResolvedTenant } };

const app = new Hono<AppEnv>();

// Resuelve el tenant por `Host` en cada petición que llega al Worker.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const tenant = resolveTenant(
    c.req.header('host') ?? url.host,
    { rootDomain: c.env.ROOT_DOMAIN, platformSubdomain: c.env.PLATFORM_SUBDOMAIN },
    url.searchParams,
  );
  if (tenant.type === 'redirect') return c.redirect(`${tenant.to}${url.pathname}${url.search}`, 301);
  c.set('tenant', tenant);
  await next();
});

const tenantSlug = (t: ResolvedTenant) => (t.type === 'company' ? t.slug : null);

app.get('/api/health', (c) => {
  const tenant = c.get('tenant');
  return c.json({ ok: true, tenant: tenantSlug(tenant), platform: tenant.type === 'platform' });
});

app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

// Resto: SPA desde Static Assets con el tenant inyectado (00 D8).
app.all('*', async (c) => {
  const tenant = c.get('tenant');
  if (tenant.type === 'not_found') {
    return c.html('<!doctype html><meta charset="utf-8"><title>No encontrado</title><h1>Sitio no encontrado</h1>', 404);
  }

  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (!res.headers.get('content-type')?.includes('text/html')) return res;

  // `<` escapado para que el JSON no pueda cerrar el <script>.
  const payload = JSON.stringify(tenant).replace(/</g, '\\u003c');
  return new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append(`<script>window.__TENANT__=${payload}</script>`, { html: true });
      },
    })
    .transform(res);
});

export default app satisfies ExportedHandler<Env>;
