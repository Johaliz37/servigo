/**
 * Fase 09: datos del sitio público (forma de las RPC `get_public_*`), rutas, textos de precio
 * y SEO (sitemap, robots, meta por ruta). TS puro: lo usan el Worker, la SPA y los tests.
 * Sin date-fns: el bundle público usa `Intl` para fechas.
 */
import type { Footer, SocialNetwork } from './content';

export interface PublicDiscount {
  label: string | null;
  type: 'percent' | 'fixed';
  value: number;
  amount: number;
  ends_at: string;
}

export interface PublicImage {
  path: string;
  alt: string | null;
}

/** Ítem del catálogo como lo ve el cliente (precio ya calculado en SQL, D24). */
export interface PublicItem {
  id: string;
  kind: 'service' | 'product';
  name: string;
  short_description: string | null;
  duration_minutes: number | null;
  is_featured: boolean;
  cover: PublicImage | null;
  price: number;
  final_price: number;
  discount: PublicDiscount | null;
}

export interface PublicAddon extends Omit<PublicItem, 'duration_minutes' | 'is_featured'> {
  max_quantity: number;
}

export interface PublicItemDetail extends PublicItem {
  description: string | null;
  branch: { id: string; slug: string; name: string };
  photos: (PublicImage & { thumb_path: string | null })[];
  details: { label: string; value: string | null }[];
  addons: PublicAddon[];
}

export interface PublicSocial {
  network: SocialNetwork;
  label: string | null;
  url: string;
}

export interface PublicBranchCard {
  slug: string;
  name: string;
  city: string | null;
  cover_image_path: string | null;
  sort_order: number;
}

export interface PublicSite {
  company: {
    name: string;
    logo_path: string | null;
    hero_image_path: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    footer: Partial<Footer>;
    seo: { title?: string; description?: string; image_path?: string | null };
    contact: { email: string | null; phone: string | null; whatsapp: string | null };
  };
  branches: PublicBranchCard[];
  socials_company: PublicSocial[];
  about_visible: boolean;
}

export interface PublicBranchHeader {
  title?: string;
  subtitle?: string;
  image_path?: string | null;
  overlay_opacity?: number;
}

export interface PublicSponsor {
  name: string;
  description: string | null;
  image_path: string | null;
  url: string | null;
}

export interface PublicBranch {
  branch: {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    header: PublicBranchHeader;
    cover_image_path: string | null;
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
    maps_url: string | null;
    timezone: string;
  };
  services: PublicItem[];
  products: PublicItem[];
  sponsors: PublicSponsor[];
  socials: PublicSocial[];
  about_branch_visible: boolean;
}

export interface PublicAboutSection {
  branch_slug: string | null;
  branch_name: string | null;
  title: string;
  body: string;
  image_path: string | null;
}

export interface PublicSitemap {
  about_visible: boolean;
  branches: { slug: string; items: { id: string; kind: 'service' | 'product' }[] }[];
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export const branchPath = (branchSlug: string) => `/s/${encodeURIComponent(branchSlug)}`;

export const itemPath = (branchSlug: string, item: Pick<PublicItem, 'id' | 'kind'>) =>
  `${branchPath(branchSlug)}/${item.kind === 'service' ? 'servicios' : 'productos'}/${item.id}`;

/** Asistente de reserva (fase 10). */
export const bookingPath = (branchSlug: string, serviceId?: string) =>
  `${branchPath(branchSlug)}/reservar${serviceId ? `/${serviceId}` : ''}`;

export const aboutPath = (branchSlug?: string | null) => (branchSlug ? `/acerca#sede-${branchSlug}` : '/acerca');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTE_ITEM = new RegExp(`^/s/([^/]+)/(servicios|productos)/(${UUID})/?$`, 'i');
const ROUTE_BRANCH = /^\/s\/([^/]+)\/?$/;

/** Ruta pública con meta propia: ficha de un ítem o página de sede. */
export type PublicRoute =
  | { type: 'item'; branchSlug: string; kind: 'service' | 'product'; id: string }
  | { type: 'branch'; branchSlug: string }
  | null;

export function matchPublicRoute(path: string): PublicRoute {
  const item = ROUTE_ITEM.exec(path);
  if (item) {
    return {
      type: 'item',
      branchSlug: safeDecode(item[1]!),
      kind: item[2] === 'servicios' ? 'service' : 'product',
      id: item[3]!.toLowerCase(),
    };
  }
  const branch = ROUTE_BRANCH.exec(path);
  return branch ? { type: 'branch', branchSlug: safeDecode(branch[1]!) } : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// Precios y textos
// ---------------------------------------------------------------------------

/** "30 nov": día y mes corto, sin el «de» ni el punto que añade Intl en español. */
function fmtDayMonth(iso: string, timeZone: string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).formatToParts(
    new Date(iso),
  );
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = (parts.find((p) => p.type === 'month')?.value ?? '').replace('.', '');
  return `${day} ${month}`;
}

/** "Hasta el 30 nov" (fecha límite en la zona de la empresa). */
export function discountDeadline(
  discount: Pick<PublicDiscount, 'ends_at'>,
  timeZone: string,
  locale = 'es-CO',
): string {
  return `Hasta el ${fmtDayMonth(discount.ends_at, timeZone, locale)}`;
}

/** "−15 %" o el ahorro en dinero, para el badge. */
export function discountOff(discount: PublicDiscount, money: (amount: number) => string, locale = 'es-CO'): string {
  return discount.type === 'percent'
    ? `−${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(discount.value)} %`
    : `−${money(discount.amount)}`;
}

/** "30 min", "1 h", "1 h 30 min". */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Enlace de WhatsApp a partir de un número guardado como texto. */
export function whatsappUrl(phone: string | null | undefined, text?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function telUrl(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const plus = phone.trim().startsWith('+');
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 ? `tel:${plus ? '+' : ''}${digits}` : null;
}

/** Enlace a Google Maps: el guardado o una búsqueda por dirección. */
export function mapsUrl(branch: Pick<PublicBranch['branch'], 'maps_url' | 'address' | 'city'>): string | null {
  if (branch.maps_url) return branch.maps_url;
  const query = [branch.address, branch.city].filter(Boolean).join(', ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

/** Texto plano corto para meta description (sin Markdown). */
export function plainExcerpt(markdown: string | null | undefined, max = 160): string {
  if (!markdown) return '';
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// ---------------------------------------------------------------------------
// SEO del Worker
// ---------------------------------------------------------------------------

/** robots.txt por tenant: indexa el sitio público, nunca el panel ni las reservas. */
export function robotsTxt(origin: string, isCompany: boolean): string {
  const lines = ['User-agent: *'];
  if (isCompany) {
    lines.push('Disallow: /admin', 'Disallow: /reserva/', 'Disallow: /mis-reservas', 'Disallow: /api/');
    lines.push('Allow: /', '', `Sitemap: ${origin}/sitemap.xml`);
  } else {
    lines.push('Disallow: /console', 'Disallow: /api/', 'Allow: /');
  }
  return `${lines.join('\n')}\n`;
}

const xmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** sitemap.xml de una empresa: inicio, «Acerca de», sedes y fichas. */
export function sitemapXml(origin: string, data: PublicSitemap): string {
  const paths = ['/'];
  if (data.about_visible) paths.push('/acerca');
  for (const branch of data.branches) {
    paths.push(branchPath(branch.slug));
    for (const item of branch.items) paths.push(itemPath(branch.slug, item));
  }
  const urls = paths.map((p) => `<url><loc>${xmlEscape(origin + p)}</loc></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

// ---------------------------------------------------------------------------
// Datos iniciales en el HTML (`window.__PUBLIC__`)
// ---------------------------------------------------------------------------

/** Claves de los datos que el Worker incrusta en el HTML y la SPA siembra en su caché. */
export const publicDataKey = {
  site: () => 'site',
  branch: (branchSlug: string) => `branch:${branchSlug.toLowerCase()}`,
  item: (branchSlug: string, id: string) => `item:${branchSlug.toLowerCase()}:${id.toLowerCase()}`,
};
