import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { searchFilter } from '@shared/booking-admin';
import { formatMoney } from '@shared/format';
import { isAnonymizedPhone } from '@shared/privacy';
import { PageHeader } from '@client/components/common/PageHeader';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@client/components/ui/alert-dialog';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@client/components/ui/sheet';
import { Skeleton } from '@client/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@client/components/ui/table';
import { Textarea } from '@client/components/ui/textarea';
import { useCompany } from '@client/app/tenant-context';
import { useMembership } from '@client/features/auth/membership';
import { toastError } from '@client/lib/errors';
import { supabase } from '@client/lib/supabase';
import { useCustomerBookings } from './api';
import { formatWhenShort } from './helpers';
import { StatusBadge } from './status';

const PAGE = 25;

interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  bookings_count: number;
  last_visit_at: string | null;
  total_spent: number;
  next_booking_at: string | null;
}

function useCustomers(q: string, page: number) {
  const company = useCompany();
  return useQuery({
    queryKey: ['customers', company.id, 'list', q, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase
        .from('customer_stats')
        .select('id, name, phone, email, notes, bookings_count, last_visit_at, total_spent, next_booking_at', {
          count: 'exact',
        })
        .eq('company_id', company.id);
      const or = searchFilter(q, { code: 'id', name: 'name', email: 'email', phone: 'phone' });
      if (or) {
        query = query.or(
          or
            .split(',')
            .filter((p) => !p.startsWith('id.'))
            .join(','),
        );
      }
      const { data, error, count } = await query
        .order('last_visit_at', { ascending: false, nullsFirst: false })
        .order('name')
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as CustomerRow[], total: count ?? 0 };
    },
  });
}

/** Clientes `/admin/clientes` (fase 11 §5): nº de reservas, última visita y total gastado. */
export function Component() {
  const company = useCompany();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const page = Math.max(0, Number(params.get('p') ?? 0) || 0);
  const [search, setSearch] = useState(q);
  const query = useCustomers(q, page);
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const openId = params.get('c');
  const open = rows.find((r) => r.id === openId) ?? null;
  const money = (n: number) => formatMoney(n, company.currency, company.locale);
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader title="Clientes" description="Se crean solos con cada reserva (por teléfono)." />
      <form
        role="search"
        className="mb-4 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: search.trim() || null, p: null });
        }}
      >
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            className="pl-8"
            aria-label="Buscar clientes"
            placeholder="Nombre, teléfono o correo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Correo</TableHead>
              <TableHead className="text-right">Reservas</TableHead>
              <TableHead>Última visita</TableHead>
              <TableHead className="text-right">Total gastado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No hay clientes{q ? ' con esa búsqueda' : ' todavía'}.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <button type="button" className="font-medium hover:underline" onClick={() => set({ c: c.id })}>
                      {c.name}
                    </button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {isAnonymizedPhone(c.phone) ? '—' : c.phone}
                  </TableCell>
                  <TableCell className="max-w-48 truncate">{c.email}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.bookings_count}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {c.last_visit_at ? formatWhenShort(c.last_visit_at, company.timezone) : '—'}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">{money(c.total_spent)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>{total === 0 ? '' : `${page * PAGE + 1}–${Math.min(total, (page + 1) * PAGE)} de ${total}`}</span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Página anterior"
            disabled={page === 0}
            onClick={() => set({ p: page - 1 ? String(page - 1) : null })}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Página siguiente"
            disabled={(page + 1) * PAGE >= total}
            onClick={() => set({ p: String(page + 1) })}
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      </div>

      <Sheet open={!!open} onOpenChange={(o) => !o && set({ c: null })}>
        <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-lg">
          <SheetHeader className="p-0">
            <SheetTitle>{open?.name}</SheetTitle>
            <SheetDescription>
              {open && isAnonymizedPhone(open.phone) ? 'Datos personales eliminados' : open?.phone}
            </SheetDescription>
          </SheetHeader>
          {open && <CustomerDetail key={open.id} customer={open} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function CustomerDetail({ customer }: { customer: CustomerRow }) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const { role } = useMembership();
  const anonymized = isAnonymizedPhone(customer.phone);
  const canErase = (role === 'owner' || role === 'platform_admin') && !anonymized;
  const [name, setName] = useState(customer.name);
  const [email, setEmail] = useState(customer.email ?? '');
  const [notes, setNotes] = useState(customer.notes ?? '');
  const bookings = useCustomerBookings(customer.id);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('customers')
        .update({ name: name.trim(), email: email.trim() || null, notes: notes.trim() || null })
        .eq('id', customer.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Cliente actualizado');
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: toastError,
  });
  // Derecho de supresión (Ley 1581, D31): borra datos personales y conserva las cifras.
  const erase = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('anonymize_customer', { p_customer: customer.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Datos personales eliminados');
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: toastError,
  });

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-lg border p-2">
          <dt className="text-xs text-muted-foreground">Reservas</dt>
          <dd className="text-lg font-semibold tabular-nums">{customer.bookings_count}</dd>
        </div>
        <div className="rounded-lg border p-2">
          <dt className="text-xs text-muted-foreground">Última visita</dt>
          <dd className="font-medium">
            {customer.last_visit_at ? formatWhenShort(customer.last_visit_at, company.timezone).split(',')[0] : '—'}
          </dd>
        </div>
        <div className="rounded-lg border p-2">
          <dt className="text-xs text-muted-foreground">Total gastado</dt>
          <dd className="font-medium tabular-nums">
            {formatMoney(customer.total_spent, company.currency, company.locale)}
          </dd>
        </div>
      </dl>

      {anonymized ? (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          Los datos personales de este cliente se eliminaron a petición suya. Sus reservas se conservan sin nombre,
          teléfono ni correo.
        </p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return void toast.error('Escribe el nombre');
            save.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="cu-name">Nombre</Label>
            <Input id="cu-name" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cu-email">Correo</Label>
            <Input id="cu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cu-notes">Notas</Label>
            <Textarea
              id="cu-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Preferencias, alergias…"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            El teléfono identifica al cliente: para cambiarlo, edita una de sus reservas.
          </p>
          <Button type="submit" disabled={save.isPending}>
            Guardar
          </Button>
        </form>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Historial de reservas</h3>
        {bookings.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {(bookings.data ?? []).map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 p-2.5">
                <Link to={`/admin/reservas/${b.id}`} className="min-w-0 truncate hover:underline">
                  {formatWhenShort(b.starts_at, b.branch?.timezone ?? company.timezone)} · {b.service_name}
                </Link>
                <StatusBadge status={b.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {canErase && (
        <section className="space-y-2 rounded-lg border border-destructive/40 p-4">
          <h3 className="text-sm font-medium">Eliminar datos personales</h3>
          <p className="text-sm text-muted-foreground">
            Si el cliente lo pide, borra su nombre, teléfono, correo, notas y respuestas de todas sus reservas. Las
            reservas y sus cifras se conservan. No se puede deshacer.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={erase.isPending}>
                Eliminar datos de {customer.name}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar los datos de {customer.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se borrarán sus datos personales de {customer.bookings_count}{' '}
                  {customer.bookings_count === 1 ? 'reserva' : 'reservas'}. Ya no podrá consultarlas con su teléfono.
                  Esta acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => erase.mutate()}
                >
                  Eliminar datos
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      )}
    </div>
  );
}
