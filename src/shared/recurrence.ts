/**
 * Recurrencias del calendario (fase 08): opciones de «Repetir» estilo Google Calendar, su
 * traducción a RRULE (RFC 5545, sin prefijo `RRULE:`), el texto legible en español y los
 * ajustes de serie para «Este y los siguientes» o al mover «Todos los eventos».
 */
import { RRule } from 'rrule';
import { DAY, dayStartInstant, instantToWall, localDate, wallToInstant } from './availability';

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Chips de días como en Google Calendar en español. */
export const WEEKDAY_CHIPS: Record<Weekday, string> = { MO: 'L', TU: 'M', WE: 'X', TH: 'J', FR: 'V', SA: 'S', SU: 'D' };
export const WEEKDAY_NAMES: Record<Weekday, string> = {
  MO: 'lunes',
  TU: 'martes',
  WE: 'miércoles',
  TH: 'jueves',
  FR: 'viernes',
  SA: 'sábado',
  SU: 'domingo',
};
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const WORKDAYS: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR'];

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type RepeatEnd = { type: 'never' } | { type: 'until'; date: string } | { type: 'count'; count: number };
export interface CustomRepeat {
  freq: Freq;
  interval: number;
  byDay: Weekday[];
  end: RepeatEnd;
}
export type RepeatPreset = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | 'custom';

/** Día de la semana de una fecha 'YYYY-MM-DD'. */
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]!;
}

/** Opciones del selector «Repetir» para la fecha de inicio del evento. */
export function repeatOptions(date: string): { value: RepeatPreset; label: string }[] {
  const d = new Date(`${date}T00:00:00Z`);
  return [
    { value: 'none', label: 'No se repite' },
    { value: 'daily', label: 'Cada día' },
    { value: 'weekly', label: `Cada semana el ${WEEKDAY_NAMES[weekdayOf(date)]}` },
    { value: 'monthly', label: `Cada mes el día ${d.getUTCDate()}` },
    { value: 'yearly', label: `Cada año el ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}` },
    { value: 'weekdays', label: 'Todos los días laborables (lun–vie)' },
    { value: 'custom', label: 'Personalizado…' },
  ];
}

export function defaultCustom(date: string): CustomRepeat {
  return { freq: 'WEEKLY', interval: 1, byDay: [weekdayOf(date)], end: { type: 'never' } };
}

type Parts = Map<string, string>;

function parseParts(rule: string): Parts {
  const parts: Parts = new Map();
  for (const chunk of rule.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = chunk.split('=');
    if (k && v !== undefined) parts.set(k.toUpperCase(), v);
  }
  return parts;
}

const ORDER = ['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'COUNT', 'UNTIL'];

function stringify(parts: Parts): string {
  const keys = [...parts.keys()].sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.map((k) => `${k}=${parts.get(k)}`).join(';');
}

/** Instante → `YYYYMMDDTHHMMSSZ`. */
export function toRruleUtc(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function fromRruleUtc(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
  if (!m) return NaN;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

/** «Hasta el {fecha}» incluye todo ese día en la zona del evento. */
function untilFor(date: string, tz: string): string {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
  return toRruleUtc(dayStartInstant(next, tz) - 1000);
}

/** Preset + personalizado → RRULE (o `null` si no se repite). */
export function buildRule(preset: RepeatPreset, custom: CustomRepeat, date: string, tz: string): string | null {
  switch (preset) {
    case 'none':
      return null;
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${weekdayOf(date)}`;
    case 'monthly':
      return 'FREQ=MONTHLY';
    case 'yearly':
      return 'FREQ=YEARLY';
    case 'weekdays':
      return `FREQ=WEEKLY;BYDAY=${WORKDAYS.join(',')}`;
    case 'custom': {
      const parts: Parts = new Map([['FREQ', custom.freq]]);
      if (custom.interval > 1) parts.set('INTERVAL', String(Math.floor(custom.interval)));
      if (custom.freq === 'WEEKLY') {
        const days = custom.byDay.length ? custom.byDay : [weekdayOf(date)];
        parts.set('BYDAY', WEEKDAYS.filter((d) => days.includes(d)).join(','));
      }
      if (custom.end.type === 'count') parts.set('COUNT', String(Math.max(1, Math.floor(custom.end.count))));
      if (custom.end.type === 'until') parts.set('UNTIL', untilFor(custom.end.date, tz));
      return stringify(parts);
    }
  }
}

/** RRULE → lo que muestra el editor (un preset si coincide exactamente; si no, personalizado). */
export function parseRule(
  rule: string | null,
  date: string,
  tz: string,
): { preset: RepeatPreset; custom: CustomRepeat } {
  if (!rule) return { preset: 'none', custom: defaultCustom(date) };
  const parts = parseParts(rule);
  const freq = (parts.get('FREQ') ?? 'WEEKLY') as Freq;
  const byDay = (parts.get('BYDAY') ?? '')
    .split(',')
    .map((d) => d.slice(-2) as Weekday)
    .filter((d) => WEEKDAYS.includes(d));
  const until = parts.get('UNTIL');
  const count = parts.get('COUNT');
  const end: RepeatEnd = count
    ? { type: 'count', count: Number(count) }
    : until
      ? { type: 'until', date: localDate(fromRruleUtc(until), tz) }
      : { type: 'never' };
  const custom: CustomRepeat = {
    freq,
    interval: Number(parts.get('INTERVAL') ?? 1),
    byDay: byDay.length ? byDay : [weekdayOf(date)],
    end,
  };
  const normalized = stringify(parts);
  for (const preset of ['daily', 'weekly', 'monthly', 'yearly', 'weekdays'] as const) {
    if (buildRule(preset, custom, date, tz) === normalized) return { preset, custom };
  }
  return { preset: 'custom', custom };
}

function joinEs(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/** Texto legible de la RRULE (equivalente en español de `rrule.toText()`). */
export function describeRule(rule: string | null, date: string, tz: string): string {
  if (!rule) return 'No se repite';
  const parts = parseParts(rule);
  const freq = parts.get('FREQ');
  const n = Number(parts.get('INTERVAL') ?? 1);
  const d = new Date(`${date}T00:00:00Z`);
  const days = (parts.get('BYDAY') ?? '')
    .split(',')
    .map((x) => x.slice(-2) as Weekday)
    .filter((x) => WEEKDAYS.includes(x));
  let text: string;
  switch (freq) {
    case 'DAILY':
      text = n > 1 ? `Cada ${n} días` : 'Cada día';
      break;
    case 'WEEKLY': {
      const list = days.length ? days : [weekdayOf(date)];
      const sorted = WEEKDAYS.filter((x) => list.includes(x));
      if (n === 1 && sorted.join() === WORKDAYS.join()) text = 'Todos los días laborables (lun–vie)';
      else if (n === 1 && sorted.length === 7) text = 'Cada día';
      else text = `${n > 1 ? `Cada ${n} semanas` : 'Cada semana'} el ${joinEs(sorted.map((x) => WEEKDAY_NAMES[x]))}`;
      break;
    }
    case 'MONTHLY': {
      const day = parts.get('BYMONTHDAY') ?? String(d.getUTCDate());
      text = `${n > 1 ? `Cada ${n} meses` : 'Cada mes'} el día ${day}`;
      break;
    }
    case 'YEARLY':
      text = `${n > 1 ? `Cada ${n} años` : 'Cada año'} el ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
      break;
    default:
      text = 'Se repite';
  }
  const count = parts.get('COUNT');
  const until = parts.get('UNTIL');
  if (count) text += `, ${count} ${count === '1' ? 'vez' : 'veces'}`;
  else if (until) {
    const end = new Date(`${localDate(fromRruleUtc(until), tz)}T00:00:00Z`);
    text += `, hasta el ${end.getUTCDate()} de ${MONTHS[end.getUTCMonth()]} de ${end.getUTCFullYear()}`;
  }
  return text;
}

/** ¿Es una RRULE que el motor entiende? */
export function isValidRule(rule: string): boolean {
  const body = rule.replace(/^RRULE:/i, '');
  if (!/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;|$)/.test(body)) return false;
  const byDay = parseParts(body).get('BYDAY');
  if (byDay !== undefined && !byDay.split(',').every((d) => /^[+-]?d{0,2}(MO|TU|WE|TH|FR|SA|SU)$/.test(d)))
    return false;
  try {
    RRule.parseString(rule.replace(/^RRULE:/i, ''));
    return true;
  } catch {
    return false;
  }
}

/**
 * «Este y los siguientes»: la serie original termina justo antes de la ocurrencia. Devuelve
 * `null` si la ocurrencia es la primera (entonces equivale a «Todos los eventos»).
 */
export function cutRuleBefore(rule: string, seriesStart: number, occurrenceStart: number): string | null {
  if (occurrenceStart <= seriesStart) return null;
  const parts = parseParts(rule);
  parts.delete('COUNT');
  parts.set('UNTIL', toRruleUtc(occurrenceStart - 1000));
  return stringify(parts);
}

/** Regla de la serie nueva que empieza en la ocurrencia: conserva el final (COUNT se descuenta). */
export function tailRule(rule: string, usedCount: number): string {
  const parts = parseParts(rule);
  const count = parts.get('COUNT');
  if (count) parts.set('COUNT', String(Math.max(1, Number(count) - usedCount)));
  return stringify(parts);
}

/** Cuántas ocurrencias genera la serie antes de `occurrenceStart` (para descontar COUNT). */
export function occurrencesBefore(rule: string, seriesStart: number, tz: string, occurrenceStart: number): number {
  const options = RRule.parseString(rule.replace(/^RRULE:/i, ''));
  if (options.until) options.until = new Date(instantToWall(options.until.getTime(), tz));
  const dtstart = instantToWall(seriesStart, tz);
  const r = new RRule({ ...options, dtstart: new Date(dtstart) });
  return r
    .between(new Date(dtstart), new Date(instantToWall(occurrenceStart, tz)), true)
    .filter((w) => wallToInstant(w.getTime(), tz) < occurrenceStart).length;
}

/** Mueve un instante `deltaWall` ms de hora de pared (conserva la hora local tras cambios de hora). */
export function shiftWall(ms: number, deltaWall: number, tz: string): number {
  return wallToInstant(instantToWall(ms, tz) + deltaWall, tz);
}

/**
 * Al mover la serie entera `deltaDays` días, los BYDAY giran con ella (mover un «cada lunes»
 * al martes lo vuelve «cada martes»). El resto de la regla no cambia.
 */
export function shiftRuleDays(rule: string, deltaDays: number): string {
  const shift = ((deltaDays % 7) + 7) % 7;
  if (shift === 0) return rule;
  const parts = parseParts(rule);
  const byDay = parts.get('BYDAY');
  if (!byDay) return rule;
  parts.set(
    'BYDAY',
    byDay
      .split(',')
      .map((d) => {
        const prefix = d.slice(0, -2);
        const idx = WEEKDAYS.indexOf(d.slice(-2) as Weekday);
        return idx < 0 ? d : `${prefix}${WEEKDAYS[(idx + shift) % 7]}`;
      })
      .join(','),
  );
  return stringify(parts);
}
