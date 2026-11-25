import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon, PrinterIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { dayStartInstant, localDate, DAY } from '@shared/availability';
import { formatCode, formatTime } from '@shared/booking';
import { formatInTimeZone } from '@shared/format';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Skeleton } from '@client/components/ui/skeleton';
import { useCompany } from '@client/app/tenant-context';
import { supabase } from '@client/lib/supabase';
import { useSelectedBranch } from '@client/features/admin/branch-context';
import { StatusBadge } from './status';

interface AgendaRow {
  id: string;
  code: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  starts_at: string;
  ends_at: string;
  customer_name: string;
  customer_phone: string;
  customer_notes: string | null;
  internal_notes: string | null;
  service_name: string;
  branch_id: string;
  items: { name: string; quantity: number }[];
}

/**
 * Agenda del día imprimible `/admin/reservas/agenda?date=` (fase 11 §4): reservas no canceladas
 * por sede, en orden, con estilos de impresión (el menú y la cabecera del panel se ocultan).
 */
export function Component() {
  const company = useCompany();
  const { branches, selectedId } = useSelectedBranch();
  const [params, setParams] = useSearchParams();
  const visible = selectedId ? branches.filter((b) => b.id === selectedId) : branches;
  const tz = visible[0]?.timezone ?? company.timezone;
  const [today] = useState(() => localDate(Date.now(), tz));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today;

  const query = useQuery({
    queryKey: ['admin-bookings', company.id, 'agenda', date, selectedId],
    queryFn: async (): Promise<AgendaRow[]> => {
      // Margen de un día a cada lado: cada sede puede tener su zona; se filtra abajo.
      const from = dayStartInstant(date, tz) - DAY;
      let q = supabase
        .from('bookings')
        .select(
          'id, code, status, starts_at, ends_at, customer_name, customer_phone, customer_notes, internal_notes, service_name, branch_id, items:booking_items(name, quantity)',
        )
        .eq('company_id', company.id)
        .neq('status', 'cancelled')
        .gte('starts_at', new Date(from).toISOString())
        .lt('starts_at', new Date(from + 3 * DAY).toISOString())
        .order('starts_at');
      if (selectedId) q = q.eq('branch_id', selectedId);
      const { data, error } = await q;
      if (error) throw error;
      return data as AgendaRow[];
    },
  });

  const groups = useMemo(
    () =>
      visible
        .map((b) => ({
          branch: b,
          rows: (query.data ?? []).filter(
            (r) => r.branch_id === b.id && localDate(Date.parse(r.starts_at), b.timezone) === date,
          ),
        }))
        .filter((g) => g.rows.length > 0 || visible.length === 1),
    [visible, query.data, date],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 print:max-w-none">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/admin/reservas">
            <ArrowLeftIcon aria-hidden /> Reservas
          </Link>
        </Button>
        <div className="flex items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="agenda-date">Día</Label>
            <Input
              id="agenda-date"
              type="date"
              value={date}
              onChange={(e) => e.target.value && setParams({ date: e.target.value }, { replace: true })}
            />
          </div>
          <Button onClick={() => window.print()}>
            <PrinterIcon aria-hidden /> Imprimir
          </Button>
        </div>
      </div>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agenda del día</h1>
        <p className="text-muted-foreground capitalize print:text-black">
          {formatInTimeZone(dayStartInstant(date, tz) + 12 * 3_600_000, tz, "EEEE d 'de' MMMM 'de' yyyy")} ·{' '}
          {company.name}
        </p>
      </header>

      {query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : groups.length === 0 ? (
        <p className="text-muted-foreground">No hay reservas este día.</p>
      ) : (
        groups.map(({ branch, rows }) => (
          <section key={branch.id} className="break-inside-avoid-page space-y-2">
            <h2 className="text-lg font-semibold">
              {branch.name} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span>
            </h2>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin reservas.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground print:text-black">
                    <th className="py-1.5 pr-3 font-medium">Hora</th>
                    <th className="py-1.5 pr-3 font-medium">Cliente</th>
                    <th className="py-1.5 pr-3 font-medium">Servicio</th>
                    <th className="py-1.5 pr-3 font-medium">Notas</th>
                    <th className="py-1.5 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="break-inside-avoid border-b align-top">
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                        {formatTime(r.starts_at, branch.timezone)}–{formatTime(r.ends_at, branch.timezone)}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{r.customer_name}</div>
                        <div className="text-muted-foreground tabular-nums print:text-black">{r.customer_phone}</div>
                      </td>
                      <td className="py-2 pr-3">
                        {r.service_name}
                        {r.items.length > 0 && (
                          <div className="text-muted-foreground print:text-black">
                            {r.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
                          </div>
                        )}
                        <div className="font-mono text-xs text-muted-foreground print:text-black">
                          {formatCode(r.code)}
                        </div>
                      </td>
                      <td className="max-w-56 py-2 pr-3 break-words whitespace-pre-wrap">
                        {[r.customer_notes, r.internal_notes].filter(Boolean).join('\n')}
                      </td>
                      <td className="py-2">
                        <StatusBadge
                          status={r.status}
                          className="print:border-black print:bg-transparent print:text-black"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))
      )}
    </div>
  );
}
