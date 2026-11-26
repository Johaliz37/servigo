/**
 * Fase 10: reserva pública. Esquemas (mismo Zod en el asistente y en el Worker), código de
 * reserva, totales, calendario (.ics y Google) y textos. TS puro.
 */
import { z } from 'zod';
import type { BookingStatus } from './availability';
import type { FieldOption, FieldType } from './booking-fields';
import { emailSchema } from './schemas';
import type { PublicAddon, PublicItem } from './public-site';

// ---------------------------------------------------------------------------
// Código de reserva (00 §6): 8 caracteres Crockford Base32, mostrado «K7M2-9QXA»
// ---------------------------------------------------------------------------

export const BOOKING_CODE_REGEX = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/**
 * Lo que escribe el cliente → código canónico. Crockford: sin guiones ni espacios, en
 * mayúsculas; O se lee como 0 e I/L como 1 (las letras ambiguas no existen en el código).
 */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

/** E.164: lo produce `react-phone-number-input` y lo exige `customers.phone`. */
export const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export const phoneSchema = z.string().trim().regex(E164_REGEX, { error: 'Escribe un teléfono válido' });

export const customerSchema = z.object({
  name: z.string().trim().min(1, { error: 'Escribe tu nombre' }).max(160, { error: 'Máximo 160 caracteres' }),
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .pipe(emailSchema.nullable()),
  notes: z
    .string()
    .trim()
    .max(1000, { error: 'Máximo 1000 caracteres' })
    .transform((v) => (v === '' ? null : v))
    .nullable(),
});
export type CustomerInput = z.input<typeof customerSchema>;

export const bookingRequestSchema = z.object({
  branch_slug: z.string().min(1).max(64),
  service_id: z.uuid(),
  starts_at: z.iso.datetime({ offset: true }),
  customer: customerSchema,
  items: z
    .array(z.object({ product_id: z.uuid(), quantity: z.int().min(1).max(999) }))
    .max(30)
    .default([]),
  /** Respuestas por id de campo; las valida `buildAnswersSchema` con los campos reales. */
  answers: z.record(z.string(), z.unknown()).default({}),
  accept_terms: z.boolean().default(false),
  /** Autorización de tratamiento de datos (Ley 1581, D31): obligatoria. */
  privacy_consent: z.literal(true, { error: 'Debes autorizar el tratamiento de tus datos personales' }),
  turnstile: z.string().min(1, { error: 'Completa la verificación' }).max(4096),
});
export type BookingRequest = z.input<typeof bookingRequestSchema>;

/** Contacto para buscar: teléfono E.164 o correo. */
export const contactSchema = z.union([z.object({ phone: phoneSchema }), z.object({ email: emailSchema })]);

export const lookupSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('code'),
    code: z
      .string()
      .transform(normalizeCode)
      .pipe(z.string().regex(BOOKING_CODE_REGEX, { error: 'El código tiene 8 caracteres' })),
    contact: contactSchema,
    turnstile: z.string().min(1).max(4096),
  }),
  z.object({
    mode: z.literal('contact'),
    contact: contactSchema,
    turnstile: z.string().min(1).max(4096),
  }),
]);
export type LookupRequest = z.input<typeof lookupSchema>;

export const cancelSchema = z.object({
  token: z.string().min(1).max(512),
  turnstile: z.string().min(1).max(4096),
});

// ---------------------------------------------------------------------------
// Respuestas de la API
// ---------------------------------------------------------------------------

export interface BookingForm {
  branch: { id: string; slug: string; name: string; address: string | null; city: string | null; timezone: string };
  service: PublicItem;
  addons: PublicAddon[];
  fields: {
    id: string;
    service_id: string | null;
    label: string;
    help_text: string | null;
    placeholder: string | null;
    type: FieldType;
    options: unknown;
    required: boolean;
    validation: unknown;
    is_active: boolean;
    sort_order: number;
  }[];
  settings: { require_email: boolean; terms_text: string; auto_confirm: boolean };
}

export interface CreatedBooking {
  code: string;
  status: BookingStatus;
  token: string;
}

export interface BookingDetail {
  code: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  created_at: string;
  customer_name: string;
  customer_notes: string | null;
  service_id: string;
  service_name: string;
  service_price: number;
  service_discount: number;
  products_total: number;
  discount_total: number;
  total: number;
  currency: string;
  branch: {
    slug: string;
    name: string;
    address: string | null;
    city: string | null;
    maps_url: string | null;
    phone: string | null;
    whatsapp: string | null;
    timezone: string;
  };
  items: { name: string; unit_price: number; discount: number; quantity: number; line_total: number }[];
  answers: { label: string; type: FieldType; value: unknown; options: FieldOption[] }[];
  /** Si el cliente puede cancelar ahora mismo (permiso de la empresa y plazo). */
  can_cancel: boolean;
  cancel_limit_hours: number;
  token: string;
}

export interface BookingSummary {
  code: string;
  status: BookingStatus;
  starts_at: string;
  service_name: string;
  branch_name: string;
  timezone: string;
  customer_name: string;
  token: string;
}

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
};

/** ¿Puede el cliente cancelar? (la BD lo vuelve a comprobar). */
export function canCustomerCancel(
  booking: { status: BookingStatus; starts_at: string },
  settings: { allowed: boolean; limit_hours: number },
  now: Date,
): boolean {
  if (!settings.allowed || (booking.status !== 'pending' && booking.status !== 'confirmed')) return false;
  return Date.parse(booking.starts_at) - now.getTime() > settings.limit_hours * 3_600_000;
}

// ---------------------------------------------------------------------------
// Totales (= create_booking: precios ya calculados con la regla de D24)
// ---------------------------------------------------------------------------

export interface QuoteLine {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unitFinal: number;
  lineTotal: number;
}

export interface Quote {
  service: number;
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  total: number;
}

const digitsOf = (currency: string) => (['COP', 'CLP', 'PYG', 'JPY', 'KRW'].includes(currency.toUpperCase()) ? 0 : 2);
const round = (n: number, d: number) => {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/**
 * Total de la reserva con los precios que entregó la API (`price` base y `final_price` con
 * descuento por unidad). Coincide al centavo con `create_booking`.
 */
export function quoteBooking(
  service: Pick<PublicItem, 'price' | 'final_price'>,
  addons: readonly Pick<PublicAddon, 'id' | 'name' | 'price' | 'final_price'>[],
  quantities: Readonly<Record<string, number>>,
  currency: string,
): Quote {
  const d = digitsOf(currency);
  const lines = addons.flatMap((a): QuoteLine[] => {
    const quantity = Math.max(0, Math.trunc(quantities[a.id] ?? 0));
    if (!quantity) return [];
    return [
      {
        id: a.id,
        name: a.name,
        quantity,
        unitPrice: a.price,
        unitFinal: a.final_price,
        lineTotal: round(a.final_price * quantity, d),
      },
    ];
  });
  const subtotal = round(service.price + lines.reduce((s, l) => s + round(l.unitPrice * l.quantity, d), 0), d);
  const total = round(service.final_price + lines.reduce((s, l) => s + l.lineTotal, 0), d);
  return { service: service.final_price, lines, subtotal, discount: round(subtotal - total, d), total };
}

// ---------------------------------------------------------------------------
// Calendario y mensajes
// ---------------------------------------------------------------------------

/** 20261130T150000Z */
const icsDate = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const icsText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[,;]/g, (m) => `\\${m}`);

/** Plegado de líneas de RFC 5545 (75 octetos; aproximado por caracteres). */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 73) parts.push((i ? ' ' : '') + line.slice(i, i + 73));
  return parts.join('\r\n');
}

export interface CalendarEvent {
  uid: string;
  title: string;
  start: string;
  end: string;
  location: string;
  description: string;
  url?: string;
}

/** Archivo .ics (RFC 5545) de un evento, con horas en UTC. */
export function bookingIcs(event: CalendarEvent, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Roquintech//Servigo//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(event.start)}`,
    `DTEND:${icsDate(event.end)}`,
    `SUMMARY:${icsText(event.title)}`,
    `LOCATION:${icsText(event.location)}`,
    `DESCRIPTION:${icsText(event.description)}`,
    ...(event.url ? [`URL:${event.url}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Enlace «Añadir a Google Calendar». */
export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${icsDate(event.start)}/${icsDate(event.end)}`,
    details: event.description,
    location: event.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Hora local de la sede: «sábado, 30 de noviembre de 2026, 3:00 p. m.». */
export function formatBookingDate(iso: string, timeZone: string, locale = 'es-CO'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone: string, locale = 'es-CO'): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
}

/** Mensaje para la empresa por WhatsApp. */
export function whatsappBookingText(b: {
  code: string;
  service_name: string;
  starts_at: string;
  timezone: string;
}): string {
  return `Hola, mi reserva ${formatCode(b.code)}: ${b.service_name}, ${formatBookingDate(b.starts_at, b.timezone)}.`;
}

/** Franja del día de un cupo en la zona de la sede. */
export function dayPart(iso: string, timeZone: string): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(iso)),
  );
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

export const DAY_PART_LABELS = { morning: 'Mañana', afternoon: 'Tarde', evening: 'Noche' } as const;
