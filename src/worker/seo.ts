/**
 * SEO del sitio público (fase 09 §2): meta por ruta, robots.txt y sitemap.xml por tenant.
 * Reutiliza las lecturas cacheadas de `public-cache`, así compartir un enlace no cuesta una
 * consulta extra a la BD si alguien acaba de abrir la misma página.
 */
import {
  matchPublicRoute,
  plainExcerpt,
  type PublicBranch,
  type PublicItemDetail,
  type PublicSitemap,
} from '@shared/public-site';
import { mediaUrl, type TenantCompany } from '@shared/tenant';
import type { PageMeta } from './html';
import { publicReads } from './public-cache';
import { UpstreamError } from './supabase';

export interface PageLookup {
  meta: PageMeta | null;
  /** 404 si la ruta pide una sede o un ítem que no existe (la SPA muestra su página 404). */
  status: 200 | 404;
}

/** Meta de `/s/:sede` y `/s/:sede/(servicios|productos)/:id`; null en el resto. */
export async function lookupPage(env: Env, company: TenantCompany, path: string): Promise<PageLookup> {
  const route = matchPublicRoute(path);
  if (!route) return { meta: null, status: 200 };
  try {
    if (route.type === 'item') {
      const { data } = await publicReads.item<PublicItemDetail>(env, company, route.branchSlug, route.id);
      if (!data || data.kind !== route.kind) return { meta: null, status: 404 };
      const photo = data.photos[0]?.path ?? data.cover?.path;
      return {
        status: 200,
        meta: {
          title: `${data.name} · ${company.name}`,
          description: data.short_description || plainExcerpt(data.description),
          image: mediaUrl(env.SUPABASE_URL, photo),
        },
      };
    }
    const { data } = await publicReads.branch<PublicBranch>(env, company, route.branchSlug);
    if (!data) return { meta: null, status: 404 };
    const b = data.branch;
    return {
      status: 200,
      meta: {
        title: `${b.name} · ${company.name}`,
        description: b.header.subtitle || [b.address, b.city].filter(Boolean).join(', ') || null,
        image: mediaUrl(env.SUPABASE_URL, b.header.image_path ?? b.cover_image_path),
      },
    };
  } catch (err) {
    // Si la BD falla, la página sale con los meta de la empresa: la SPA reintenta sola.
    if (!(err instanceof UpstreamError) && !(err instanceof TypeError)) throw err;
    return { meta: null, status: 200 };
  }
}

export async function loadSitemap(env: Env, company: TenantCompany): Promise<PublicSitemap | null> {
  return (await publicReads.sitemap<PublicSitemap>(env, company)).data;
}
