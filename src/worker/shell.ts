/**
 * Esqueleto estático del sitio público (fase 09 §4): el Worker lo pone dentro de `#root` para
 * que el encabezado y el título (el elemento LCP) se vean antes de que llegue y se ejecute el
 * JS. React lo reemplaza al montar (`createRoot` borra el contenido), sin desplazar nada: son
 * nodos nuevos. Usa las mismas clases que `PublicLayout`, `HomePage`, `BranchPage`, `ItemPage`
 * y `AboutPage`; si esas
 * pantallas cambian de forma, hay que ajustar esto.
 */
import { brandCssVariables } from '@shared/color';
import type { PublicBranch, PublicItemDetail, PublicSite } from '@shared/public-site';
import { mediaUrl, type TenantCompany } from '@shared/tenant';
import { escapeHtml as e } from './html';

export type ShellPage =
  | { type: 'home'; site: PublicSite }
  | { type: 'branch'; data: PublicBranch }
  | { type: 'item'; item: PublicItemDetail }
  | { type: 'about' };

/** `style` de `<html>` con la marca: evita el destello del color por defecto antes del JS. */
export function brandStyle(company: TenantCompany): string {
  return Object.entries(brandCssVariables(company.primaryColor, company.secondaryColor))
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}

function headerBar(company: TenantCompany): string {
  const logo = company.logoUrl
    ? `<img src="${e(company.logoUrl)}" alt="" width="36" height="36" class="size-9 shrink-0 rounded-md object-contain">`
    : `<span aria-hidden="true" class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground">${e(company.name.charAt(0).toUpperCase())}</span>`;
  return `<header class="sticky top-0 z-40 border-b bg-background/90"><div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4"><a href="/" class="flex min-w-0 items-center gap-2">${logo}<span class="truncate font-semibold">${e(company.name)}</span></a></div></header>`;
}

/** `<img>` de portada como `PublicImg` (miniatura + grande) con prioridad alta. */
function cover(supabaseUrl: string, path: string, overlay: number): string {
  const main = mediaUrl(supabaseUrl, path)!;
  const thumb = path.endsWith('.webp') ? mediaUrl(supabaseUrl, path.replace(/\.webp$/, '.thumb.webp')) : null;
  const srcset = thumb ? ` srcset="${e(thumb)} 400w, ${e(main)} 1600w" sizes="100vw"` : '';
  return `<img src="${e(main)}"${srcset} alt="" width="1600" height="900" fetchpriority="high" class="absolute inset-0 -z-10 size-full object-cover"><div aria-hidden="true" class="absolute inset-0 -z-10 bg-black" style="opacity:${overlay}"></div>`;
}

function branchHero(supabaseUrl: string, data: PublicBranch): string {
  const b = data.branch;
  const image = b.header.image_path ?? b.cover_image_path;
  const title = b.header.title?.trim() || b.name;
  const subtitle = b.header.subtitle?.trim();
  const overlay = Math.min(0.9, Math.max(0, Number(b.header.overlay_opacity ?? 0.4)));
  const sectionClass = image
    ? 'relative isolate overflow-hidden text-white'
    : 'relative isolate overflow-hidden bg-gradient-to-br from-primary/15 via-background to-background';
  const sub = subtitle
    ? `<p class="text-lg ${image ? 'text-white/90' : 'text-muted-foreground'}">${e(subtitle)}</p>`
    : '';
  return `<section class="${sectionClass}">${image ? cover(supabaseUrl, image, overlay) : ''}<div class="mx-auto flex min-h-[22rem] max-w-6xl flex-col justify-end gap-5 px-4 py-12 sm:min-h-[28rem] sm:py-16"><div class="max-w-2xl space-y-3"><h1 class="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">${e(title)}</h1>${sub}</div></div></section>`;
}

function homeHero(supabaseUrl: string, company: TenantCompany, site: PublicSite): string {
  const hero = site.company.hero_image_path;
  const description = company.seo.description?.trim();
  const img = hero
    ? `${cover(supabaseUrl, hero, 0.45).replace('width="1600" height="900"', 'width="1600" height="700"')}`
    : '<div aria-hidden="true" class="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-background"></div>';
  const desc = description
    ? `<p class="mt-4 text-lg text-pretty ${hero ? 'text-white/90' : 'text-muted-foreground'}">${e(description)}</p>`
    : '';
  return `<section class="relative isolate overflow-hidden">${img}<div class="mx-auto max-w-3xl px-4 py-16 text-center sm:py-24 ${hero ? 'text-white' : ''}"><h1 class="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">${e(company.name)}</h1>${desc}</div></section>`;
}

/** Ficha: ruta, primera foto (o el fondo de marca) y título, como en `ItemPage`. */
function itemMain(supabaseUrl: string, item: PublicItemDetail): string {
  const photo = item.photos[0];
  let gallery: string;
  if (photo) {
    const main = mediaUrl(supabaseUrl, photo.path)!;
    const thumb = photo.path.endsWith('.webp')
      ? mediaUrl(supabaseUrl, photo.path.replace(/.webp$/, '.thumb.webp'))
      : null;
    const srcset = thumb ? ` srcset="${e(thumb)} 400w, ${e(main)} 1600w" sizes="(min-width: 1024px) 50vw, 100vw"` : '';
    gallery = `<div class="overflow-hidden rounded-2xl bg-muted"><img src="${e(main)}"${srcset} alt="${e(photo.alt ?? '')}" width="1600" height="1200" fetchpriority="high" class="aspect-[4/3] w-full object-cover"></div>`;
  } else {
    gallery = `<div aria-hidden="true" class="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-gradient-to-br from-primary/85 to-primary/50 text-7xl font-semibold text-primary-foreground/90">${e(item.name.charAt(0).toUpperCase())}</div>`;
  }
  const sub = item.short_description ? `<p class="text-lg text-muted-foreground">${e(item.short_description)}</p>` : '';
  return `<nav aria-label="Ruta" class="mx-auto max-w-6xl px-4 pt-6 text-sm text-muted-foreground"><ol class="flex flex-wrap items-center gap-1"><li>${e(item.branch.name)}</li></ol></nav><div class="mx-auto grid max-w-6xl gap-8 px-4 py-6 lg:grid-cols-2 lg:gap-12">${gallery}<div class="space-y-6"><div class="space-y-3"><h1 class="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">${e(item.name)}</h1>${sub}</div></div></div>`;
}

/** HTML del esqueleto, o `null` si la página no tiene uno (la SPA pinta su propia carga). */
export function publicShell(supabaseUrl: string, company: TenantCompany, page: ShellPage | null): string | null {
  if (!page) return null;
  let main: string;
  if (page.type === 'branch') main = branchHero(supabaseUrl, page.data);
  else if (page.type === 'item') main = itemMain(supabaseUrl, page.item);
  else if (page.type === 'about')
    main = `<div class="mx-auto max-w-3xl px-4 py-10 sm:py-14"><h1 class="mb-8 text-3xl font-semibold tracking-tight sm:text-4xl">Acerca de ${e(company.name)}</h1></div>`;
  else if (page.site.branches.length > 1) main = homeHero(supabaseUrl, company, page.site);
  else return null; // Con una sola sede el inicio redirige: no hay nada que adelantar.
  return `<div class="flex min-h-svh flex-col bg-background">${headerBar(company)}<main class="flex-1">${main}</main></div>`;
}
