/**
 * Motor de disponibilidad (fase 08 parte B, 00 D6 y D26). TS puro: lo usan la vista previa del
 * calendario, el Worker (`/api/public/slots`) y, en la fase 10, la validación de la reserva.
 *
 * Las recurrencias se expanden en «hora de pared» de la zona del evento: el DTSTART local se
 * pasa a `rrule` como una fecha UTC flotante y cada ocurrencia se vuelve a convertir a instante
 * con la zona. Así una serie «9:00 cada lunes» sigue a las 9:00 locales tras un cambio de hora.
 */
import { tzOffset } from '@date-fns/tz';
import { RRule } from 'rrule';

export const MINUTE = 60_000;
export const DAY = 86_400_000;
/** Rango máximo de una consulta de cupos. */
export const MAX_RANGE_DAYS = 31;

export type AvailabilityKind = 'open' | 'closed';

export interface AvailabilityEvent {
  id: string;
  kind: AvailabilityKind;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  rrule: string | null;
  exdates: string[];
  recurrenceParentId: string | null;
  recurrenceOriginalStart: string | null;
  serviceIds: string[] | null;
  capacityOverride: number | null;
}

/** Fila de `availability_events` (lo que devuelve PostgREST o `get_slot_inputs`). */
export interface AvailabilityEventRow {
  id: string;
  kind: AvailabilityKind;
  title?: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  rrule: string | null;
  exdates: string[] | null;
  recurrence_parent_id: string | null;
  recurrence_original_start: string | null;
  service_ids: string[] | null;
  capacity_override: number | null;
}

export function toAvailabilityEvent(row: AvailabilityEventRow): AvailabilityEvent {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title ?? '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    timezone: row.timezone,
    rrule: row.rrule,
    exdates: row.exdates ?? [],
    recurrenceParentId: row.recurrence_parent_id,
    recurrenceOriginalStart: row.recurrence_original_start,
    serviceIds: row.service_ids,
    capacityOverride: row.capacity_override,
  };
}

// ---------------------------------------------------------------------------
// Hora de pared ↔ instante
// ---------------------------------------------------------------------------

const offsetCache = new Map<string, Map<number, number>>();
const BUCKET = 15 * MINUTE; // todos los cambios de hora reales caen en múltiplos de 15 min

/** Desfase (ms) de la zona en ese instante. Memoizado: `Intl` es lo más caro del motor. */
function offsetMs(tz: string, ms: number): number {
  let byTz = offsetCache.get(tz);
  if (!byTz) {
    byTz = new Map();
    offsetCache.set(tz, byTz);
  }
  const bucket = Math.floor(ms / BUCKET);
  let off = byTz.get(bucket);
  if (off === undefined) {
    off = tzOffset(tz, new Date(bucket * BUCKET)) * MINUTE;
    if (byTz.size > 50_000) byTz.clear();
    byTz.set(bucket, off);
  }
  return off;
}

/** Instante → «hora de pared» (ms cuyos componentes UTC son la hora local de `tz`). */
export function instantToWall(ms: number, tz: string): number {
  return ms + offsetMs(tz, ms);
}

/**
 * «Hora de pared» → instante. Una hora inexistente (salto de primavera) avanza con el salto;
 * una hora ambigua (otoño) toma la primera.
 */
export function wallToInstant(wall: number, tz: string): number {
  const guess = wall - offsetMs(tz, wall);
  const before = offsetMs(tz, guess - 6 * 60 * MINUTE);
  const after = offsetMs(tz, guess + 6 * 60 * MINUTE);
  if (before === after) return wall - before;
  // Cerca de un cambio de hora. Ambigua: dos instantes válidos → el más temprano.
  // Inexistente: ninguno vuelve a `wall` → se aplica el desfase de antes del salto.
  const valid = [wall - before, wall - after].filter((c) => instantToWall(c, tz) === wall);
  return valid.length ? Math.min(...valid) : wall - before;
}

/** 'YYYY-MM-DD' local de un instante. */
export function localDate(ms: number, tz: string): string {
  return new Date(instantToWall(ms, tz)).toISOString().slice(0, 10);
}

/** Instante de las 00:00 locales del día 'YYYY-MM-DD'. */
export function dayStartInstant(date: string, tz: string): number {
  return wallToInstant(Date.parse(`${date}T00:00:00Z`), tz);
}

// ---------------------------------------------------------------------------
// Expansión de ocurrencias
// ---------------------------------------------------------------------------

export interface Occurrence {
  event: AvailabilityEvent;
  /** Serie a la que pertenece (el propio evento si no es excepción). */
  seriesId: string;
  start: number;
  end: number;
  /** Inicio original de la ocurrencia en su serie (clave de `exdates`). */
  originalStart: number;
}

/** Hora de pared de UNTIL: se guarda en UTC y la expansión trabaja con fechas flotantes. */
function untilWall(until: Date | null | undefined, tz: string): number | null {
  return until ? instantToWall(until.getTime(), tz) : null;
}

/** Expansión con la librería `rrule` (cualquier regla RFC 5545). */
export function rruleWalls(rule: string, wallStart: number, tz: string, fromWall: number, toWall: number): number[] {
  const options = RRule.parseString(rule.replace(/^RRULE:/i, ''));
  const until = untilWall(options.until, tz);
  if (until !== null) options.until = new Date(until);
  const r = new RRule({ ...options, dtstart: new Date(wallStart) }, true);
  return r.between(new Date(fromWall), new Date(toWall), true).map((d) => d.getTime());
}

interface SimpleRule {
  freq: 'DAILY' | 'WEEKLY';
  interval: number;
  /** Días permitidos, índice 0 = lunes; `null` = todos (DAILY) o el de DTSTART (WEEKLY). */
  days: boolean[] | null;
  count: number | null;
  until: number | null;
}

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const SIMPLE_KEYS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL', 'WKST']);
const simpleCache = new Map<string, (Omit<SimpleRule, 'until'> & { untilUtc: number | null }) | null>();

/**
 * Reglas diarias y semanales con INTERVAL, BYDAY simple, COUNT y UNTIL (todas las que crea el
 * calendario): se expanden con aritmética de días, ~50 veces más rápido que `rrule`, cuyo
 * iterador es lo más caro del motor. Cualquier otra regla usa `rrule`.
 */
function parseSimple(rule: string, tz: string): SimpleRule | null {
  let parsed = simpleCache.get(rule);
  if (parsed === undefined) {
    parsed = null;
    const parts = new Map(
      rule
        .replace(/^RRULE:/i, '')
        .split(';')
        .map((c) => c.split('=') as [string, string]),
    );
    const freq = parts.get('FREQ');
    const byDay = parts.get('BYDAY');
    const okKeys = [...parts.keys()].every((k) => SIMPLE_KEYS.has(k));
    const okDays = byDay === undefined || byDay.split(',').every((d) => DAY_CODES.includes(d));
    const interval = Number(parts.get('INTERVAL') ?? 1);
    const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : null;
    const until = parts.get('UNTIL');
    const untilMatch = until ? /^(d{4})(d{2})(d{2})T(d{2})(d{2})(d{2})Z$/.exec(until) : null;
    if (
      okKeys &&
      okDays &&
      (freq === 'DAILY' || freq === 'WEEKLY') &&
      (parts.get('WKST') ?? 'MO') === 'MO' &&
      Number.isInteger(interval) &&
      interval >= 1 &&
      (count === null || (Number.isInteger(count) && count >= 1)) &&
      (until === undefined || untilMatch)
    ) {
      parsed = {
        freq,
        interval,
        days: byDay ? DAY_CODES.map((d) => byDay.split(',').includes(d)) : null,
        count,
        untilUtc: untilMatch
          ? Date.UTC(
              +untilMatch[1]!,
              +untilMatch[2]! - 1,
              +untilMatch[3]!,
              +untilMatch[4]!,
              +untilMatch[5]!,
              +untilMatch[6]!,
            )
          : null,
      };
    }
    if (simpleCache.size > 1000) simpleCache.clear();
    simpleCache.set(rule, parsed);
  }
  if (!parsed) return null;
  return { ...parsed, until: parsed.untilUtc === null ? null : instantToWall(parsed.untilUtc, tz) };
}

/** Ocurrencias (hora de pared) de la serie en [fromWall, toWall], ambos inclusive. */
export function seriesWalls(rule: string, wallStart: number, tz: string, fromWall: number, toWall: number): number[] {
  const simple = parseSimple(rule, tz);
  if (!simple) return rruleWalls(rule, wallStart, tz, fromWall, toWall);
  const startDay = Math.floor(wallStart / DAY);
  const timeOfDay = wallStart - startDay * DAY;
  const dowOf = (day: number) => (day + 3) % 7; // 1-ene-1970 fue jueves; 0 = lunes
  const startMonday = startDay - dowOf(startDay);
  const days = simple.days ?? (simple.freq === 'WEEKLY' ? DAY_CODES.map((_, i) => i === dowOf(startDay)) : null);
  const out: number[] = [];
  // Con COUNT hay que contar desde el origen; sin COUNT se empieza cerca del rango.
  const firstDay = simple.count === null ? Math.max(startDay, Math.floor(fromWall / DAY)) : startDay;
  const lastDay = Math.floor(toWall / DAY);
  let n = 0;
  for (let day = firstDay; day <= lastDay; day++) {
    const ok =
      simple.freq === 'DAILY'
        ? (day - startDay) % simple.interval === 0
        : Math.floor((day - startMonday) / 7) % simple.interval === 0;
    if (!ok || (days && !days[dowOf(day)])) continue;
    const wall = day * DAY + timeOfDay;
    if (simple.until !== null && wall > simple.until) break;
    if (simple.count !== null && ++n > simple.count) break;
    if (wall >= fromWall && wall <= toWall) out.push(wall);
  }
  return out;
}

/**
 * Ocurrencias de los eventos que se solapan con [from, to). Aplica `exdates` y quita las
 * ocurrencias reemplazadas por una excepción (`recurrence_original_start`). Los eventos de
 * todo el día se anclan a las 00:00 de `allDayTimezone` (la zona de la sede).
 */
export function expandEvents(
  events: readonly AvailabilityEvent[],
  from: number,
  to: number,
  allDayTimezone?: string,
): Occurrence[] {
  const replaced = new Set<string>();
  for (const e of events) {
    if (e.recurrenceParentId && e.recurrenceOriginalStart) {
      replaced.add(`${e.recurrenceParentId}|${Date.parse(e.recurrenceOriginalStart)}`);
    }
  }

  const out: Occurrence[] = [];
  for (const event of events) {
    const tz = event.timezone;
    const anchorTz = event.allDay ? (allDayTimezone ?? tz) : tz;
    const wallStart = instantToWall(Date.parse(event.startsAt), tz);
    const wallEnd = instantToWall(Date.parse(event.endsAt), tz);
    const length = wallEnd - wallStart;
    const seriesId = event.recurrenceParentId ?? event.id;
    const push = (wall: number, originalStart: number) => {
      const start = wallToInstant(wall, anchorTz);
      const end = wallToInstant(wall + length, anchorTz);
      if (start < to && end > from) out.push({ event, seriesId, start, end, originalStart });
    };

    if (!event.rrule) {
      push(
        wallStart,
        event.recurrenceOriginalStart ? Date.parse(event.recurrenceOriginalStart) : Date.parse(event.startsAt),
      );
      continue;
    }
    const excluded = new Set(event.exdates.map((d) => Date.parse(d)));
    // Margen de un día a cada lado: cubre la diferencia entre la zona del evento y la de la sede.
    const fromWall = instantToWall(from, tz) - length - DAY;
    let walls: number[];
    try {
      walls = seriesWalls(event.rrule, wallStart, tz, fromWall, instantToWall(to, tz) + DAY);
    } catch {
      continue; // regla ilegible: se ignora el evento en vez de tumbar el cálculo de cupos
    }
    for (const wall of walls) {
      const originalStart = wallToInstant(wall, tz);
      if (excluded.has(originalStart) || replaced.has(`${event.id}|${originalStart}`)) continue;
      push(wall, originalStart);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

// ---------------------------------------------------------------------------
// Intervalos
// ---------------------------------------------------------------------------

export type Interval = [start: number, end: number];

/** Une intervalos que se solapan o se tocan. */
export function unionIntervals(list: readonly Interval[]): Interval[] {
  const sorted = [...list].filter(([a, b]) => a < b).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** `base` menos `cuts` (ambas listas ya unidas y ordenadas). */
export function subtractIntervals(base: readonly Interval[], cuts: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let j = 0;
  for (const [a0, b] of base) {
    let a = a0;
    while (j < cuts.length && cuts[j]![1] <= a) j++;
    let k = j;
    while (k < cuts.length && cuts[k]![0] < b) {
      const [c, d] = cuts[k]!;
      if (c > a) out.push([a, c]);
      a = Math.max(a, d);
      if (a >= b) break;
      k++;
    }
    if (a < b) out.push([a, b]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cupos
// ---------------------------------------------------------------------------

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
/** Estados que ocupan cupo. */
export const BLOCKING_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed'];

export interface SlotService {
  id: string;
  durationMinutes: number;
  bufferBefore: number;
  bufferAfter: number;
  capacity: number;
}

export interface SlotBooking {
  blockStart: Date | string;
  blockEnd: Date | string;
  serviceId: string;
  status: BookingStatus;
}

export interface SlotSettings {
  slotStepMinutes: number;
  minLeadMinutes: number;
  maxDaysAhead: number;
}

export interface SlotQuery {
  timezone: string;
  range: { from: Date; to: Date };
  service: SlotService;
  events: readonly AvailabilityEvent[];
  bookings: readonly SlotBooking[];
  settings: SlotSettings;
  now: Date;
}

export interface Slot {
  start: string;
  end: string;
  remaining: number;
  /** Capacidad de la ventana (`capacity_override` o la del servicio): la recibe `create_booking`. */
  capacity: number;
}

export interface DaySlots {
  date: string;
  slots: Slot[];
}

const appliesTo = (event: AvailabilityEvent, serviceId: string) =>
  event.serviceIds === null || event.serviceIds.length === 0 || event.serviceIds.includes(serviceId);

/** Intervalos libres del servicio (ventanas `open` unidas menos las `closed`) en [from, to). */
export function freeIntervals(
  events: readonly AvailabilityEvent[],
  serviceId: string,
  from: number,
  to: number,
  timezone: string,
): { free: Interval[]; opens: Occurrence[] } {
  const occ = expandEvents(
    events.filter((e) => appliesTo(e, serviceId)),
    from,
    to,
    timezone,
  );
  const opens = occ.filter((o) => o.event.kind === 'open');
  const closed = unionIntervals(occ.filter((o) => o.event.kind === 'closed').map((o) => [o.start, o.end]));
  return { free: subtractIntervals(unionIntervals(opens.map((o) => [o.start, o.end])), closed), opens };
}

/**
 * Horarios reservables (algoritmo de la fase 08 §B). Candidatos cada `slotStepMinutes`
 * alineados a la medianoche local; válido si el bloque con buffers cabe en un intervalo libre,
 * respeta la antelación mínima y máxima, y quedan cupos (reservas pendientes o confirmadas
 * del mismo servicio que se solapan con el bloque < capacidad de la ventana o del servicio).
 */
export function computeSlots(query: SlotQuery): DaySlots[] {
  const { timezone: tz, service, settings } = query;
  const from = query.range.from.getTime();
  const to = query.range.to.getTime();
  if (!(from < to)) return [];
  if (to - from > MAX_RANGE_DAYS * DAY + 2 * 60 * MINUTE) throw new RangeError(`Rango mayor a ${MAX_RANGE_DAYS} días`);

  const step = Math.max(5, Math.round(settings.slotStepMinutes)) * MINUTE;
  const duration = service.durationMinutes * MINUTE;
  const before = service.bufferBefore * MINUTE;
  const after = service.bufferAfter * MINUTE;
  const earliest = Math.max(from, query.now.getTime() + settings.minLeadMinutes * MINUTE);
  const latest = Math.min(to - 1, query.now.getTime() + settings.maxDaysAhead * DAY);
  if (earliest > latest) return [];

  // Margen: una ventana que empieza antes de `from` puede alojar el buffer de un cupo.
  const { free, opens } = freeIntervals(query.events, service.id, from - before - DAY, to + duration + after + DAY, tz);

  const bookings = query.bookings
    .filter((b) => b.serviceId === service.id && BLOCKING_STATUSES.includes(b.status))
    .map((b) => [new Date(b.blockStart).getTime(), new Date(b.blockEnd).getTime()] as Interval)
    .sort((x, y) => x[0] - y[0]);
  const maxBookingLength = bookings.reduce((m, [a, b]) => Math.max(m, b - a), 0);
  const overrides = opens.some((o) => o.event.capacityOverride !== null);
  const maxOpenLength = opens.reduce((m, o) => Math.max(m, o.end - o.start), 0);

  const days = new Map<string, Slot[]>();
  let lastStart = -Infinity;
  for (const [a, b] of free) {
    const firstStart = Math.max(a + before, earliest);
    const lastAllowed = Math.min(b - duration - after, latest);
    if (firstStart > lastAllowed) continue;

    // Primer candidato alineado a la rejilla local (se reinicia cada medianoche).
    let wall = instantToWall(firstStart, tz);
    wall = alignUp(wall, step);
    for (;;) {
      const start = wallToInstant(wall, tz);
      if (start > lastAllowed) break;
      if (start >= firstStart && start > lastStart) {
        lastStart = start;
        const blockStart = start - before;
        const blockEnd = start + duration + after;
        const capacity = overrides
          ? capacityFor(opens, maxOpenLength, blockStart, blockEnd, service.capacity)
          : service.capacity;
        const used = overlapping(bookings, maxBookingLength, blockStart, blockEnd);
        if (used < capacity) {
          const date = dayKey(Math.floor(wall / DAY));
          let list = days.get(date);
          if (!list) days.set(date, (list = []));
          list.push({ start: fastIso(start), end: fastIso(start + duration), remaining: capacity - used, capacity });
        }
      }
      const next = wall + step;
      wall = Math.floor(next / DAY) !== Math.floor(wall / DAY) ? Math.floor(next / DAY) * DAY : next;
    }
  }
  return [...days].map(([date, slots]) => ({ date, slots }));
}

// `toISOString` es lo más caro al generar ~2.000 cupos: las fechas se memoizan por día.
const dayKeys = new Map<number, string>();
function dayKey(day: number): string {
  let key = dayKeys.get(day);
  if (key === undefined) {
    key = new Date(day * DAY).toISOString().slice(0, 10);
    if (dayKeys.size > 10_000) dayKeys.clear();
    dayKeys.set(day, key);
  }
  return key;
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** = `new Date(ms).toISOString()` para instantes en segundos exactos. */
function fastIso(ms: number): string {
  if (ms % 1000 !== 0) return new Date(ms).toISOString();
  const day = Math.floor(ms / DAY);
  const secs = (ms - day * DAY) / 1000;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${dayKey(day)}T${pad2(h)}:${pad2(m)}:${pad2(secs % 60)}.000Z`;
}

/** Sube la hora de pared al siguiente múltiplo de `step` contado desde la medianoche. */
function alignUp(wall: number, step: number): number {
  const midnight = Math.floor(wall / DAY) * DAY;
  const aligned = midnight + Math.ceil((wall - midnight) / step) * step;
  return aligned >= midnight + DAY ? midnight + DAY : aligned;
}

/** Capacidad del bloque: la mayor de las ventanas `open` que lo contienen entero. */
function capacityFor(opens: readonly Occurrence[], maxLength: number, a: number, b: number, fallback: number): number {
  let best: number | null = null;
  // Última ventana que empieza en o antes de `a`; se recorre hacia atrás.
  let lo = 0;
  let hi = opens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (opens[mid]!.start <= a) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0; i--) {
    const o = opens[i]!;
    if (o.start < a - maxLength) break;
    if (o.end >= b) {
      const cap = o.event.capacityOverride ?? fallback;
      best = best === null ? cap : Math.max(best, cap);
    }
  }
  return best ?? fallback;
}

/** Reservas (ordenadas por inicio) que se solapan con [a, b). */
function overlapping(bookings: readonly Interval[], maxLength: number, a: number, b: number): number {
  // Primera reserva que podría solaparse: empieza después de a - maxLength.
  let lo = 0;
  let hi = bookings.length;
  const min = a - maxLength;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bookings[mid]![0] < min) lo = mid + 1;
    else hi = mid;
  }
  let count = 0;
  for (let i = lo; i < bookings.length && bookings[i]![0] < b; i++) if (bookings[i]![1] > a) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Entrada de la RPC `get_slot_inputs`
// ---------------------------------------------------------------------------

export interface SlotInputs {
  company_id: string;
  branch_id: string;
  timezone: string;
  settings: { slot_step_minutes?: number; min_lead_minutes?: number; max_days_ahead?: number };
  service: {
    id: string;
    duration_minutes: number;
    buffer_before_minutes: number;
    buffer_after_minutes: number;
    capacity: number;
  };
  events: AvailabilityEventRow[];
  bookings: { block_starts_at: string; block_ends_at: string; service_id: string; status: BookingStatus }[];
}

export const DEFAULT_SLOT_SETTINGS: SlotSettings = { slotStepMinutes: 30, minLeadMinutes: 60, maxDaysAhead: 60 };

export function toSlotSettings(raw: SlotInputs['settings'] | null | undefined): SlotSettings {
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
  return {
    slotStepMinutes: num(raw?.slot_step_minutes, DEFAULT_SLOT_SETTINGS.slotStepMinutes) || 30,
    minLeadMinutes: num(raw?.min_lead_minutes, DEFAULT_SLOT_SETTINGS.minLeadMinutes),
    maxDaysAhead: num(raw?.max_days_ahead, DEFAULT_SLOT_SETTINGS.maxDaysAhead),
  };
}

/** `SlotInputs` (RPC) + rango → `SlotQuery`. */
export function toSlotQuery(inputs: SlotInputs, range: { from: Date; to: Date }, now: Date): SlotQuery {
  return {
    timezone: inputs.timezone,
    range,
    now,
    settings: toSlotSettings(inputs.settings),
    service: {
      id: inputs.service.id,
      durationMinutes: inputs.service.duration_minutes,
      bufferBefore: inputs.service.buffer_before_minutes,
      bufferAfter: inputs.service.buffer_after_minutes,
      capacity: inputs.service.capacity,
    },
    events: inputs.events.map(toAvailabilityEvent),
    bookings: inputs.bookings.map((b) => ({
      blockStart: b.block_starts_at,
      blockEnd: b.block_ends_at,
      serviceId: b.service_id,
      status: b.status,
    })),
  };
}
