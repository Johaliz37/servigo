/**
 * Caché de las lecturas públicas (fase 09 §2): Cache API del edge, 60 s, con clave por empresa
 * y una **versión** por empresa. Purgar = cambiar la versión: las claves viejas dejan de
 * usarse sin tener que enumerarlas (la Cache API no borra por prefijo).
 */
import type { TenantCompany } from '@shared/tenant';
import { rpcJson } from './supabase';
import { edgeCache } from './tenant';

export const PUBLIC_TTL_SECONDS = 60;
/** Lo que no existe se cachea menos: un ítem recién publicado aparece pronto. */
const MISSING_TTL_SECONDS = 10;
/** La versión vive más que cualquier entrada; si se pierde, se vuelve a '0' sin riesgo. */
const VERSION_TTL_SECONDS = 86_400;

export const PUBLIC_CACHE_CONTROL = `public, max-age=${PUBLIC_TTL_SECONDS}, stale-while-revalidate=300`;

const ORIGIN = 'https://public-cache.servigo.internal';
const versionKey = (companyId: string) => new Request(`${ORIGIN}/${companyId}/version`);

async function publicVersion(cache: Cache, companyId: string): Promise<string> {
  const hit = await cache.match(versionKey(companyId));
  return hit ? await hit.text() : '0';
}

/** Invalida toda la caché pública de la empresa (tras guardar en el panel). */
export async function purgePublic(companyId: string): Promise<void> {
  await edgeCache()?.put(
    versionKey(companyId),
    new Response(String(Date.now()), { headers: { 'cache-control': `max-age=${VERSION_TTL_SECONDS}` } }),
  );
}

export interface PublicRead<T> {
  data: T | null;
  /** JSON listo para responder (evita volver a serializar en un acierto de caché). */
  body: string;
}

/**
 * Lee una RPC pública con caché. `key` identifica la consulta dentro de la empresa
 * (p. ej. `branch/centro`).
 */
export async function readPublic<T>(
  env: Env,
  company: TenantCompany,
  key: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<PublicRead<T>> {
  const cache = edgeCache();
  const version = cache ? await publicVersion(cache, company.id) : '0';
  const request = new Request(`${ORIGIN}/${company.id}/v${version}/${key}`);
  const hit = await cache?.match(request);
  if (hit) {
    const body = await hit.text();
    return { data: JSON.parse(body) as T | null, body };
  }

  const data = await rpcJson<T>(env, fn, args);
  const body = JSON.stringify(data);
  const ttl = data === null ? MISSING_TTL_SECONDS : PUBLIC_TTL_SECONDS;
  await cache?.put(
    request,
    new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` } }),
  );
  return { data, body };
}

/** Lecturas públicas con nombre (la misma clave sirve al endpoint y a los meta del HTML). */
export const publicReads = {
  site: <T>(env: Env, company: TenantCompany) =>
    readPublic<T>(env, company, 'site', 'get_public_site', { p_slug: company.slug }),
  branch: <T>(env: Env, company: TenantCompany, branchSlug: string) =>
    readPublic<T>(env, company, `branch/${encodeURIComponent(branchSlug)}`, 'get_public_branch', {
      p_slug: company.slug,
      p_branch_slug: branchSlug,
    }),
  item: <T>(env: Env, company: TenantCompany, branchSlug: string, id: string) =>
    readPublic<T>(env, company, `item/${encodeURIComponent(branchSlug)}/${id}`, 'get_public_item', {
      p_slug: company.slug,
      p_branch_slug: branchSlug,
      p_item_id: id,
    }),
  about: <T>(env: Env, company: TenantCompany, branchSlug: string | null) =>
    readPublic<T>(env, company, `about/${branchSlug ? encodeURIComponent(branchSlug) : ''}`, 'get_public_about', {
      p_slug: company.slug,
      p_branch_slug: branchSlug,
    }),
  sitemap: <T>(env: Env, company: TenantCompany) =>
    readPublic<T>(env, company, 'sitemap', 'get_public_sitemap', { p_slug: company.slug }),
};
