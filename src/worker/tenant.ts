import { createMiddleware } from 'hono/factory';
import { resolveTenant, toTenantCompany, type CompanyBySlugRow, type TenantCompany } from '@shared/tenant';
import type { AppEnv } from './env';
import { PAGES } from './html';
import { fetchCompanyBySlug, UpstreamError } from './supabase';

const TTL_SECONDS = 60;
/** Una empresa inexistente se cachea menos: una recién creada aparece pronto. */
const NOT_FOUND_TTL_SECONDS = 10;

/** Cache API del edge (no existe fuera del runtime de Workers, p. ej. en tests). */
function edgeCache(): Cache | null {
  return typeof caches !== 'undefined' && 'default' in caches
    ? (caches as unknown as { default: Cache }).default
    : null;
}

const cacheKey = (slug: string) => new Request(`https://tenant-cache.servigo.internal/tenant:${slug}`);

/** Empresa por slug con caché de 60 s (clave `tenant:{slug}`). `null` = no existe. */
export async function loadCompany(env: Env, slug: string): Promise<TenantCompany | null> {
  const cache = edgeCache();
  const key = cacheKey(slug);
  const hit = await cache?.match(key);
  if (hit) return (await hit.json()) as TenantCompany | null;

  const row: CompanyBySlugRow | null = await fetchCompanyBySlug(env, slug);
  const company = row ? toTenantCompany(row, env.SUPABASE_URL) : null;
  const ttl = company ? TTL_SECONDS : NOT_FOUND_TTL_SECONDS;
  await cache?.put(
    key,
    new Response(JSON.stringify(company), {
      headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` },
    }),
  );
  return company;
}

/** Borra la caché de una empresa (p. ej. al suspenderla o reactivarla desde la consola). */
export async function purgeCompany(slug: string): Promise<void> {
  await edgeCache()?.delete(cacheKey(slug));
}

const isApi = (path: string) => path.startsWith('/api/');

/**
 * Resuelve el tenant por `Host` y carga la empresa. Corta la petición si el sitio no
 * existe, está suspendido o la BD no responde (00 §4, fase 03 §1).
 */
export const tenantMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const url = new URL(c.req.url);
  const tenant = resolveTenant(
    c.req.header('host') ?? url.host,
    { rootDomain: c.env.ROOT_DOMAIN, platformSubdomain: c.env.PLATFORM_SUBDOMAIN },
    url.searchParams,
  );
  if (tenant.type === 'redirect') return c.redirect(`${tenant.to}${url.pathname}${url.search}`, 301);

  c.set('tenant', tenant);
  c.set('company', null);

  if (tenant.type === 'not_found') {
    return isApi(url.pathname)
      ? c.json({ error: 'not_found', message: 'Sitio no encontrado' }, 404)
      : c.html(PAGES.siteNotFound(), 404);
  }
  // La salud del Worker responde aunque la empresa no exista o la BD falle.
  if (tenant.type === 'platform' || url.pathname === '/api/health') return next();

  let company: TenantCompany | null;
  try {
    company = await loadCompany(c.env, tenant.slug);
  } catch (err) {
    if (!(err instanceof UpstreamError) && !(err instanceof TypeError)) throw err;
    console.error(JSON.stringify({ msg: 'tenant_load_failed', tenant: tenant.slug, error: String(err) }));
    return isApi(url.pathname)
      ? c.json({ error: 'unavailable', message: 'Servicio no disponible' }, 503)
      : c.html(PAGES.unavailable(), 503, { 'retry-after': '60' });
  }

  if (!company) {
    return isApi(url.pathname)
      ? c.json({ error: 'company_not_found', message: 'Esta empresa no existe' }, 404)
      : c.html(PAGES.companyNotFound(), 404);
  }
  if (company.status === 'suspended') {
    return isApi(url.pathname)
      ? c.json({ error: 'company_suspended', message: 'Sitio temporalmente no disponible' }, 503)
      : c.html(PAGES.suspended(company.name), 503);
  }

  c.set('company', company);
  return next();
});
