import { CheckIcon, ChevronDownIcon, MapPinIcon, MenuIcon } from 'lucide-react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { PRIVACY_PATH } from '@shared/privacy';
import { aboutPath, branchPath, type PublicSite } from '@shared/public-site';
import { buttonVariants } from '@client/components/ui/button';
import { useCompany } from '@client/app/tenant-context';
import { cn } from '@client/lib/utils';
import { usePublicSite } from './api';
import { Disclosure } from './Disclosure';
import { SocialLinks } from './ui';

function Brand() {
  const company = useCompany();
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring">
      {company.logoUrl ? (
        <img
          src={company.logoUrl}
          alt=""
          width={36}
          height={36}
          className="size-9 shrink-0 rounded-md object-contain"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground"
        >
          {company.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate font-semibold">{company.name}</span>
    </Link>
  );
}

/** Selector de sede (solo con varias sedes). Muestra la sede actual si se está dentro de una. */
function BranchSwitcher({ site, current }: { site: PublicSite; current: string | undefined }) {
  if (site.branches.length < 2) return null;
  const active = site.branches.find((b) => b.slug === current);
  return (
    <Disclosure
      buttonClassName={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'max-w-44 gap-1.5 sm:max-w-56')}
      panelClassName="w-64"
      label={
        <>
          <MapPinIcon aria-hidden />
          <span className="truncate">{active?.name ?? 'Elegir sede'}</span>
          <ChevronDownIcon aria-hidden className="opacity-60" />
          <span className="sr-only"> (cambiar de sede)</span>
        </>
      }
    >
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Nuestras sedes</p>
      <ul>
        {site.branches.map((b) => (
          <li key={b.slug}>
            <Link
              to={branchPath(b.slug)}
              aria-current={b.slug === current ? 'page' : undefined}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{b.name}</span>
                {b.city && <span className="truncate text-xs text-muted-foreground">{b.city}</span>}
              </span>
              {b.slug === current && <CheckIcon aria-hidden className="size-4" />}
            </Link>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

function navLinks(site: PublicSite | undefined) {
  return [
    ...(site?.about_visible ? [{ to: aboutPath(), label: 'Acerca de' }] : []),
    { to: '/mis-reservas', label: 'Mis reservas' },
  ];
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn('text-sm text-muted-foreground hover:text-foreground', isActive && 'font-medium text-foreground');

function SiteFooter({ site }: { site: PublicSite | undefined }) {
  const company = useCompany();
  const footer = site?.company.footer ?? {};
  const links = footer.links ?? [];
  const socials = footer.show_socials === false ? [] : (site?.socials_company ?? []);
  return (
    <footer data-section="footer" className="mt-auto border-t bg-muted/30">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <p className="font-semibold">{company.name}</p>
          {footer.text && <p className="max-w-prose whitespace-pre-line text-muted-foreground">{footer.text}</p>}
          {footer.address && <p className="text-muted-foreground">{footer.address}</p>}
          <SocialLinks links={socials} />
        </div>
        {links.length > 0 && (
          <nav aria-label="Enlaces del sitio">
            <ul className="flex flex-col gap-2 sm:items-end">
              {links.map((l) =>
                l.url.startsWith('/') ? (
                  <li key={l.url + l.label}>
                    <Link to={l.url} className="text-muted-foreground underline-offset-4 hover:underline">
                      {l.label}
                    </Link>
                  </li>
                ) : (
                  <li key={l.url + l.label}>
                    <a
                      href={l.url}
                      {...(/^https?:/.test(l.url) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="text-muted-foreground underline-offset-4 hover:underline"
                    >
                      {l.label}
                    </a>
                  </li>
                ),
              )}
            </ul>
          </nav>
        )}
      </div>
      <div className="border-t">
        {/* Enlaces con al menos 24 px de alto (WCAG 2.5.8, Lighthouse target-size). */}
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="flex flex-wrap items-center gap-x-1">
            <span>
              © {new Date().getFullYear()} {company.name} ·
            </span>
            <Link to={PRIVACY_PATH} className="inline-flex min-h-6 items-center underline-offset-4 hover:underline">
              Política de privacidad
            </Link>
          </span>
          {footer.show_powered_by !== false && (
            <a
              href="https://servigo.roquintech.com"
              className="inline-flex min-h-6 items-center underline-offset-4 hover:underline"
            >
              Hecho con Servigo
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}

/**
 * Layout del sitio público: header (marca, selector de sede, enlaces), contenido y footer
 * configurable de la fase 05. Los datos vienen de `get_public_site` (caché de 60 s).
 */
export function Component() {
  const { branchSlug } = useParams();
  const site = usePublicSite();
  const links = navLinks(site.data);

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Brand />
          <div className="flex items-center gap-2 sm:gap-6">
            <nav aria-label="Principal" className="hidden items-center gap-6 sm:flex">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} className={linkClass}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
            {site.data && <BranchSwitcher site={site.data} current={branchSlug?.toLowerCase()} />}
            <div className="sm:hidden">
              <Disclosure
                buttonLabel="Menú"
                buttonClassName={buttonVariants({ variant: 'ghost', size: 'icon' })}
                panelClassName="w-52"
                label={<MenuIcon aria-hidden />}
              >
                <nav aria-label="Menú">
                  <ul>
                    {links.map((l) => (
                      <li key={l.to}>
                        <NavLink
                          to={l.to}
                          className={({ isActive }) =>
                            cn('block rounded-md px-3 py-2 text-sm hover:bg-accent', isActive && 'font-medium')
                          }
                        >
                          {l.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </nav>
              </Disclosure>
            </div>
          </div>
        </div>
      </header>
      <main id="contenido" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter site={site.data} />
    </div>
  );
}
