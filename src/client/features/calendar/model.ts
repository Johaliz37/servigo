/**
 * Utilidades del calendario: hora de pared para FullCalendar, colores estilo Google,
 * plantillas rápidas y festivos. FullCalendar trabaja en `timeZone: 'UTC'` con horas de pared
 * de la sede (sin plugin de zonas): `wallIso` y `fromFcDate` convierten en cada sentido.
 */
import {
  dayStartInstant,
  DAY,
  instantToWall,
  localDate,
  wallToInstant,
  type AvailabilityKind,
} from '@shared/availability';
import type { EventRow } from '@shared/calendar';
import { formatInTimeZone } from '@shared/format';
import { colombianHolidays } from '@shared/holidays/co';
import { describeRule } from '@shared/recurrence';

export const KIND_LABELS: Record<AvailabilityKind, string> = { open: 'Atención', closed: 'No disponible' };
export const KIND_COLORS: Record<AvailabilityKind, string> = { open: '#0b8043', closed: '#70757a' };

/** Paleta de Google Calendar. */
export const EVENT_COLORS = [
  { value: '#0b8043', label: 'Albahaca' },
  { value: '#33b679', label: 'Salvia' },
  { value: '#039be5', label: 'Pavo real' },
  { value: '#3f51b5', label: 'Arándano' },
  { value: '#7986cb', label: 'Lavanda' },
  { value: '#8e24aa', label: 'Uva' },
  { value: '#e67c73', label: 'Flamenco' },
  { value: '#f4511e', label: 'Mandarina' },
  { value: '#f6bf26', label: 'Plátano' },
  { value: '#d50000', label: 'Tomate' },
  { value: '#616161', label: 'Grafito' },
] as const;

export const displayTitle = (row: Pick<EventRow, 'title' | 'kind'>) => row.title || KIND_LABELS[row.kind];

/** Instante → 'YYYY-MM-DDTHH:mm:ss' de pared (FullCalendar en UTC lo lee como hora local de la sede). */
export const wallIso = (ms: number, tz: string) => new Date(instantToWall(ms, tz)).toISOString().slice(0, 19);

/** Fecha de FullCalendar (UTC = hora de pared) → instante real. */
export const fromFcDate = (date: Date, tz: string) => wallToInstant(date.getTime(), tz);

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Lunes de la semana de `date`. */
export function mondayOf(date: string): string {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

/** Inicio/fin de un rango de FullCalendar como instantes (todo el día = medianoches de la sede). */
export function fcRange(start: Date, end: Date, allDay: boolean, tz: string): { start: number; end: number } {
  if (!allDay) return { start: fromFcDate(start, tz), end: fromFcDate(end, tz) };
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { start: dayStartInstant(day(start), tz), end: dayStartInstant(day(end), tz) };
}

export interface RowBase {
  companyId: string;
  branchId: string | null;
  timezone: string;
}

/** Fila nueva con valores por defecto (id generado en el navegador: los planes lo referencian). */
export function newRow(
  base: RowBase,
  fields: Partial<EventRow> & Pick<EventRow, 'kind' | 'starts_at' | 'ends_at'>,
): EventRow {
  return {
    id: crypto.randomUUID(),
    company_id: base.companyId,
    branch_id: base.branchId,
    title: '',
    notes: null,
    color: null,
    all_day: false,
    timezone: base.timezone,
    rrule: null,
    exdates: [],
    recurrence_parent_id: null,
    recurrence_original_start: null,
    service_ids: null,
    capacity_override: null,
    created_at: '',
    updated_at: '',
    ...fields,
  };
}

const at = (date: string, time: string, tz: string) =>
  new Date(wallToInstant(Date.parse(`${date}T${time}:00Z`), tz)).toISOString();

export interface Template {
  id: string;
  label: string;
  build: (base: RowBase, weekStart: string, today: string) => EventRow[];
}

export const TEMPLATES: Template[] = [
  {
    id: 'office',
    label: 'Horario de oficina L–V 8:00–18:00',
    build: (base, week) => [
      newRow(base, {
        kind: 'open',
        title: 'Horario de oficina',
        starts_at: at(week, '08:00', base.timezone),
        ends_at: at(week, '18:00', base.timezone),
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      }),
    ],
  },
  {
    id: 'saturdays',
    label: 'Sábados 9:00–13:00',
    build: (base, week) => [
      newRow(base, {
        kind: 'open',
        title: 'Sábados',
        starts_at: at(addDays(week, 5), '09:00', base.timezone),
        ends_at: at(addDays(week, 5), '13:00', base.timezone),
        rrule: 'FREQ=WEEKLY;BYDAY=SA',
      }),
    ],
  },
  {
    id: 'lunch',
    label: 'Almuerzo diario 12:00–13:00 (no disponible)',
    build: (base, week) => [
      newRow(base, {
        kind: 'closed',
        title: 'Almuerzo',
        starts_at: at(week, '12:00', base.timezone),
        ends_at: at(week, '13:00', base.timezone),
        rrule: 'FREQ=DAILY',
      }),
    ],
  },
  {
    id: 'holiday',
    label: 'Festivo (todo el día, no disponible)',
    build: (base, _week, today) => [allDayClosed(base, today, 'Festivo')],
  },
];

function allDayClosed(base: RowBase, date: string, title: string): EventRow {
  return newRow(base, {
    kind: 'closed',
    title,
    all_day: true,
    starts_at: new Date(dayStartInstant(date, base.timezone)).toISOString(),
    ends_at: new Date(dayStartInstant(addDays(date, 1), base.timezone)).toISOString(),
  });
}

/** Festivos de Colombia del año que aún no están (mismo día y nombre). */
export function holidayRows(base: RowBase, year: number, existing: readonly EventRow[]): EventRow[] {
  const taken = new Set(
    existing
      .filter((r) => r.all_day && r.kind === 'closed')
      .map((r) => `${localDate(Date.parse(r.starts_at), r.timezone)}|${r.title}`),
  );
  return colombianHolidays(year)
    .filter((h) => !taken.has(`${h.date}|${h.name}`))
    .map((h) => allDayClosed(base, h.date, h.name));
}

/** «martes, 24 de noviembre · 9:00 – 10:00» en la zona de la sede. */
export function formatWhen(start: number, end: number, allDay: boolean, tz: string): string {
  const day = (ms: number) => formatInTimeZone(ms, tz, "EEEE, d 'de' MMMM");
  if (allDay) {
    const last = end - DAY;
    return localDate(last, tz) === localDate(start, tz) ? day(start) : `${day(start)} – ${day(last)}`;
  }
  const time = (ms: number) => formatInTimeZone(ms, tz, 'H:mm');
  if (localDate(start, tz) === localDate(end - 1, tz)) return `${day(start)} · ${time(start)} – ${time(end)}`;
  return `${day(start)} ${time(start)} – ${day(end)} ${time(end)}`;
}

export function describeRow(row: EventRow): string {
  return describeRule(row.rrule, localDate(Date.parse(row.starts_at), row.timezone), row.timezone);
}
