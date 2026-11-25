import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  CalendarPlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  MessageCircleIcon,
  PrinterIcon,
  SearchIcon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { BookingStatus } from '@shared/availability';
import { formatCode, STATUS_LABELS } from '@shared/booking';
import {
  allowedTransitions,
  isInboxTab,
  whatsappLink,
  INBOX_TABS,
  TRANSITION_LABELS,
  type InboxTab,
  type TargetStatus,
} from '@shared/booking-admin';
import { formatMoney } from '@shared/format';
import { PageHeader } from '@client/components/common/PageHeader';
import { Button } from '@client/components/ui/button';
import { Checkbox } from '@client/components/ui/checkbox';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@client/components/ui/sheet';
import { Skeleton } from '@client/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@client/components/ui/table';
import { useCompany } from '@client/app/tenant-context';
import { toastError } from '@client/lib/errors';
import { cn } from '@client/lib/utils';
import { useSelectedBranch } from '@client/features/admin/branch-context';
import { useCalendarServices } from '@client/features/calendar/api';
import { exportInboxCsv, useChangeStatus, useInbox, PAGE_SIZE, type InboxFilters, type InboxRow } from './api';
import { BookingDetail, CancelDialog } from './BookingDetail';
import { usePendingCount, useSoundSetting } from './realtime';
import { formatWhenShort } from './helpers';
import { StatusBadge } from './status';

const ALL = '__all__';
const STATUSES: BookingStatus[] = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled'];

/** Bandeja `/admin/reservas` (fase 11 §1). Filtros, página y reserva abierta viven en la URL. */
export function Component() {
  const company = useCompany();
  const { selected, selectedId, branches } = useSelectedBranch();
  const [params, setParams] = useSearchParams();
  const services = useCalendarServices();
  const [sound, setSound] = useSoundSetting();

  const tabParam = params.get('tab');
  const tab: InboxTab = isInboxTab(tabParam) ? tabParam : 'upcoming';
  const branchParam = params.get('sede');
  const branchId = branchParam && branches.some((b) => b.id === branchParam) ? branchParam : selectedId;
  const filters: InboxFilters = {
    tab,
    branchId,
    serviceId: params.get('servicio'),
    status: (STATUSES as string[]).includes(params.get('estado') ?? '')
      ? (params.get('estado') as BookingStatus)
      : null,
    from: params.get('desde'),
    to: params.get('hasta'),
    q: params.get('q') ?? '',
  };
  const page = Math.max(0, Number(params.get('p') ?? 0) || 0);
  const openId = params.get('b');
  const timezone =
    (branchId ? branches.find((b) => b.id === branchId)?.timezone : selected?.timezone) ?? company.timezone;

  const inbox = useInbox(filters, page, timezone);
  const pending = usePendingCount(branchId);
  const [search, setSearch] = useState(filters.q);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [cancelIds, setCancelIds] = useState<string[] | null>(null);
  const change = useChangeStatus();
  const [exporting, setExporting] = useState(false);

  const rows = useMemo(() => inbox.data?.rows ?? [], [inbox.data]);
  const total = inbox.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function update(patch: Record<string, string | null>, keepPage = false) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        if (!keepPage) next.delete('p');
        return next;
      },
      { replace: true },
    );
    if (!keepPage) setSelectedRows(new Set());
  }

  const chosen = rows.filter((r) => selectedRows.has(r.id));
  // Acciones masivas: las que valen para todas las seleccionadas.
  const bulk = (['confirmed', 'completed', 'no_show', 'cancelled'] as TargetStatus[]).filter(
    (to) => chosen.length > 0 && chosen.every((r) => allowedTransitions(r.status, r.starts_at).includes(to)),
  );

  async function apply(ids: string[], to: TargetStatus, reason?: string) {
    const { ok, failed } = await change.mutateAsync({ ids, to, ...(reason ? { reason } : {}) });
    if (failed.length === 0)
      toast.success(
        ids.length === 1 ? `Reserva: ${TRANSITION_LABELS[to].toLowerCase()}` : `${ok.length} reservas actualizadas`,
      );
    else if (ok.length === 0) toastError(failed[0]);
    else toast.warning(`${ok.length} de ${ids.length} reservas actualizadas; ${failed.length} no se pudieron cambiar`);
    setSelectedRows(new Set());
  }

  async function download() {
    setExporting(true);
    try {
      const { csv, rows: count, truncated } = await exportInboxCsv(company.id, filters, timezone, company.locale);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `reservas-${company.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(truncated ? `Se exportaron las primeras ${count} reservas` : `${count} reservas exportadas`);
    } catch (error) {
      toastError(error);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Reservas"
        description={selected ? selected.name : 'Todas las sedes'}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={sound ? 'Silenciar aviso de nuevas reservas' : 'Activar sonido de nuevas reservas'}
              aria-pressed={sound}
              onClick={() => setSound(!sound)}
            >
              {sound ? <Volume2Icon aria-hidden /> : <VolumeXIcon aria-hidden />}
            </Button>
            <Button variant="outline" asChild>
              <Link to="agenda">
                <PrinterIcon aria-hidden /> Agenda del día
              </Link>
            </Button>
            <Button variant="outline" disabled={exporting || total === 0} onClick={() => void download()}>
              <DownloadIcon aria-hidden /> Exportar CSV
            </Button>
            <Button asChild>
              <Link to="nueva">
                <CalendarPlusIcon aria-hidden /> Nueva reserva
              </Link>
            </Button>
          </div>
        }
      />

      <div role="tablist" aria-label="Vista" className="mb-4 flex gap-1 overflow-x-auto border-b">
        {INBOX_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => update({ tab: t.id === 'upcoming' ? null : t.id })}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              t.id === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.id === 'pending' && (pending.data ?? 0) > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 text-xs text-white tabular-nums">{pending.data}</span>
            )}
          </button>
        ))}
      </div>

      <form
        role="search"
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(9rem,1fr))_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: search.trim() || null });
        }}
      >
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Buscar por código, nombre, teléfono o correo"
            placeholder="Código, nombre, teléfono o correo"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => search.trim() !== filters.q && update({ q: search.trim() || null })}
          />
        </div>
        {branches.length > 1 && (
          <Select value={branchParam ?? ALL} onValueChange={(v) => update({ sede: v === ALL ? null : v })}>
            <SelectTrigger aria-label="Sede" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{selected ? `Sede del panel (${selected.name})` : 'Todas las sedes'}</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={filters.serviceId ?? ALL} onValueChange={(v) => update({ servicio: v === ALL ? null : v })}>
          <SelectTrigger aria-label="Servicio" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los servicios</SelectItem>
            {(services.data ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status ?? ALL} onValueChange={(v) => update({ estado: v === ALL ? null : v })}>
          <SelectTrigger aria-label="Estado" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Label htmlFor="f-from" className="sr-only">
            Desde
          </Label>
          <Input
            id="f-from"
            type="date"
            className="w-auto"
            value={filters.from ?? ''}
            onChange={(e) => update({ desde: e.target.value })}
          />
          <span aria-hidden>–</span>
          <Label htmlFor="f-to" className="sr-only">
            Hasta
          </Label>
          <Input
            id="f-to"
            type="date"
            className="w-auto"
            value={filters.to ?? ''}
            onChange={(e) => update({ hasta: e.target.value })}
          />
        </div>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>

      {chosen.length > 0 && (
        <div
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2 text-sm"
          role="region"
          aria-label="Acciones masivas"
        >
          <span className="px-1 font-medium">{chosen.length} seleccionadas</span>
          {bulk.length === 0 && <span className="text-muted-foreground">No hay una acción común para todas.</span>}
          {bulk.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === 'cancelled' ? 'outline' : 'default'}
              disabled={change.isPending}
              onClick={() =>
                to === 'cancelled'
                  ? setCancelIds(chosen.map((r) => r.id))
                  : void apply(
                      chosen.map((r) => r.id),
                      to,
                    )
              }
            >
              {TRANSITION_LABELS[to]}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelectedRows(new Set())}>
            Quitar selección
          </Button>
        </div>
      )}

      <InboxTable
        rows={rows}
        loading={inbox.isPending}
        timezone={timezone}
        selected={selectedRows}
        onSelect={setSelectedRows}
        onOpen={(id) => update({ b: id }, true)}
        onAction={(row, to) => (to === 'cancelled' ? setCancelIds([row.id]) : void apply([row.id], to))}
        busy={change.isPending}
      />

      <div className="mt-3 flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span aria-live="polite">
          {total === 0
            ? 'Sin resultados'
            : `${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} de ${total}`}
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Página anterior"
            disabled={page === 0}
            onClick={() => update({ p: page - 1 ? String(page - 1) : null }, true)}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Página siguiente"
            disabled={page + 1 >= pages}
            onClick={() => update({ p: String(page + 1) }, true)}
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      </div>

      <CancelDialog
        open={cancelIds !== null}
        onOpenChange={(o) => !o && setCancelIds(null)}
        code={cancelIds && cancelIds.length > 1 ? `${cancelIds.length} reservas` : 'la reserva'}
        pending={change.isPending}
        onConfirm={async (reason) => {
          if (cancelIds) await apply(cancelIds, 'cancelled', reason);
          setCancelIds(null);
        }}
      />

      <Sheet open={!!openId} onOpenChange={(o) => !o && update({ b: null }, true)}>
        <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-xl">
          <SheetHeader className="p-0">
            <SheetTitle>Reserva</SheetTitle>
            <SheetDescription className="sr-only">Detalle, acciones e historial de la reserva</SheetDescription>
          </SheetHeader>
          {openId && <BookingDetail key={openId} id={openId} onOpenBooking={(id) => update({ b: id }, true)} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function InboxTable({
  rows,
  loading,
  timezone,
  selected,
  onSelect,
  onOpen,
  onAction,
  busy,
}: {
  rows: InboxRow[];
  loading: boolean;
  timezone: string;
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
  onOpen: (id: string) => void;
  onAction: (row: InboxRow, to: TargetStatus) => void;
  busy: boolean;
}) {
  const company = useCompany();
  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelect(next);
  };

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <Checkbox
                aria-label="Seleccionar todas"
                checked={all}
                onCheckedChange={(v) => onSelect(v === true ? new Set(rows.map((r) => r.id)) : new Set())}
              />
            </TableHead>
            <TableHead>Código</TableHead>
            <TableHead>Fecha y hora</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Teléfono</TableHead>
            <TableHead>Servicio</TableHead>
            <TableHead>Sede</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Origen</TableHead>
            <TableHead>
              <span className="sr-only">Acciones</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 4 }, (_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={11}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                No hay reservas con estos filtros.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => {
              const tz = r.branch?.timezone ?? timezone;
              const actions = allowedTransitions(r.status, r.starts_at).filter((to) => to !== 'no_show');
              return (
                <TableRow key={r.id} data-state={selected.has(r.id) ? 'selected' : undefined}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Seleccionar ${formatCode(r.code)}`}
                      checked={selected.has(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="font-mono font-medium hover:underline"
                      onClick={() => onOpen(r.id)}
                      aria-label={`Abrir reserva ${formatCode(r.code)}`}
                    >
                      {formatCode(r.code)}
                    </button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatWhenShort(r.starts_at, tz)}</TableCell>
                  <TableCell className="max-w-48 truncate">{r.customer_name}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <a href={`tel:${r.customer_phone}`} className="hover:underline">
                      {r.customer_phone}
                    </a>
                    <a
                      href={whatsappLink(r.customer_phone)}
                      target="_blank"
                      rel="noopener"
                      className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground"
                      aria-label={`WhatsApp a ${r.customer_name}`}
                    >
                      <MessageCircleIcon className="size-4" aria-hidden />
                    </a>
                  </TableCell>
                  <TableCell className="max-w-40 truncate">{r.service_name}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.branch?.name}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {formatMoney(r.total, r.currency, company.locale)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.source === 'admin' ? 'Panel' : 'Web'}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {actions.map((to) => (
                      <Button
                        key={to}
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        disabled={busy}
                        onClick={() => onAction(r, to)}
                        aria-label={`${TRANSITION_LABELS[to]} ${formatCode(r.code)}`}
                      >
                        {TRANSITION_LABELS[to]}
                      </Button>
                    ))}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
