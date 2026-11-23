import { CalendarCheckIcon, GlobeIcon, LayoutDashboardIcon, SmartphoneIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@client/components/ui/button';

const FEATURES = [
  {
    icon: GlobeIcon,
    title: 'Tu sitio propio',
    text: 'Cada negocio tiene su página con su marca, sedes, servicios y productos.',
  },
  {
    icon: CalendarCheckIcon,
    title: 'Reservas en línea',
    text: 'Tus clientes reservan sin crear cuenta y consultan su reserva con un código.',
  },
  {
    icon: LayoutDashboardIcon,
    title: 'Panel de gestión',
    text: 'Agenda tipo calendario, horarios por sede y control de reservas.',
  },
  { icon: SmartphoneIcon, title: 'Hecho para el celular', text: 'Rápido y cómodo en cualquier pantalla.' },
];

/** Landing comercial de Servigo (estática). */
export function Component() {
  return (
    <div className="min-h-svh bg-background">
      <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <span className="text-lg font-semibold">Servigo</span>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/console">Consola</Link>
        </Button>
      </header>
      <main>
        <section className="mx-auto max-w-3xl px-4 py-20 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Reservas en línea para tu negocio de servicios
          </h1>
          <p className="mt-6 text-lg text-pretty text-muted-foreground">
            Barberías, spas, consultorios y más: muestra tu catálogo, publica tus horarios y recibe reservas las 24
            horas.
          </p>
        </section>
        <section aria-label="Funciones" className="mx-auto grid max-w-5xl gap-6 px-4 pb-24 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg border p-6">
              <f.icon className="size-6 text-primary" aria-hidden />
              <h2 className="mt-4 font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        Servigo · un producto de Roquintech
      </footer>
    </div>
  );
}
