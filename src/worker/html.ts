/**
 * HTML que genera el Worker: meta/SEO del tenant (vía HTMLRewriter) y páginas de error.
 * Funciones puras para poder probarlas sin el runtime de Workers.
 */
import type { ClientTenant } from '@shared/tenant';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON seguro dentro de `<script>`: nada puede cerrar la etiqueta ni abrir comentarios HTML. */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEPARATORS, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);
}

// U+2028 y U+2029 (v\u00e1lidos en JSON, antes no en JS); se construye sin el car\u00e1cter literal.
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

export const PLATFORM_TITLE = 'Servigo · Reservas en línea para tu negocio';
export const PLATFORM_DESCRIPTION =
  'Servigo es la plataforma de reservas para barberías, spas y negocios de servicios: catálogo, agenda y reservas en línea.';

export interface HeadContent {
  title: string;
  /** Etiquetas a añadir al final de `<head>` (ya escapadas). */
  tags: string;
}

/** Meta propios de una página pública (ficha de servicio, sede), ya resueltos por el Worker. */
export interface PageMeta {
  title: string;
  description?: string | null;
  /** URL absoluta de la imagen para compartir (`og:image`). */
  image?: string | null;
}

/**
 * `<title>`, descripción, Open Graph, favicon y `window.__TENANT__` para la ruta `path`.
 * `page` reemplaza título, descripción e imagen (fase 09: al compartir un servicio por
 * WhatsApp se ve su nombre y su foto). `initialData` va a `window.__PUBLIC__`: la SPA pinta sin
 * esperar a la API.
 */
export function buildHead(
  tenant: ClientTenant,
  path: string,
  page?: PageMeta | null,
  initialData?: Record<string, unknown>,
): HeadContent {
  const isPrivate = path.startsWith('/admin') || path.startsWith('/console');
  let title: string;
  let description: string;
  let siteName: string;
  let image: string | null = null;
  let favicon: string | null = null;
  let themeColor: string | null = null;

  if (tenant.type === 'company') {
    const c = tenant.company;
    siteName = c.name;
    title = isPrivate ? `Administración · ${c.name}` : c.seo.title?.trim() || c.name;
    description = c.seo.description?.trim() || `Reserva en línea con ${c.name}.`;
    image = c.logoUrl;
    favicon = c.faviconUrl ?? c.logoUrl;
    themeColor = c.primaryColor;
    if (page && !isPrivate) {
      title = page.title;
      description = page.description?.trim() || description;
      image = page.image ?? image;
    }
  } else {
    siteName = 'Servigo';
    title = path.startsWith('/console') ? 'Consola · Servigo' : PLATFORM_TITLE;
    description = PLATFORM_DESCRIPTION;
  }

  const meta = (attr: 'name' | 'property', key: string, content: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(content)}">`;

  const tags = [
    meta('name', 'description', description),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', siteName),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    image ? meta('property', 'og:image', image) : '',
    meta('name', 'twitter:card', page?.image ? 'summary_large_image' : 'summary'),
    themeColor ? meta('name', 'theme-color', themeColor) : '',
    favicon ? `<link rel="icon" href="${escapeHtml(favicon)}">` : '',
    isPrivate ? meta('name', 'robots', 'noindex, nofollow') : '',
    `<script>window.__TENANT__=${inlineJson(tenant)}</script>`,
    initialData && Object.keys(initialData).length
      ? `<script>window.__PUBLIC__=${inlineJson(initialData)}</script>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  return { title, tags };
}

/** Página completa (sin SPA) para 404 de tenant, empresa suspendida, etc. */
export function statusPage(opts: { title: string; heading: string; message: string }): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(opts.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 24px;
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #fafafa; color: #171717; }
  main { max-width: 28rem; text-align: center; }
  h1 { font-size: 1.5rem; margin: 0 0 .75rem; }
  p { margin: 0 0 1.5rem; line-height: 1.5; color: #525252; }
  small { color: #737373; }
  @media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #fafafa; } p { color: #a3a3a3; } }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(opts.heading)}</h1>
<p>${escapeHtml(opts.message)}</p>
<small>Servigo</small>
</main>
</body>
</html>`;
}

export const PAGES = {
  companyNotFound: () =>
    statusPage({
      title: 'Empresa no encontrada · Servigo',
      heading: 'Esta empresa no existe',
      message: 'Revisa la dirección. Si crees que es un error, contacta a la empresa que te compartió el enlace.',
    }),
  siteNotFound: () =>
    statusPage({
      title: 'Sitio no encontrado · Servigo',
      heading: 'Sitio no encontrado',
      message: 'Esta dirección no corresponde a ningún sitio de Servigo.',
    }),
  suspended: (name: string) =>
    statusPage({
      title: `${name} · No disponible`,
      heading: 'Sitio temporalmente no disponible',
      message: `El sitio de ${name} no está disponible en este momento. Vuelve a intentarlo más tarde.`,
    }),
  unavailable: () =>
    statusPage({
      title: 'Servicio no disponible · Servigo',
      heading: 'Estamos teniendo problemas',
      message: 'No pudimos cargar el sitio. Vuelve a intentarlo en unos minutos.',
    }),
};
