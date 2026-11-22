/**
 * Resolución de tenant a partir del `Host` (ver docs/plan/00 §4).
 * TS puro: se usa en el Worker, en el cliente y en tests.
 */

/** 3–32 caracteres, sin guion al inicio/fin y sin `--` (00 §4, D13). */
export const SLUG_REGEX = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export type ResolvedTenant =
  { type: 'platform' } | { type: 'company'; slug: string } | { type: 'redirect'; to: string } | { type: 'not_found' };

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
