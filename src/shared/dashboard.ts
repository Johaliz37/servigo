/**
 * Dashboard (fase 12, D30): rangos, variación contra el periodo anterior, ocupación con el
 * motor de disponibilidad (D26) y forma de las respuestas de las RPC `dashboard_*`. TS puro.
 */
import {
  dayStartInstant,
  freeIntervals,
  unionIntervals,
  DAY,
  MAX_RANGE_DAYS,
  type AvailabilityEvent,
  type BookingStatus,
  type Interval,
} from './availability';

// ---------------------------------------------------------------------------
// Rangos
// ---------------------------------------------------------------------------

export type RangePreset = 'today' | '7d' | '30d' | 'month' | 'custom';

export const RANGE_PRESETS: readonly { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'month', label: 'Este mes' },
  { id: 'custom', label: 'Personalizado' },
];

export const isRangePreset = (v: string | null): v is RangePreset => RANGE_PRESETS.some((p) => p.id === v);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' + n días (sin zona: aritmética de calendario). */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;

export interface DateRange {
  /** Primer día, inclusivo. */
  from: string;
  /** Último día, inclusivo. */
  to: string;
}

/**
 * Días del rango (zona de la sede o la empresa). «7 días» y «30 días» terminan hoy; «Este mes»
 * va del 1 a hoy. Personalizado: se ordena y se limita a 366 días.
 */
export function resolveRange(preset: RangePreset, today: string, custom?: Partial<DateRange>): DateRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'custom': {
      const a = custom?.from && DATE.test(custom.from) ? custom.from : addDays(today, -29);
      const b = custom?.to && DATE.test(custom.to) ? custom.to : today;
      const [from, to] = a <= b ? [a, b] : [b, a];
      return daysBetween(from, to) > 366 ? { from: addDays(to, -365), to } : { from, to };
    }
  }
}

/** Instantes [from, to) del rango en la zona. */
export function rangeInstants(range: DateRange, tz: string): { from: number; to: number } {
  return { from: dayStartInstant(range.from, tz), to: dayStartInstant(addDays(range.to, 1), tz) };
}

/** Periodo anterior de la misma duración (= dashboard_kpis). */
export function previousRange(range: DateRange): DateRange {
  const n = daysBetween(range.from, range.to);
  return { from: addDays(range.from, -n), to: addDays(range.from, -1) };
}

export type Bucket = 'day' | 'week' | 'month';

/** Agrupación de la serie: días hasta ~1 mes, semanas hasta ~4 meses, luego meses. */
export function bucketFor(range: DateRange): Bucket {
  const n = daysBetween(range.from, range.to);
  return n <= 31 ? 'day' : n <= 120 ? 'week' : 'month';
}

// ---------------------------------------------------------------------------
// Variación
// ---------------------------------------------------------------------------

export interface Delta {
  /** Variación relativa (0.25 = +25 %); null si el periodo anterior es 0. */
  ratio: number | null;
  direction: 'up' | 'down' | 'flat';
}

export function delta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return { ratio: null, direction: 'flat' };
  const direction = current > previous ? 'up' : current < previous ? 'down' : 'flat';
  if (previous === 0) return { ratio: null, direction };
  return { ratio: (current - previous) / Math.abs(previous), direction };
}

// ---------------------------------------------------------------------------
// Respuestas de las RPC
// ---------------------------------------------------------------------------

export interface PeriodKpis {
  bookings_total: number;
  by_status: Record<BookingStatus, number>;
  revenue_expected: number | null;
  revenue_completed: number | null;
  avg_ticket: number | null;
  new_customers: number;
  returning_customers: number;
  cancellation_rate: number;
  no_show_rate: number;
}

export interface KpisResponse {
  current: PeriodKpis;
  previous: PeriodKpis;
  can_see_revenue: boolean;
}

export interface SeriesPoint {
  bucket: string;
  bookings: number;
  revenue: number | null;
}

export interface TopService {
  id: string;
  name: string;
  count: number;
  revenue: number | null;
}

export interface TopProduct {
  id: string | null;
  name: string;
  quantity: number;
  revenue: number | null;
}

export interface HeatCell {
  dow: number;
  hour: number;
  count: number;
}

export interface BranchStat {
  id: string;
  name: string;
  bookings: number;
  cancelled: number;
  revenue: number;
}

/**
 * Matriz 7 × horas del mapa de calor (lunes primero). Muestra de la primera a la última hora
 * con reservas (mínimo 8:00–18:00 para que una semana vacía no se vea rara).
 */
export function heatmapGrid(cells: readonly HeatCell[]): { hours: number[]; rows: number[][]; max: number } {
  const used = cells.map((c) => c.hour);
  const first = Math.min(8, ...used);
  const last = Math.max(18, ...used);
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const rows = Array.from({ length: 7 }, (_, d) =>
    hours.map((h) => cells.find((c) => c.dow === d + 1 && c.hour === h)?.count ?? 0),
  );
  return { hours, rows, max: Math.max(0, ...cells.map((c) => c.count)) };
}

// ---------------------------------------------------------------------------
// Ocupación: minutos reservados / minutos ofrecidos (motor de la fase 08)
// ---------------------------------------------------------------------------

export interface OccupancyService {
  id: string;
  name: string;
  capacity: number;
}

export interface OccupancyBooking {
  service_id: string;
  block_starts_at: string;
  block_ends_at: string;
  status: BookingStatus;
}

export interface OccupancyRow {
  offered: number;
  booked: number;
  /** booked / offered (0–1, puede pasar de 1 con reservas forzadas); null si no se ofreció nada. */
  rate: number | null;
}

const MIN = 60_000;
const sum = (list: readonly Interval[]) => list.reduce((s, [a, b]) => s + (b - a), 0);
const rate = (booked: number, offered: number) => (offered > 0 ? booked / offered : null);

/**
 * Ocupación de una sede en [from, to), en minutos:
 *   - por servicio: reservado del servicio / (tiempo libre del servicio × su capacidad);
 *   - sede: todo lo reservado / (unión del tiempo libre de los servicios × la mayor capacidad).
 * Reservado = bloques con buffers de reservas pendientes, confirmadas, completadas o de
 * clientes que no asistieron (el cupo se ocupó), recortados al rango. Se calcula en tramos de
 * hasta 31 días (límite del motor).
 */
export function occupancy(input: {
  events: readonly AvailabilityEvent[];
  services: readonly OccupancyService[];
  bookings: readonly OccupancyBooking[];
  from: number;
  to: number;
  timezone: string;
}): { total: OccupancyRow; byService: (OccupancyRow & { id: string; name: string })[] } {
  const free = new Map<string, Interval[]>();
  for (const s of input.services) free.set(s.id, []);
  for (let a = input.from; a < input.to; a += MAX_RANGE_DAYS * DAY) {
    const b = Math.min(input.to, a + MAX_RANGE_DAYS * DAY);
    for (const s of input.services) {
      free.get(s.id)!.push(...freeIntervals(input.events, s.id, a, b, input.timezone).free);
    }
  }

  const bookedBy = new Map<string, number>();
  let bookedTotal = 0;
  for (const bk of input.bookings) {
    if (bk.status === 'cancelled') continue;
    const start = Math.max(input.from, Date.parse(bk.block_starts_at));
    const end = Math.min(input.to, Date.parse(bk.block_ends_at));
    if (end <= start) continue;
    bookedTotal += end - start;
    bookedBy.set(bk.service_id, (bookedBy.get(bk.service_id) ?? 0) + (end - start));
  }

  const byService = input.services.map((s) => {
    const offered = (sum(unionIntervals(free.get(s.id)!)) * s.capacity) / MIN;
    const booked = (bookedBy.get(s.id) ?? 0) / MIN;
    return { id: s.id, name: s.name, offered, booked, rate: rate(booked, offered) };
  });
  const maxCapacity = Math.max(1, ...input.services.map((s) => s.capacity));
  const offered = (sum(unionIntervals([...free.values()].flat())) * maxCapacity) / MIN;
  const booked = bookedTotal / MIN;
  return { total: { offered, booked, rate: rate(booked, offered) }, byService };
}

/** Suma de varias sedes (todas las sedes). */
export function combineOccupancy(rows: readonly OccupancyRow[]): OccupancyRow {
  const offered = rows.reduce((s, r) => s + r.offered, 0);
  const booked = rows.reduce((s, r) => s + r.booked, 0);
  return { offered, booked, rate: rate(booked, offered) };
}
