/**
 * SEO del sitio público (fase 09 §2): meta por ruta, datos iniciales en el HTML, robots.txt y
 * sitemap.xml por tenant. Reutiliza las lecturas cacheadas de `public-cache`, así una página
 * cuesta como mucho una consulta a la BD por minuto aunque la abran muchos.
 */
import {
  matchPublicRoute,
  plainExcerpt,
  publicDataKey,
  type PublicBranch,
  type PublicItemDetail,
  type PublicSite,
  type PublicSitemap,
} from '@shared/public-site';
import { PRIVACY_PATH } from '@shared/privacy';
import { mediaUrl, type TenantCompany } from '@shared/tenant';
import type { PageMeta } from './html';
import { publicReads } from './public-cache';
import type { ShellPage } from './shell';
import { UpstreamError } from './supabase';

export interface PageLookup {
  meta: PageMeta | null;
  /** 404 si la ruta pide una sede o un ítem que no existe (la SPA muestra su página 404). */
  status: 200 | 404;
  /**
   * Datos que la SPA necesita al arrancar (`window.__PUBLIC__`, clave = `publicDataKey`): se
   * ahorra la ida y vuelta a la API antes de pintar (Lighthouse, LCP).
   */
  data: Record<string, unknown>;
  /** Página para el esqueleto estático de `#root` (`shell.ts`). */
  shell: ShellPage | null;
}

const isPrivate = (path: string) => path.startsWith('/admin') || path.startsWith('/api/');

/** Meta y datos iniciales de las páginas públicas. Si la BD falla, la SPA los pide sola. */
export async function lookupPage(env: Env, company: TenantCompany, path: string): Promise<PageLookup> {
  const empty: PageLookup = { meta: null, status: 200, data: {}, shell: null };
  if (isPrivate(path)) return empty;
  const route = matchPublicRoute(path);
  try {
    const sitePromise = publicReads.site<PublicSite>(env, company);
    if (!route) {
      const site = await sitePromise;
      if (!site.data) return empty;
      return {
        ...empty,
        meta: path === PRIVACY_PATH ? { title: `Política de privacidad · ${company.name}` } : null,
        data: { [publicDataKey.site()]: site.data },
        shell:
          path === '/'
            ? { type: 'home', site: site.data }
            : path === '/acerca' && site.data.about_visible
              ? { type: 'about' }
              : null,
      };
    }
    if (route.type === 'item') {
      const [site, item] = await Promise.all([
        sitePromise,
        publicReads.item<PublicItemDetail>(env, company, route.branchSlug, route.id),
      ]);
      const data = item.data;
      if (!data || data.kind !== route.kind) return { ...empty, status: 404 };
      const photo = data.photos[0]?.path ?? data.cover?.path;
      return {
        status: 200,
        meta: {
          title: `${data.name} · ${company.name}`,
          description: data.short_description || plainExcerpt(data.description),
          image: mediaUrl(env.SUPABASE_URL, photo),
        },
        data: {
          ...(site.data ? { [publicDataKey.site()]: site.data } : {}),
          [publicDataKey.item(route.branchSlug, route.id)]: data,
        },
        shell: { type: 'item', item: data },
      };
    }
    const [site, branch] = await Promise.all([
      sitePromise,
      publicReads.branch<PublicBranch>(env, company, route.branchSlug),
    ]);
    if (!branch.data) return { ...empty, status: 404 };
    const b = branch.data.branch;
    return {
      status: 200,
      meta: {
        title: `${b.name} · ${company.name}`,
        description: b.header.subtitle || [b.address, b.city].filter(Boolean).join(', ') || null,
        image: mediaUrl(env.SUPABASE_URL, b.header.image_path ?? b.cover_image_path),
      },
      data: {
        ...(site.data ? { [publicDataKey.site()]: site.data } : {}),
        [publicDataKey.branch(route.branchSlug)]: branch.data,
      },
      shell: { type: 'branch', data: branch.data },
    };
  } catch (err) {
    // Si la BD falla, la página sale con los meta de la empresa: la SPA reintenta sola.
    if (!(err instanceof UpstreamError) && !(err instanceof TypeError)) throw err;
    return empty;
  }
}

export async function loadSitemap(env: Env, company: TenantCompany): Promise<PublicSitemap | null> {
  return (await publicReads.sitemap<PublicSitemap>(env, company)).data;
}
