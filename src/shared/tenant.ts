/**
 * Resolución de tenant a partir del `Host` (ver docs/plan/00 §4).
 * TS puro: se usa en el Worker, en el cliente y en tests.
 */

/** 3–32 caracteres, sin guion al inicio/fin y sin `--` (00 §4, D13). */
export const SLUG_REGEX = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export type ResolvedTenant =
  { type: 'platform' } | { type: 'company'; slug: string } | { type: 'redirect'; to: string } | { type: 'not_found' };

/** Datos públicos de la empresa que el Worker inyecta en `window.__TENANT__`. */
export interface TenantCompany {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  timezone: string;
  currency: string;
  locale: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  seo: { title?: string; description?: string };
}

/** Lo que recibe la SPA: solo llega a la SPA una plataforma o una empresa activa. */
export type ClientTenant = { type: 'platform' } | { type: 'company'; slug: string; company: TenantCompany };

/** Fila que devuelve la RPC `get_company_by_slug` (02 §6). */
export interface CompanyBySlugRow {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  timezone: string;
  currency: string;
  locale: string;
  branding: {
    logo_path: string | null;
    favicon_path: string | null;
    primary_color: string | null;
    secondary_color: string | null;
  };
  seo: { title?: string; description?: string } | null;
}

/** URL pública de un archivo del bucket `media` (00 D14: directo a Supabase, sin proxy). */
export function mediaUrl(supabaseUrl: string, path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const encoded = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/media/${encoded}`;
}

export function toTenantCompany(row: CompanyBySlugRow, supabaseUrl: string): TenantCompany {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    timezone: row.timezone,
    currency: row.currency,
    locale: row.locale,
    logoUrl: mediaUrl(supabaseUrl, row.branding.logo_path),
    faviconUrl: mediaUrl(supabaseUrl, row.branding.favicon_path),
    primaryColor: row.branding.primary_color,
    secondaryColor: row.branding.secondary_color,
    seo: row.seo ?? {},
  };
}

/**
 * Origen del sitio de una empresa a partir del origen actual (mismo protocolo y puerto).
 * `http://localhost:5273` + `demo` → `http://demo.localhost:5273`.
 */
export function companyOrigin(currentUrl: string, rootDomain: string, slug: string): string {
  const url = new URL(currentUrl);
  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol}//${slug}.${rootDomain}${port}`;
}

export interface ResolveTenantOptions {
  /** `roquintech.com` en producción, `localhost` en local. */
  rootDomain: string;
  /** Subdominio de la plataforma Servigo. Por defecto `servigo`. */
  platformSubdomain?: string;
}

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

/** Quita el puerto y normaliza a minúsculas (sin punto final). */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h; // IPv6 literal: no aplica
  const colon = h.lastIndexOf(':');
  if (colon !== -1) h = h.slice(0, colon);
  return h.endsWith('.') ? h.slice(0, -1) : h;
}

function isPreviewHost(host: string): boolean {
  return host.endsWith('.workers.dev');
}

export function resolveTenant(
  host: string,
  options: ResolveTenantOptions,
  searchParams?: URLSearchParams,
): ResolvedTenant {
  const rootDomain = options.rootDomain.toLowerCase();
  const platformSubdomain = (options.platformSubdomain ?? 'servigo').toLowerCase();
  const isLocal = rootDomain === 'localhost';
  const h = normalizeHost(host);

  // `?tenant={slug}`: solo en local (host raíz) y en previews de workers.dev.
  const override = searchParams?.get('tenant')?.trim().toLowerCase();
  if (override !== undefined && override !== '' && ((isLocal && h === rootDomain) || isPreviewHost(h))) {
    return isValidSlug(override) ? { type: 'company', slug: override } : { type: 'not_found' };
  }

  if (h === rootDomain) {
    // En local la plataforma es el host raíz; en prod el apex es la web corporativa
    // (no la sirve este Worker, pero si llegara aquí no es un tenant).
    return isLocal ? { type: 'platform' } : { type: 'not_found' };
  }

  if (isPreviewHost(h)) return { type: 'platform' };

  const suffix = `.${rootDomain}`;
  if (!h.endsWith(suffix)) return { type: 'not_found' };

  const label = h.slice(0, -suffix.length);
  if (label.includes('.')) return { type: 'not_found' }; // solo un nivel (00 D11)

  if (label === 'www') {
    return isLocal ? { type: 'not_found' } : { type: 'redirect', to: `https://${rootDomain}` };
  }
  if (label === platformSubdomain) return { type: 'platform' };

  // Los slugs reservados se validan contra la tabla `reserved_slugs` (fase 02/03).
  return isValidSlug(label) ? { type: 'company', slug: label } : { type: 'not_found' };
}
