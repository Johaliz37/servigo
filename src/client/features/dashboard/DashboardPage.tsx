import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownRightIcon, ArrowUpRightIcon, CopyIcon, MinusIcon, PhoneIcon, QrCodeIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { localDate } from '@shared/availability';
import { formatCode } from '@shared/booking';
import {
  bucketFor,
  delta,
  isRangePreset,
  previousRange,
  rangeInstants,
  resolveRange,
  RANGE_PRESETS,
  type DateRange,
} from '@shared/dashboard';
import { formatInTimeZone, formatMoney } from '@shared/format';
import { PageHeader } from '@client/components/common/PageHeader';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/components/ui/card';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Skeleton } from '@client/components/ui/skeleton';
import { useCompany } from '@client/app/tenant-context';
import { toastError } from '@client/lib/errors';
import { cn } from '@client/lib/utils';
import { useMembership } from '@client/features/auth/membership';
import { useSession } from '@client/features/auth/session';
import { useSelectedBranch } from '@client/features/admin/branch-context';
import { useChangeStatus } from '@client/features/bookings/api';
import { StatusBadge } from '@client/features/bookings/status';
import {
  useByBranch,
  useHasBookings,
  useHeatmap,
  useKpis,
  useOccupancy,
  useShortList,
  useTimeseries,
  useTopProducts,
  useTopServices,
  type DashboardScope,
  type ShortBooking,
} from './api';
import { ChartCard, Heatmap, MeterList, StatusBar } from './viz';
import './dashboard.css';

const TimeChart = lazy(() => import('./TimeChart'));

/** Inicio del panel (fase 12): indicadores, listas del día y gráficas del periodo. */
export function Component() {
  const company = useCompany();
  const { session } = useSession();
  const { role } = useMembership();
  const { selected, selectedId, branches } = useSelectedBranch();
  const [params, setParams] = useSearchParams();
  const tz = selected?.timezone ?? company.timezone;
  const [today] = useState(() => localDate(Date.now(), tz));
  const presetParam = params.get('rango');
  const preset = isRangePreset(presetParam) ? presetParam : '30d';
  const range = resolveRange(preset, today, {
    from: params.get('desde') ?? undefined,
    to: params.get('hasta') ?? undefined,
  });
  const prev = previousRange(range);

  const scope: DashboardScope = useMemo(() => {
    const r = rangeInstants(range, tz);
    return { branchId: selectedId, from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString() };
  }, [range.from, range.to, tz, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevScope = useMemo(() => {
    const r = rangeInstants(prev, tz);
    return { from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString() };
  }, [prev.from, prev.to, tz]); // eslint-disable-line react-hooks/exhaustive-deps

  const bucket = bucketFor(range);
  const isManager = role === 'owner' || role === 'admin' || role === 'platform_admin';
  const kpis = useKpis(scope);
  const series = useTimeseries(scope, bucket);
  const services = useTopServices(scope);
  const products = useTopProducts(scope);
  const heat = useHeatmap(scope);
  const showBranches = isManager && !selectedId && branches.length > 1;
  const byBranch = useByBranch(scope, showBranches);
  const occ = useOccupancy(scope, prevScope, branches);
  const hasBookings = useHasBookings();

  const seeRevenue = kpis.data?.can_see_revenue ?? false;
  const money = (n: number) => formatMoney(n, company.currency, company.locale);
  const compact = (n: number) =>
    new Intl.NumberFormat(company.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const percent = (n: number) =>
    new Intl.NumberFormat(company.locale, { style: 'percent', maximumFractionDigits: 1 }).format(n);
  const bucketLabel = (b: string) => {
    if (!b) return '';
    const noon = `${b}T12:00:00Z`;
    if (bucket === 'month') return formatInTimeZone(noon, 'UTC', 'MMM yyyy');
    return formatInTimeZone(noon, 'UTC', bucket === 'week' ? "'sem.' d MMM" : 'd MMM');
  };

  function setRange(next: Partial<Record<'rango' | 'desde' | 'hasta', string | null>>) {
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(next)) {
          if (v) n.set(k, v);
          else n.delete(k);
        }
        return n;
      },
      { replace: true },
    );
  }

  const cur = kpis.data?.current;
  const before = kpis.data?.previous;
  const empty = hasBookings.data === false;
  const rangeText =
    range.from === range.to
      ? formatInTimeZone(`${range.from}T12:00:00Z`, 'UTC', "EEEE d 'de' MMMM")
      : `${formatInTimeZone(`${range.from}T12:00:00Z`, 'UTC', 'd MMM')} – ${formatInTimeZone(`${range.to}T12:00:00Z`, 'UTC', 'd MMM yyyy')}`;

  return (
    <>
      <PageHeader
        title={`Hola, ${session?.user.email?.split('@')[0] ?? ''}`}
        description={`${selected ? selected.name : 'Todas las sedes'} · ${rangeText}`}
      />

      <RangeBar
        preset={preset}
        range={range}
        onPreset={(id) => setRange({ rango: id === '30d' ? null : id, desde: null, hasta: null })}
        onCustom={(r) => setRange({ rango: 'custom', desde: r.from, hasta: r.to })}
      />

      {empty && <ShareCard />}

      <section aria-label="Indicadores" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label="Reservas"
          loading={kpis.isPending}
          value={cur ? String(cur.bookings_total) : ''}
          current={cur?.bookings_total ?? null}
          previous={before?.bookings_total ?? null}
          hint={cur ? `${cur.new_customers} clientes nuevos · ${cur.returning_customers} recurrentes` : undefined}
        />
        {seeRevenue || kpis.isPending ? (
          <>
            <Kpi
              label="Ingresos esperados"
              loading={kpis.isPending}
              value={cur?.revenue_expected != null ? money(cur.revenue_expected) : ''}
              current={cur?.revenue_expected ?? null}
              previous={before?.revenue_expected ?? null}
              hint={cur?.revenue_completed != null ? `${money(cur.revenue_completed)} ya completados` : undefined}
            />
            <Kpi
              label="Ticket promedio"
              loading={kpis.isPending}
              value={cur?.avg_ticket != null ? money(cur.avg_ticket) : ''}
              current={cur?.avg_ticket ?? null}
              previous={before?.avg_ticket ?? null}
            />
          </>
        ) : null}
        <Kpi
          label="Ocupación"
          loading={occ.isPending}
          value={occ.data?.current.rate != null ? percent(occ.data.current.rate) : '—'}
          current={occ.data?.current.rate ?? null}
          previous={occ.data?.previous.rate ?? null}
          hint={
            occ.data
              ? `${Math.round(occ.data.current.booked / 60)} h de ${Math.round(occ.data.current.offered / 60)} h ofrecidas`
              : undefined
          }
        />
        <Kpi
          label="Cancelaciones"
          loading={kpis.isPending}
          value={cur ? percent(cur.cancellation_rate) : ''}
          current={cur?.cancellation_rate ?? null}
          previous={before?.cancellation_rate ?? null}
          upIsBad
          hint={cur ? `No asistió: ${percent(cur.no_show_rate)}` : undefined}
        />
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ShortList kind="today" title="Próximas de hoy" branchId={selectedId} tz={tz} today={today} />
        <ShortList kind="pending" title="Pendientes por confirmar" branchId={selectedId} tz={tz} today={today} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Reservas en el tiempo"
          description={`Sin canceladas, por ${bucket === 'day' ? 'día' : bucket === 'week' ? 'semana' : 'mes'}`}
          loading={series.isPending}
          table={{
            head: ['Periodo', 'Reservas'],
            rows: (series.data ?? []).map((p) => [bucketLabel(p.bucket), p.bookings]),
          }}
        >
          <Suspense fallback={<Skeleton className="h-56 w-full" />}>
            <TimeChart
              label="Reservas"
              data={(series.data ?? []).map((p) => ({ bucket: p.bucket, value: p.bookings }))}
              format={bucketLabel}
              formatValue={(v) => String(v)}
            />
          </Suspense>
        </ChartCard>
        {seeRevenue && (
          <ChartCard
            title="Ingresos en el tiempo"
            description="Confirmadas y completadas"
            loading={series.isPending}
            table={{
              head: ['Periodo', 'Ingresos'],
              rows: (series.data ?? []).map((p) => [bucketLabel(p.bucket), money(p.revenue ?? 0)]),
            }}
          >
            <Suspense fallback={<Skeleton className="h-56 w-full" />}>
              <TimeChart
                label="Ingresos"
                data={(series.data ?? []).map((p) => ({ bucket: p.bucket, value: p.revenue ?? 0 }))}
                format={bucketLabel}
                formatTick={compact}
                formatValue={money}
              />
            </Suspense>
          </ChartCard>
        )}

        <ChartCard
          title="Servicios más reservados"
          loading={services.isPending}
          empty={services.data?.length === 0 ? 'Sin reservas en este periodo.' : null}
          table={{
            head: seeRevenue ? ['Servicio', 'Reservas', 'Ingresos'] : ['Servicio', 'Reservas'],
            rows: (services.data ?? []).map((s) =>
              seeRevenue ? [s.name, s.count, money(s.revenue ?? 0)] : [s.name, s.count],
            ),
          }}
        >
          <MeterList
            rows={(services.data ?? []).map((s) => ({
              key: s.id,
              label: s.name,
              value: s.count,
              display: String(s.count),
              hint: seeRevenue ? money(s.revenue ?? 0) : undefined,
            }))}
          />
        </ChartCard>
        <ChartCard
          title="Productos más vendidos"
          loading={products.isPending}
          empty={products.data?.length === 0 ? 'Sin productos en las reservas de este periodo.' : null}
          table={{
            head: seeRevenue ? ['Producto', 'Unidades', 'Ingresos'] : ['Producto', 'Unidades'],
            rows: (products.data ?? []).map((p) =>
              seeRevenue ? [p.name, p.quantity, money(p.revenue ?? 0)] : [p.name, p.quantity],
            ),
          }}
        >
          <MeterList
            rows={(products.data ?? []).map((p) => ({
              key: p.id ?? p.name,
              label: p.name,
              value: p.quantity,
              display: `${p.quantity} u.`,
              hint: seeRevenue ? money(p.revenue ?? 0) : undefined,
            }))}
          />
        </ChartCard>

        <ChartCard
          title="Días y horas con más reservas"
          description={`Hora de ${selected ? 'la sede' : 'la empresa'}`}
          loading={heat.isPending}
          empty={heat.data?.length === 0 ? 'Sin reservas en este periodo.' : null}
          table={{
            head: ['Día y hora', 'Reservas'],
            rows: (heat.data ?? []).map((c) => [
              `${['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][c.dow - 1]} ${c.hour}:00`,
              c.count,
            ]),
          }}
        >
          <Heatmap cells={heat.data ?? []} />
        </ChartCard>

        <ChartCard
          title="Estados"
          description="Todas las reservas del periodo"
          loading={kpis.isPending}
          empty={cur?.bookings_total === 0 ? 'Sin reservas en este periodo.' : null}
        >
          {cur && <StatusBar byStatus={cur.by_status} />}
        </ChartCard>

        <ChartCard
          title="Ocupación por servicio"
          description="Tiempo reservado sobre el tiempo ofrecido (con su capacidad)"
          loading={occ.isPending}
          empty={occ.data?.byService.length === 0 ? 'No hay horarios de atención en este periodo.' : null}
          table={{
            head: ['Servicio', 'Ocupación', 'Horas reservadas'],
            rows: (occ.data?.byService ?? []).map((s) => [s.name, percent(s.rate ?? 0), Math.round(s.booked / 60)]),
          }}
        >
          <MeterList
            rows={(occ.data?.byService ?? []).slice(0, 8).map((s) => ({
              key: s.id,
              label: s.name,
              value: Math.min(1, s.rate ?? 0),
              display: percent(s.rate ?? 0),
            }))}
          />
        </ChartCard>

        {showBranches && (
          <ChartCard
            title="Comparación entre sedes"
            description="Reservas sin canceladas"
            loading={byBranch.isPending}
            table={{
              head: ['Sede', 'Reservas', 'Canceladas', 'Ingresos'],
              rows: (byBranch.data ?? []).map((b) => [b.name, b.bookings, b.cancelled, money(b.revenue)]),
            }}
          >
            <MeterList
              rows={(byBranch.data ?? []).map((b) => ({
                key: b.id,
                label: b.name,
                value: b.bookings,
                display: String(b.bookings),
                hint: money(b.revenue),
              }))}
            />
          </ChartCard>
        )}
      </div>
    </>
  );
}

function RangeBar({
  preset,
  range,
  onPreset,
  onCustom,
}: {
  preset: string;
  range: DateRange;
  onPreset: (id: (typeof RANGE_PRESETS)[number]['id']) => void;
  onCustom: (r: DateRange) => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div role="group" aria-label="Rango" className="inline-flex rounded-lg border p-0.5">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={p.id === preset}
            onClick={() => (p.id === 'custom' ? onCustom(range) : onPreset(p.id))}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
              p.id === preset ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="dash-from" className="text-xs">
              Desde
            </Label>
            <Input
              id="dash-from"
              type="date"
              className="w-auto"
              value={range.from}
              onChange={(e) => e.target.value && onCustom({ from: e.target.value, to: range.to })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="dash-to" className="text-xs">
              Hasta
            </Label>
            <Input
              id="dash-to"
              type="date"
              className="w-auto"
              value={range.to}
              onChange={(e) => e.target.value && onCustom({ from: range.from, to: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Tarjeta KPI: valor, variación contra el periodo anterior (flecha + texto) y detalle. */
function Kpi({
  label,
  value,
  current,
  previous,
  hint,
  loading,
  upIsBad = false,
}: {
  label: string;
  value: string;
  current: number | null;
  previous: number | null;
  hint?: string | undefined;
  loading?: boolean;
  upIsBad?: boolean;
}) {
  const d = delta(current, previous);
  const good = d.direction === 'flat' ? null : (d.direction === 'up') !== upIsBad;
  const Icon = d.direction === 'up' ? ArrowUpRightIcon : d.direction === 'down' ? ArrowDownRightIcon : MinusIcon;
  const text =
    d.ratio === null
      ? d.direction === 'flat'
        ? 'Igual que el periodo anterior'
        : 'Sin datos del periodo anterior'
      : `${d.ratio > 0 ? '+' : ''}${new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 0 }).format(d.ratio)} vs. periodo anterior`;
  return (
    <Card className="viz-root gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 px-4">
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-2xl font-semibold tracking-tight tabular-nums" data-testid={`kpi-${label}`}>
            {value}
          </p>
        )}
        {!loading && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Icon
              aria-hidden
              className="size-3.5 shrink-0"
              style={{ color: good === null ? undefined : good ? 'var(--status-good)' : 'var(--status-critical)' }}
            />
            {text}
          </p>
        )}
        {!loading && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function ShortList({
  kind,
  title,
  branchId,
  tz,
  today,
}: {
  kind: 'today' | 'pending';
  title: string;
  branchId: string | null;
  tz: string;
  today: string;
}) {
  const todayEnd = useMemo(() => new Date(rangeInstants({ from: today, to: today }, tz).to).toISOString(), [today, tz]);
  const query = useShortList(kind, branchId, todayEnd);
  const change = useChangeStatus();
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button variant="link" size="sm" className="h-auto p-0" asChild>
          <Link to={kind === 'pending' ? '/admin/reservas?tab=pending' : '/admin/reservas?tab=today'}>Ver todas</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (query.data ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {kind === 'today' ? 'No quedan reservas para hoy.' : 'No hay reservas pendientes.'}
          </p>
        ) : (
          <ul className="divide-y">
            {(query.data ?? []).map((b) => (
              <ShortRow
                key={b.id}
                booking={b}
                tz={tz}
                kind={kind}
                busy={change.isPending}
                onConfirm={() =>
                  void change
                    .mutateAsync({ ids: [b.id], to: 'confirmed' })
                    .then(({ failed }) =>
                      failed.length ? toastError(failed[0]) : toast.success(`Reserva ${formatCode(b.code)} confirmada`),
                    )
                }
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ShortRow({
  booking: b,
  tz,
  kind,
  busy,
  onConfirm,
}: {
  booking: ShortBooking;
  tz: string;
  kind: 'today' | 'pending';
  busy: boolean;
  onConfirm: () => void;
}): ReactNode {
  const zone = b.branch?.timezone ?? tz;
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="w-20 shrink-0 text-sm font-medium tabular-nums">
        {formatInTimeZone(b.starts_at, zone, kind === 'today' ? 'H:mm' : 'd MMM H:mm')}
      </span>
      <Link to={`/admin/reservas?b=${b.id}`} className="min-w-0 flex-1 hover:underline">
        <span className="block truncate text-sm">{b.customer_name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {b.service_name}
          {b.branch ? ` · ${b.branch.name}` : ''}
        </span>
      </Link>
      {kind === 'today' && <StatusBadge status={b.status} />}
      <Button variant="ghost" size="icon" className="size-8" asChild>
        <a href={`tel:${b.customer_phone}`} aria-label={`Llamar a ${b.customer_name}`}>
          <PhoneIcon aria-hidden />
        </a>
      </Button>
      {b.status === 'pending' && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={onConfirm}
          aria-label={`Confirmar ${formatCode(b.code)}`}
        >
          Confirmar
        </Button>
      )}
    </li>
  );
}

/** Estado vacío: el enlace del sitio para compartir, con QR generado en el navegador. */
function ShareCard() {
  const url = window.location.origin;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import('qrcode')
      .then((m) => m.toDataURL(url, { margin: 1, width: 240 }))
      .then((data) => live && setQr(data))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [url]);
  const host = url.replace(/^https?:\/\//, '');
  return (
    <Card className="mb-6">
      <CardContent className="flex flex-col items-center gap-4 pt-6 sm:flex-row">
        {qr ? (
          <img src={qr} alt={`Código QR de ${host}`} className="size-32 rounded-md border bg-white p-1" />
        ) : (
          <div className="flex size-32 items-center justify-center rounded-md border">
            <QrCodeIcon className="size-8 text-muted-foreground" aria-hidden />
          </div>
        )}
        <div className="space-y-2 text-center sm:text-left">
          <p className="font-medium">Aún no tienes reservas: comparte tu enlace</p>
          <p className="font-mono text-sm break-all">{host}</p>
          <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(url).then(() => toast.success('Enlace copiado'))}
            >
              <CopyIcon aria-hidden /> Copiar enlace
            </Button>
            {qr && (
              <Button size="sm" variant="outline" asChild>
                <a href={qr} download={`qr-${host}.png`}>
                  Descargar QR
                </a>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
