import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';
import esLocale from '@fullcalendar/core/locales/es';
import type {
  DateSelectArg,
  DatesSetArg,
  DayHeaderContentArg,
  EventClickArg,
  EventDropArg,
  EventInput,
  EventContentArg,
} from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from 'lucide-react';
import {
  computeSlots,
  DAY,
  dayStartInstant,
  expandEvents,
  localDate,
  MAX_RANGE_DAYS,
  toAvailabilityEvent,
  toSlotSettings,
  type AvailabilityKind,
  type DaySlots,
  type SlotInputs,
} from '@shared/availability';
import {
  planChange,
  planCopyTo,
  planDelete,
  planDuplicate,
  type EventRow,
  type OccurrenceRef,
  type Plan,
} from '@shared/calendar';
import { Alert, AlertDescription, AlertTitle } from '@client/components/ui/alert';
import { Button } from '@client/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@client/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@client/components/ui/sheet';
import { Skeleton } from '@client/components/ui/skeleton';
import { useCompany } from '@client/app/tenant-context';
import { useIsMobile } from '@client/hooks/use-mobile';
import { toastError } from '@client/lib/errors';
import { supabase } from '@client/lib/supabase';
import { cn } from '@client/lib/utils';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@client/components/ui/alert-dialog';
import { useMembership } from '@client/features/auth/membership';
import { useSelectedBranch } from '@client/features/admin/branch-context';
import { useCompanyRecord } from '@client/features/content/api';
import {
  useApplyPlan,
  useAvailabilityEvents,
  useCalendarBookings,
  useCalendarBranches,
  useCalendarServices,
  useSetOwnAvailability,
  type CalendarBooking,
  type CalendarBranch,
} from './api';
import { CalendarSidebar, type Layers } from './CalendarSidebar';
import { EventDialog, type DialogResult, type DialogTarget } from './EventDialog';
import { toast } from 'sonner';
import {
  displayTitle,
  fcRange,
  formatWhen,
  holidayRows,
  KIND_COLORS,
  mondayOf,
  newRow,
  TEMPLATES,
  wallIso,
  type RowBase,
} from './model';
import { EventDetails, PointPopover, QuickCreate, type Point } from './popovers';
import { canReschedule } from '@shared/booking-admin';
import { readableForeground } from '@shared/color';
import { BookingDetail } from '@client/features/bookings/BookingDetail';
import { MoveBookingDialog, type MoveTarget } from '@client/features/bookings/MoveBookingDialog';
import { useScopePrompt } from './ScopeDialog';
import './calendar.css';

type ViewName = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth' | 'listWeek';
const VIEWS: { value: ViewName; label: string; key: string }[] = [
  { value: 'timeGridDay', label: 'Día', key: 'd' },
  { value: 'timeGridWeek', label: 'Semana', key: 'w' },
  { value: 'dayGridMonth', label: 'Mes', key: 'm' },
  { value: 'listWeek', label: 'Agenda', key: 'a' },
];
const GENERAL = 'general';
const BANNER_BUTTON = 'h-7 px-2.5 text-xs sm:h-8 sm:px-3 sm:text-sm';

const iso = (ms: number) => new Date(ms).toISOString();
const uuid = () => crypto.randomUUID();

/** `/admin/calendario`: horarios de atención y no disponibilidad, estilo Google Calendar. */
export function Component() {
  const company = useCompany();
  const branches = useCalendarBranches();
  const { selectedId, select } = useSelectedBranch();
  const { can } = useMembership();
  const [params, setParams] = useSearchParams();

  if (branches.isPending) return <Skeleton className="h-[70svh] w-full" />;
  if (branches.isError) return <p className="text-sm text-destructive">No se pudieron cargar las sedes.</p>;

  const list = branches.data;
  const requested = params.get('sede');
  const canGeneral = can('availability.edit_company') || list.length > 0;
  const branch =
    requested === GENERAL
      ? null
      : (list.find((b) => b.id === requested) ?? list.find((b) => b.id === selectedId) ?? list[0] ?? null);
  const scope: CalendarScope = branch
    ? { type: 'branch', branch, timezone: branch.timezone }
    : { type: 'company', timezone: company.timezone };

  const setScope = (id: string) => {
    if (id !== GENERAL) select(id);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('sede', id);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <CalendarView
      key={scope.type === 'branch' ? scope.branch.id : GENERAL}
      scope={scope}
      branches={list}
      canGeneral={canGeneral}
      initialDate={/^\d{4}-\d{2}-\d{2}$/.test(params.get('fecha') ?? '') ? params.get('fecha') : null}
      onScope={setScope}
    />
  );
}

export type CalendarScope =
  { type: 'branch'; branch: CalendarBranch; timezone: string } | { type: 'company'; timezone: string };

type PopoverState =
  { type: 'create'; start: number; end: number; allDay: boolean } | { type: 'event'; occ: OccurrenceRef };

function CalendarView({
  scope,
  branches,
  canGeneral,
  initialDate,
  onScope,
}: {
  scope: CalendarScope;
  branches: CalendarBranch[];
  canGeneral: boolean;
  /** `?fecha=YYYY-MM-DD`: día con el que abre el calendario. */
  initialDate: string | null;
  onScope: (id: string) => void;
}) {
  const company = useCompany();
  const { can } = useMembership();
  const isMobile = useIsMobile();
  const calendarRef = useRef<FullCalendar>(null);
  const api = () => calendarRef.current?.getApi();
  const tz = scope.timezone;

  // Eventos que valen para la vista: los de la sede si tiene horario propio, si no los de la empresa.
  const sourceBranchId = scope.type === 'branch' && scope.branch.ownAvailability ? scope.branch.id : null;
  const editable = sourceBranchId === null ? can('availability.edit_company') : can('availability.edit_branch');
  const base: RowBase = useMemo(
    () => ({ companyId: company.id, branchId: sourceBranchId, timezone: tz }),
    [company.id, sourceBranchId, tz],
  );
  const baseRef = useRef(base);
  useEffect(() => {
    baseRef.current = base;
  }, [base]);

  const eventsQuery = useAvailabilityEvents(sourceBranchId);
  const rows = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const { apply } = useApplyPlan(sourceBranchId);
  const services = useCalendarServices();
  const record = useCompanyRecord();
  const setOwn = useSetOwnAvailability();
  const [scopeElement, askScope] = useScopePrompt();

  const [view, setView] = useState<ViewName>(() => (isMobile ? 'timeGridDay' : 'timeGridWeek'));
  const [title, setTitle] = useState('');
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [currentDate, setCurrentDate] = useState(() => initialDate ?? localDate(Date.now(), tz));
  const [layers, setLayers] = useState<Layers>({ open: true, closed: true, bookings: true });
  const [serviceFilter, setServiceFilter] = useState('all');
  const [showSlots, setShowSlots] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [ownPrompt, setOwnPrompt] = useState(false);
  // Fase 11: detalle de la reserva en un panel lateral y reprogramar arrastrando.
  const [openBooking, setOpenBooking] = useState<string | null>(null);
  const [move, setMove] = useState<MoveTarget | null>(null);
  const canMoveBookings = can('bookings.manage');

  const bookingBranchIds = useMemo(
    () => (scope.type === 'branch' ? [scope.branch.id] : branches.filter((b) => !b.ownAvailability).map((b) => b.id)),
    [scope, branches],
  );
  const bookings = useCalendarBookings(bookingBranchIds, range);
  const service = services.data?.find((s) => s.id === serviceFilter) ?? null;

  const closePopover = useCallback(() => {
    setPoint(null);
    setPopover(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Eventos para FullCalendar
  // ---------------------------------------------------------------------------
  const occurrences = useMemo(
    () => (range ? expandEvents(rows.map(toAvailabilityEvent), range.from, range.to, tz) : []),
    [rows, range, tz],
  );

  const slotSettings = useMemo(
    () => toSlotSettings((record.data?.booking_settings ?? {}) as SlotInputs['settings']),
    [record.data],
  );

  // Vista previa de cupos: el mismo motor que usa el sitio público (`/api/public/slots`).
  const slotDays = useMemo((): DaySlots[] => {
    if (!showSlots || !service || scope.type !== 'branch' || !range) return [];
    const events = rows.map(toAvailabilityEvent);
    const blocks = (bookings.data ?? []).map((b) => ({
      blockStart: b.block_starts_at,
      blockEnd: b.block_ends_at,
      serviceId: b.service_id,
      status: b.status,
    }));
    const out: DaySlots[] = [];
    // El motor admite 31 días por consulta; la vista de mes muestra hasta 42.
    for (let from = range.from; from < range.to; from += MAX_RANGE_DAYS * DAY) {
      const to = Math.min(range.to, from + MAX_RANGE_DAYS * DAY);
      out.push(
        ...computeSlots({
          timezone: tz,
          range: { from: new Date(from), to: new Date(to) },
          now: new Date(),
          settings: slotSettings,
          service: {
            id: service.id,
            durationMinutes: service.durationMinutes,
            bufferBefore: service.bufferBefore,
            bufferAfter: service.bufferAfter,
            capacity: service.capacity,
          },
          events,
          bookings: blocks,
        }),
      );
    }
    return out;
  }, [showSlots, service, scope.type, range, rows, bookings.data, slotSettings, tz]);

  const fcEvents = useMemo((): EventInput[] => {
    const out: EventInput[] = [];
    for (const o of occurrences) {
      const row = rowsById.get(o.event.id);
      if (!row || !layers[row.kind]) continue;
      if (serviceFilter !== 'all' && row.service_ids && !row.service_ids.includes(serviceFilter)) continue;
      const color = row.color ?? KIND_COLORS[row.kind];
      out.push({
        id: `${row.id}|${o.originalStart}`,
        title: displayTitle(row),
        start: row.all_day ? localDate(o.start, tz) : wallIso(o.start, tz),
        end: row.all_day ? localDate(o.end, tz) : wallIso(o.end, tz),
        allDay: row.all_day,
        backgroundColor: color,
        borderColor: color,
        // Blanco o casi negro según el fondo (colores claros como «Plátano»): contraste ≥ 4,5:1.
        textColor: readableForeground(color),
        classNames: ['sv-ev', `sv-ev-${row.kind}`],
        editable,
        extendedProps: {
          type: 'availability',
          eventId: row.id,
          start: o.start,
          end: o.end,
          originalStart: o.originalStart,
        },
      });
    }
    if (layers.bookings) {
      for (const b of bookings.data ?? []) {
        if (serviceFilter !== 'all' && b.service_id !== serviceFilter) continue;
        out.push({
          id: `b:${b.id}`,
          title: `${b.customer_name} · ${b.service_name}`,
          start: wallIso(Date.parse(b.starts_at), tz),
          end: wallIso(Date.parse(b.ends_at), tz),
          editable: canMoveBookings && canReschedule(b.status),
          durationEditable: false,
          classNames: ['sv-ev', 'sv-ev-booking', `sv-booking-${b.status}`],
          extendedProps: { type: 'booking', booking: b },
        });
      }
    }
    const step = slotSettings.slotStepMinutes;
    for (const day of slotDays) {
      for (const s of day.slots) {
        const start = Date.parse(s.start);
        out.push({
          id: `s:${s.start}`,
          start: wallIso(start, tz),
          end: wallIso(Math.min(start + step * 60_000, Date.parse(s.end)), tz),
          display: 'background',
          classNames: ['sv-slot'],
          extendedProps: { type: 'slot' },
        });
      }
    }
    return out;
  }, [
    occurrences,
    rowsById,
    layers,
    serviceFilter,
    editable,
    bookings.data,
    slotDays,
    slotSettings,
    tz,
    canMoveBookings,
  ]);

  // ---------------------------------------------------------------------------
  // Acciones
  // ---------------------------------------------------------------------------
  const occOf = (props: Record<string, unknown>): OccurrenceRef => ({
    eventId: props.eventId as string,
    start: props.start as number,
    end: props.end as number,
    originalStart: props.originalStart as number,
  });

  async function chooseScope(row: EventRow, title: string, action: string, allowThis = true) {
    if (!row.rrule) return 'this' as const;
    return askScope({ title, action, allowThis });
  }

  async function removeOccurrence(occ: OccurrenceRef) {
    const row = rowsById.get(occ.eventId);
    if (!row) return;
    closePopover();
    const scope = await chooseScope(row, 'Eliminar evento recurrente', 'Eliminar');
    if (!scope) return;
    await apply(planDelete(rows, occ, scope), { success: 'Evento eliminado', undo: true });
  }

  async function duplicateOccurrence(occ: OccurrenceRef) {
    closePopover();
    await apply(planDuplicate(rows, occ, uuid), { success: 'Evento duplicado', undo: true });
  }

  function openEdit(occ: OccurrenceRef) {
    const row = rowsById.get(occ.eventId);
    if (!row) return;
    closePopover();
    setDialog({ mode: 'edit', row, occ });
  }

  async function submitDialog(result: DialogResult): Promise<boolean> {
    if (!dialog) return false;
    if (dialog.mode === 'create') {
      const row = newRow(base, { ...dialog.draft, ...result.fields, id: dialog.draft.id });
      return apply({ inserts: [row], updates: [], deletes: [] }, { success: 'Horario creado', undo: true });
    }
    if (Object.keys(result.changed).length === 0) return true;
    const { occ } = dialog;
    const scope = await chooseScope(dialog.row, 'Editar evento recurrente', 'Aceptar', !result.repeatChanged);
    if (!scope) return false;
    return apply(planChange(rows, occ, scope, result.changed, uuid), { success: 'Horario guardado', undo: true });
  }

  async function onMove(info: EventDropArg | EventResizeDoneArg) {
    const props = info.event.extendedProps;
    if (props.type === 'booking') {
      const b = props.booking as CalendarBooking;
      if (!info.event.start || info.event.allDay) {
        info.revert();
        return;
      }
      setMove({
        booking: b,
        startsAt: new Date(fcRange(info.event.start, info.event.start, false, tz).start).toISOString(),
        timezone: tz,
        revert: info.revert,
      });
      return;
    }
    const row = rowsById.get(props.eventId as string);
    if (props.type !== 'availability' || !row || !info.event.start) {
      info.revert();
      return;
    }
    const occ = occOf(props);
    const allDay = info.event.allDay;
    const end = info.event.end ?? new Date(info.event.start.getTime() + (allDay ? DAY : occ.end - occ.start));
    const next = fcRange(info.event.start, end, allDay, tz);
    const scope = await chooseScope(row, 'Cambiar evento recurrente', 'Aceptar');
    if (!scope) {
      info.revert();
      return;
    }
    const plan = planChange(
      rows,
      occ,
      scope,
      { starts_at: iso(next.start), ends_at: iso(next.end), ...(allDay !== row.all_day ? { all_day: allDay } : {}) },
      uuid,
    );
    if (!(await apply(plan, { success: 'Evento actualizado', undo: true }))) info.revert();
  }

  function onSelect(info: DateSelectArg) {
    const r = fcRange(info.start, info.end, info.allDay, tz);
    const js = info.jsEvent as MouseEvent | null;
    const box = (info.jsEvent?.target as HTMLElement | null)?.getBoundingClientRect();
    setPoint(
      js && js.clientX ? { x: js.clientX, y: js.clientY } : box ? { x: box.left, y: box.top } : { x: 200, y: 200 },
    );
    setPopover({ type: 'create', start: r.start, end: r.end, allDay: info.allDay });
  }

  function onEventClick(info: EventClickArg) {
    info.jsEvent.preventDefault();
    const props = info.event.extendedProps;
    if (props.type === 'slot') return;
    const box = info.el.getBoundingClientRect();
    setPoint({ x: box.right, y: box.top });
    if (props.type === 'booking') {
      setPoint(null);
      setOpenBooking((props.booking as CalendarBooking).id);
    } else setPopover({ type: 'event', occ: occOf(props) });
  }

  function quickSave(title: string, kind: AvailabilityKind, more: boolean) {
    if (popover?.type !== 'create') return;
    const draft = newRow(base, {
      kind,
      title,
      all_day: popover.allDay,
      starts_at: iso(popover.start),
      ends_at: iso(popover.end),
    });
    closePopover();
    api()?.unselect();
    if (more) setDialog({ mode: 'create', draft });
    else void apply({ inserts: [draft], updates: [], deletes: [] }, { success: 'Horario creado', undo: true });
  }

  const openCreate = useCallback(() => {
    // Hoy: la próxima hora en punto; otro día: a las 9:00.
    const today = localDate(Date.now(), tz);
    const dayStart = dayStartInstant(currentDate, tz);
    const start =
      currentDate === today
        ? Math.min(dayStart + 23 * 3_600_000, Math.ceil(Date.now() / 3_600_000) * 3_600_000)
        : dayStart + 9 * 3_600_000;
    setDialog({
      mode: 'create',
      draft: newRow(baseRef.current, { kind: 'open', starts_at: iso(start), ends_at: iso(start + 3_600_000) }),
    });
  }, [currentDate, tz]);

  async function applyTemplate(id: string) {
    const template = TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    const plan: Plan = { inserts: template.build(base, mondayOf(currentDate), currentDate), updates: [], deletes: [] };
    await apply(plan, { success: `Plantilla añadida: ${template.label}`, undo: true });
  }

  async function importHolidays() {
    const year = Number(currentDate.slice(0, 4));
    const inserts = holidayRows(base, year, rows);
    if (inserts.length === 0) {
      toast.info(`Los festivos de ${year} ya están en el calendario`);
      return;
    }
    await apply(
      { inserts, updates: [], deletes: [] },
      { success: `${inserts.length} festivos de ${year} añadidos`, undo: true },
    );
  }

  // ---------------------------------------------------------------------------
  // Navegación y atajos de teclado (como Google Calendar)
  // ---------------------------------------------------------------------------
  const changeView = useCallback((next: ViewName) => {
    setView(next);
    calendarRef.current?.getApi().changeView(next);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const cal = calendarRef.current?.getApi();
      if (!cal) return;
      const key = e.key.toLowerCase();
      const viewKey = VIEWS.find((v) => v.key === key);
      if (key === 't') cal.today();
      else if (key === 'j' || key === 'n') cal.next();
      else if (key === 'k' || key === 'p') cal.prev();
      else if (key === 'c' && editable) openCreate();
      else if (viewKey) changeView(viewKey.value);
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changeView, editable, openCreate]);

  function onDatesSet(info: DatesSetArg) {
    setTitle(info.view.title);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    setRange({ from: dayStartInstant(day(info.start), tz), to: dayStartInstant(day(info.end), tz) });
    setCurrentDate(day(info.view.calendar.getDate()));
    setView(info.view.type as ViewName);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const popRow = popover?.type === 'event' ? rowsById.get(popover.occ.eventId) : undefined;
  const serviceNames = (ids: string[] | null) =>
    ids?.length ? ids.map((id) => services.data?.find((s) => s.id === id)?.name ?? 'Servicio') : null;

  const sidebar = (
    <CalendarSidebar
      editable={editable}
      currentDate={currentDate}
      onDate={(date) => {
        api()?.gotoDate(date);
        setMobilePanel(false);
      }}
      onCreate={() => {
        setMobilePanel(false);
        openCreate();
      }}
      layers={layers}
      onLayers={setLayers}
      services={services.data ?? []}
      serviceFilter={serviceFilter}
      onServiceFilter={(id) => {
        setServiceFilter(id);
        if (id === 'all') setShowSlots(false);
      }}
      slotsAvailable={scope.type === 'branch'}
      showSlots={showSlots}
      onShowSlots={setShowSlots}
      onTemplate={(id) => {
        setMobilePanel(false);
        void applyTemplate(id);
      }}
      onHolidays={() => {
        setMobilePanel(false);
        void importHolidays();
      }}
      year={Number(currentDate.slice(0, 4))}
      onUseGeneral={
        scope.type === 'branch' && scope.branch.ownAvailability && can('company.edit')
          ? () => {
              setMobilePanel(false);
              setOwn.mutate(
                { branchId: scope.branch.id, own: false },
                {
                  onSuccess: () => toast.success('La sede vuelve a usar el horario general'),
                  onError: (error) => toastError(error),
                },
              );
            }
          : undefined
      }
    />
  );

  return (
    <div className="sv-calendar-page -m-4 flex h-[calc(100svh-3.5rem)] min-h-[560px] flex-col md:-m-6">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 md:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          onClick={() => setPanelOpen((o) => !o)}
          aria-label={panelOpen ? 'Ocultar panel' : 'Mostrar panel'}
          aria-expanded={panelOpen}
        >
          {panelOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobilePanel(true)}
          aria-label="Abrir panel"
        >
          <MenuIcon />
        </Button>
        <h1 className="sr-only">Calendario</h1>
        <Button variant="outline" className="rounded-full" onClick={() => api()?.today()} title="Hoy (t)">
          Hoy
        </Button>
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => api()?.prev()}
            aria-label="Anterior (k)"
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => api()?.next()}
            aria-label="Siguiente (j)"
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <p
          className="min-w-0 flex-1 truncate text-lg font-normal first-letter:uppercase md:text-[22px]"
          aria-live="polite"
          data-testid="calendar-title"
        >
          {title}
        </p>
        <Select value={scope.type === 'branch' ? scope.branch.id : GENERAL} onValueChange={onScope}>
          <SelectTrigger className="w-full max-w-56 sm:w-52" aria-label="Sede del calendario">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
            {canGeneral && (
              <>
                <SelectSeparator />
                <SelectItem value={GENERAL}>Horario general de la empresa</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
        <Select value={view} onValueChange={(v) => changeView(v as ViewName)}>
          <SelectTrigger className="w-28" aria-label="Vista">
            <SelectValue>{VIEWS.find((v) => v.value === view)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {VIEWS.map((v) => (
              <SelectItem key={v.value} value={v.value}>
                <span className="flex w-full items-center justify-between gap-4">
                  {v.label}
                  <kbd className="text-xs text-muted-foreground uppercase">{v.key}</kbd>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {scope.type === 'branch' && !scope.branch.ownAvailability && (
        <Alert className="m-3 mb-0 w-auto md:mx-4">
          <InfoIcon />
          <AlertTitle>Esta sede usa el horario general de la empresa</AlertTitle>
          <AlertDescription>
            <p className="hidden sm:block">Lo que cambies aquí aplica a todas las sedes sin horario propio.</p>
            <div className="mt-1 flex flex-wrap gap-2 sm:mt-2">
              {canGeneral && (
                <Button size="sm" variant="outline" className={BANNER_BUTTON} onClick={() => onScope(GENERAL)}>
                  Ver horario general
                </Button>
              )}
              {can('company.edit') && (
                <Button size="sm" className={BANNER_BUTTON} onClick={() => setOwnPrompt(true)}>
                  Activar horario propio
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex min-h-0 flex-1">
        {panelOpen && <aside className="hidden w-64 shrink-0 overflow-y-auto border-r md:block">{sidebar}</aside>}
        <div
          className={cn(
            'sv-calendar min-w-0 flex-1 p-2 md:p-3',
            eventsQuery.isPending && 'opacity-60',
            slotDays.length > 0 && 'sv-preview',
          )}
        >
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            locale={esLocale}
            timeZone="UTC"
            now={() => wallIso(Date.now(), tz)}
            initialView={view}
            initialDate={currentDate}
            headerToolbar={false}
            height="100%"
            firstDay={1}
            nowIndicator
            allDayText="Todo el día"
            slotDuration="00:30:00"
            slotLabelFormat={{ hour: 'numeric', minute: '2-digit', hour12: false }}
            eventTimeFormat={{ hour: 'numeric', minute: '2-digit', hour12: false }}
            scrollTime="07:00:00"
            dayMaxEvents
            selectable={editable}
            selectMirror
            editable={editable}
            eventResizableFromStart={false}
            eventOverlap
            // Eventos enfocables con Tab; Enter o Espacio los abren (fase 13, teclado).
            eventInteractive
            views={{
              timeGridDay: { titleFormat: { day: 'numeric', month: 'long', year: 'numeric' } },
              timeGridWeek: { titleFormat: { month: 'long', year: 'numeric' } },
              dayGridMonth: { titleFormat: { month: 'long', year: 'numeric' }, eventDisplay: 'block' },
              listWeek: { titleFormat: { month: 'long', year: 'numeric' } },
            }}
            longPressDelay={350}
            events={fcEvents}
            select={onSelect}
            eventClick={onEventClick}
            eventDrop={(info) => void onMove(info)}
            eventResize={(info) => void onMove(info)}
            datesSet={onDatesSet}
            dayHeaderContent={(arg) => <DayHeader arg={arg} view={view} />}
            eventContent={(arg) => <EventContent arg={arg} />}
            noEventsText="No hay eventos en este periodo"
          />
        </div>
      </div>

      <Sheet open={mobilePanel} onOpenChange={setMobilePanel}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>Calendario</SheetTitle>
            <SheetDescription className="sr-only">Mini calendario, capas y plantillas</SheetDescription>
          </SheetHeader>
          {sidebar}
        </SheetContent>
      </Sheet>

      <PointPopover
        point={point}
        onClose={() => {
          closePopover();
          api()?.unselect();
        }}
        label={popover?.type === 'create' ? 'Nuevo horario' : 'Detalle'}
      >
        {popover?.type === 'create' && (
          <QuickCreate
            when={formatWhen(popover.start, popover.end, popover.allDay, tz)}
            defaultKind="open"
            onSave={(t, k) => quickSave(t, k, false)}
            onMore={(t, k) => quickSave(t, k, true)}
            onClose={() => {
              closePopover();
              api()?.unselect();
            }}
          />
        )}
        {popover?.type === 'event' && popRow && (
          <EventDetails
            row={popRow}
            start={popover.occ.start}
            end={popover.occ.end}
            serviceNames={serviceNames(popRow.service_ids)}
            editable={editable}
            onEdit={() => openEdit(popover.occ)}
            onDuplicate={() => void duplicateOccurrence(popover.occ)}
            onDelete={() => void removeOccurrence(popover.occ)}
            onClose={closePopover}
          />
        )}
      </PointPopover>

      <Sheet open={!!openBooking} onOpenChange={(o) => !o && setOpenBooking(null)}>
        <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-xl">
          <SheetHeader className="p-0">
            <SheetTitle>Reserva</SheetTitle>
            <SheetDescription className="sr-only">Detalle, acciones e historial de la reserva</SheetDescription>
          </SheetHeader>
          {openBooking && <BookingDetail key={openBooking} id={openBooking} onOpenBooking={setOpenBooking} />}
        </SheetContent>
      </Sheet>
      <MoveBookingDialog target={move} onClose={() => setMove(null)} />

      <EventDialog
        target={dialog}
        services={services.data ?? []}
        onClose={() => setDialog(null)}
        onSubmit={submitDialog}
      />
      {scopeElement}

      {scope.type === 'branch' && (
        <OwnAvailabilityDialog
          open={ownPrompt}
          onOpenChange={setOwnPrompt}
          onConfirm={async (copy) => {
            const general = copy ? await fetchGeneral(company.id) : [];
            await setOwn.mutateAsync({
              branchId: scope.branch.id,
              own: true,
              copy: copy ? planCopyTo(general, scope.branch.id, uuid) : undefined,
            });
          }}
        />
      )}
    </div>
  );
}

async function fetchGeneral(companyId: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('availability_events')
    .select('*')
    .eq('company_id', companyId)
    .is('branch_id', null);
  if (error) throw error;
  return data;
}

function OwnAvailabilityDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (copy: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  async function run(copy: boolean) {
    setPending(true);
    try {
      await onConfirm(copy);
      toast.success('La sede ya tiene horario propio');
      onOpenChange(false);
    } catch (error) {
      toastError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Activar horario propio</AlertDialogTitle>
          <AlertDialogDescription>
            La sede dejará de usar el horario general de la empresa. ¿Quieres empezar con una copia del horario general?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button variant="outline" disabled={pending} onClick={() => void run(false)}>
            Empezar vacío
          </Button>
          <Button disabled={pending} onClick={() => void run(true)}>
            {pending ? 'Procesando…' : 'Copiar el horario general'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Encabezado de día como Google: día de la semana pequeño y número grande (en círculo si es hoy). */
function DayHeader({ arg, view }: { arg: DayHeaderContentArg; view: ViewName }) {
  if (view === 'dayGridMonth' || view === 'listWeek') return <span className="sv-dow">{arg.text}</span>;
  const weekday = new Intl.DateTimeFormat('es', { weekday: 'short', timeZone: 'UTC' })
    .format(arg.date)
    .replace('.', '');
  return (
    <span className="sv-day-header">
      <span className={cn('sv-dow', arg.isToday && 'text-primary')}>{weekday}</span>
      <span className={cn('sv-dom', arg.isToday && 'sv-dom-today')}>{arg.date.getUTCDate()}</span>
    </span>
  );
}

function EventContent({ arg }: { arg: EventContentArg }) {
  if (arg.event.display === 'background') return null;
  if (arg.view.type === 'listWeek') return <span>{arg.event.title}</span>;
  return (
    <span className="sv-ev-body">
      <span className="sv-ev-title">{arg.event.title}</span>
      {!arg.event.allDay && arg.timeText && <span className="sv-ev-time">{arg.timeText}</span>}
    </span>
  );
}
