import { CalendarSearchIcon, MenuIcon } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { Button } from '@client/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@client/components/ui/sheet';
import { useCompany } from '@client/app/tenant-context';
import { cn } from '@client/lib/utils';

const LINKS = [
  { to: '/acerca', label: 'Acerca de' },
  { to: '/mis-reservas', label: 'Mis reservas' },
];

function Brand() {
  const company = useCompany();
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2">
      {company.logoUrl ? (
        <img src={company.logoUrl} alt="" className="size-9 shrink-0 rounded-md object-contain" />
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

/**
 * Layout del sitio público: header, contenido y footer. El selector de sede y el footer
 * configurable se completan en la fase 09 (datos de `get_public_site`).
 */
export function Component() {
  const company = useCompany();
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn('text-sm text-muted-foreground hover:text-foreground', isActive && 'font-medium text-foreground');

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Brand />
          <nav aria-label="Principal" className="hidden items-center gap-6 sm:flex">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Abrir menú">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>{company.name}</SheetTitle>
              </SheetHeader>
              <nav aria-label="Principal" className="flex flex-col gap-4 px-4">
                {LINKS.map((l) => (
                  <NavLink key={l.to} to={l.to} className={linkClass}>
                    {l.label}
                  </NavLink>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <span>
            © {new Date().getFullYear()} {company.name}
          </span>
          <a href="https://servigo.roquintech.com" className="underline-offset-4 hover:underline">
            Reservas con Servigo
          </a>
        </div>
      </footer>
    </div>
  );
}

/** Inicio provisional (la fase 09 lo reemplaza por el selector de sede / sede única). */
export function HomePage() {
  const company = useCompany();
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{company.name}</h1>
      <p className="mt-4 text-muted-foreground">{company.seo.description ?? 'Reserva en línea.'}</p>
      <Button className="mt-8" asChild>
        <Link to="/mis-reservas">
          <CalendarSearchIcon aria-hidden /> Consultar mi reserva
        </Link>
      </Button>
    </section>
  );
}

/** Secciones públicas que llegan en las fases 09–10. */
export function ComingSoonPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 text-center">
      <h1 className="text-2xl font-semibold">Muy pronto</h1>
      <p className="mt-4 text-muted-foreground">Esta sección estará disponible en breve.</p>
      <Button variant="outline" className="mt-8" asChild>
        <Link to="/">Volver al inicio</Link>
      </Button>
    </section>
  );
}
