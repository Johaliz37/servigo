/**
 * Gestión de reservas en el panel (fase 11, D29): reglas puras que comparten la bandeja, el
 * detalle y las pruebas. La autoridad es la BD (`booking_transition_allowed`,
 * `update_booking_admin`); aquí están sus gemelas para decidir qué botones mostrar y para
 * previsualizar totales.
 */
import type { BookingStatus } from './availability';
import { formatCode, STATUS_LABELS } from './booking';
import { currencyDigits, roundMoney } from './pricing';

// ---------------------------------------------------------------------------
// Máquina de estados (= booking_transition_allowed)
// ---------------------------------------------------------------------------

export type TargetStatus = Exclude<BookingStatus, 'pending'>;

export function transitionAllowed(from: BookingStatus, to: BookingStatus, startsAt: string, now = new Date()): boolean {
  if (from === 'pending') return to === 'confirmed' || to === 'cancelled';
  if (from === 'confirmed') {
    return to === 'cancelled' || ((to === 'completed' || to === 'no_show') && Date.parse(startsAt) <= now.getTime());
  }
  return false;
}

const ORDER: readonly TargetStatus[] = ['confirmed', 'completed', 'no_show', 'cancelled'];

/** Transiciones posibles desde el estado actual, en el orden de los botones. */
export function allowedTransitions(status: BookingStatus, startsAt: string, now = new Date()): TargetStatus[] {
  return ORDER.filter((to) => transitionAllowed(status, to, startsAt, now));
}

export const TRANSITION_LABELS: Record<TargetStatus, string> = {
  confirmed: 'Confirmar',
  completed: 'Completar',
  no_show: 'No asistió',
  cancelled: 'Cancelar',
};

/** Estados que todavía se pueden reprogramar o editar. */
export const canReschedule = (status: BookingStatus) => status === 'pending' || status === 'confirmed';
export const canEdit = (status: BookingStatus) => status !== 'cancelled';

// ---------------------------------------------------------------------------
// Pestañas de la bandeja
// ---------------------------------------------------------------------------

export type InboxTab = 'today' | 'upcoming' | 'pending' | 'past' | 'cancelled' | 'all';

export const INBOX_TABS: readonly { id: InboxTab; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'upcoming', label: 'Próximas' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'past', label: 'Pasadas' },
  { id: 'cancelled', label: 'Canceladas' },
  { id: 'all', label: 'Todas' },
];

export const isInboxTab = (value: string | null): value is InboxTab => INBOX_TABS.some((t) => t.id === value);

export interface InboxCriteria {
  statuses: BookingStatus[] | null;
  /** ISO, inclusivo. */
  from: string | null;
  /** ISO, exclusivo. */
  to: string | null;
  ascending: boolean;
}

/**
 * Condiciones de cada pestaña. `today` = [inicio de hoy, inicio de mañana) en la zona de la
 * sede (o de la empresa con «todas las sedes").
 */
export function tabCriteria(tab: InboxTab, now: Date, today: { start: number; end: number }): InboxCriteria {
  const iso = (ms: number) => new Date(ms).toISOString();
  switch (tab) {
    case 'today':
      return { statuses: null, from: iso(today.start), to: iso(today.end), ascending: true };
    case 'upcoming':
      return { statuses: ['pending', 'confirmed'], from: now.toISOString(), to: null, ascending: true };
    case 'pending':
      return { statuses: ['pending'], from: null, to: null, ascending: true };
    case 'past':
      return { statuses: ['confirmed', 'completed', 'no_show'], from: null, to: now.toISOString(), ascending: false };
    case 'cancelled':
      return { statuses: ['cancelled'], from: null, to: null, ascending: false };
    case 'all':
      return { statuses: null, from: null, to: null, ascending: false };
  }
}

/** Intersección del filtro de estado de la pestaña con el del usuario. */
export function mergeStatuses(tab: BookingStatus[] | null, chosen: BookingStatus | null): BookingStatus[] | null {
  if (!chosen) return tab;
  if (!tab) return [chosen];
  return tab.includes(chosen) ? [chosen] : [];
}

// ---------------------------------------------------------------------------
// Búsqueda (código, nombre, teléfono, correo) → filtro `or` de PostgREST
// ---------------------------------------------------------------------------

/**
 * Convierte lo que escribe el usuario en un filtro `or=(...)` seguro: quita los caracteres
 * con significado en la sintaxis de PostgREST (`, ( ) * " \ :`) y `%`. `null` si no queda nada.
 */
export function searchFilter(
  term: string,
  columns = { code: 'code', name: 'customer_name', email: 'customer_email', phone: 'customer_phone' },
): string | null {
  const safe = term
    .trim()
    .replace(/[,()*"\\:%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (safe.length < 2) return null;
  const parts = [`${columns.name}.ilike.*${safe}*`, `${columns.email}.ilike.*${safe}*`];
  const compact = safe.replace(/[\s-]/g, '').toUpperCase();
  if (/^[0-9A-Z]{3,8}$/.test(compact)) parts.push(`${columns.code}.ilike.*${compact}*`);
  const digits = safe.replace(/\D/g, '');
  if (digits.length >= 3 && digits.length >= safe.replace(/[\s+()-]/g, '').length) {
    parts.push(`${columns.phone}.ilike.*${digits}*`);
  }
  return parts.join(',');
}

// ---------------------------------------------------------------------------
// CSV (generado en el navegador)
// ---------------------------------------------------------------------------

type Cell = string | number | null | undefined;

/** Evita que Excel interprete una celda como fórmula (`=`, `@`, o `+`/`-` seguidos de algo que no es número). */
function guard(value: string): string {
  return /^[=@\t\r]/.test(value) || /^[+-](?![\d\s])/.test(value) ? `'${value}` : value;
}

/** RFC 4180: separador coma, comillas dobles escapadas y CRLF. */
export function toCsv(rows: readonly (readonly Cell[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return '';
          const text = typeof cell === 'number' ? String(cell) : guard(cell);
          return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(','),
    )
    .join('\r\n');
}

export interface CsvBooking {
  code: string;
  status: BookingStatus;
  starts_at: string;
  source: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  service_name: string;
  total: number;
  currency: string;
  branch: { name: string; timezone: string } | null;
}

const CSV_HEADER = [
  'Código',
  'Fecha',
  'Hora',
  'Sede',
  'Servicio',
  'Cliente',
  'Teléfono',
  'Correo',
  'Estado',
  'Origen',
  'Total',
  'Moneda',
];

/** Filas del CSV de la bandeja, con fecha y hora en la zona de cada sede. */
export function bookingsCsv(rows: readonly CsvBooking[], fallbackTz: string, locale = 'es-CO'): string {
  const body = rows.map((b) => {
    const tz = b.branch?.timezone ?? fallbackTz;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const time = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const at = new Date(b.starts_at);
    return [
      formatCode(b.code),
      date.format(at),
      time.format(at),
      b.branch?.name ?? '',
      b.service_name,
      b.customer_name,
      b.customer_phone,
      b.customer_email,
      STATUS_LABELS[b.status],
      b.source === 'admin' ? 'Panel' : 'Web',
      b.total,
      b.currency,
    ];
  });
  return toCsv([CSV_HEADER, ...body]);
}

// ---------------------------------------------------------------------------
// WhatsApp al cliente (enlace wa.me, sin costo)
// ---------------------------------------------------------------------------

export interface MessageContext {
  code: string;
  customer_name: string;
  service_name: string;
  /** Fecha y hora ya formateadas en la zona de la sede. */
  when: string;
  branch_name: string;
  company_name: string;
}

export type TemplateId = 'confirmed' | 'reminder' | 'rescheduled' | 'cancelled';

export const MESSAGE_TEMPLATES: readonly { id: TemplateId; label: string }[] = [
  { id: 'confirmed', label: 'Confirmación' },
  { id: 'reminder', label: 'Recordatorio' },
  { id: 'rescheduled', label: 'Cambio de horario' },
  { id: 'cancelled', label: 'Cancelación' },
];

export function messageText(id: TemplateId, c: MessageContext): string {
  const first = c.customer_name.trim().split(/\s+/)[0] ?? '';
  const hi = `Hola${first ? ` ${first}` : ''}`;
  const code = formatCode(c.code);
  switch (id) {
    case 'confirmed':
      return `${hi}, tu reserva ${code} de ${c.service_name} está confirmada para el ${c.when} en ${c.branch_name}. ¡Te esperamos! — ${c.company_name}`;
    case 'reminder':
      return `${hi}, te recordamos tu reserva ${code} de ${c.service_name} el ${c.when} en ${c.branch_name}. — ${c.company_name}`;
    case 'rescheduled':
      return `${hi}, tu reserva ${code} de ${c.service_name} cambió al ${c.when} en ${c.branch_name}. Si no te queda bien, respóndenos por aquí. — ${c.company_name}`;
    case 'cancelled':
      return `${hi}, tu reserva ${code} de ${c.service_name} del ${c.when} fue cancelada. Si quieres reservar otro horario, respóndenos por aquí. — ${c.company_name}`;
  }
}

/** `https://wa.me/573001234567?text=...` (el número en E.164 sin el +). */
export function whatsappLink(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

// ---------------------------------------------------------------------------
// Edición: totales (= update_booking_admin)
// ---------------------------------------------------------------------------

export interface FrozenItem {
  product_id: string | null;
  name: string;
  unit_price: number;
  /** Descuento de la línea completa. */
  discount: number;
  quantity: number;
  line_total: number;
}

export interface CurrentAddon {
  id: string;
  name: string;
  price: number;
  final_price: number;
}

export interface EditLine {
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  unitDiscount: number;
  discount: number;
  lineTotal: number;
  /** Precio congelado de la reserva (no el actual). */
  frozen: boolean;
}

export interface EditQuote {
  lines: EditLine[];
  servicePrice: number;
  serviceDiscount: number;
  productsTotal: number;
  discountTotal: number;
  total: number;
}

/**
 * Totales de una reserva editada: lo que ya tenía conserva su precio por unidad salvo
 * `reprice`; un producto nuevo (o todo, con `reprice`) toma el precio actual. Las líneas sin
 * producto (borrado del catálogo) se conservan.
 */
export function editQuote(input: {
  currency: string;
  service: { price: number; discount: number };
  currentService: { price: number; final_price: number } | null;
  items: readonly FrozenItem[];
  addons: readonly CurrentAddon[];
  quantities: Readonly<Record<string, number>>;
  reprice: boolean;
}): EditQuote {
  const d = currencyDigits(input.currency);
  const r = (n: number) => roundMoney(n, d);
  const servicePrice = input.reprice && input.currentService ? input.currentService.price : input.service.price;
  const serviceDiscount =
    input.reprice && input.currentService
      ? r(input.currentService.price - input.currentService.final_price)
      : input.service.discount;

  const lines: EditLine[] = input.items
    .filter((i) => i.product_id === null)
    .map((i) => ({
      productId: null,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      unitDiscount: r(i.discount / i.quantity),
      discount: i.discount,
      lineTotal: i.line_total,
      frozen: true,
    }));

  for (const [productId, raw] of Object.entries(input.quantities)) {
    const quantity = Math.trunc(raw);
    if (!(quantity >= 1)) continue;
    const old = input.items.find((i) => i.product_id === productId);
    const addon = old && !input.reprice ? undefined : input.addons.find((a) => a.id === productId);
    let unitPrice: number;
    let unitDiscount: number;
    let name: string;
    if (addon) {
      unitPrice = addon.price;
      unitDiscount = r(addon.price - addon.final_price);
      name = addon.name;
    } else if (old) {
      unitPrice = old.unit_price;
      unitDiscount = r(old.discount / old.quantity);
      name = old.name;
    } else continue;
    lines.push({
      productId,
      name,
      quantity,
      unitPrice,
      unitDiscount,
      discount: r(unitDiscount * quantity),
      lineTotal: r((unitPrice - unitDiscount) * quantity),
      frozen: !addon,
    });
  }

  const productsTotal = lines.reduce((s, l) => s + r(l.unitPrice * l.quantity), 0);
  const itemsDiscount = lines.reduce((s, l) => s + l.discount, 0);
  const itemsTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  return {
    lines,
    servicePrice,
    serviceDiscount,
    productsTotal: r(productsTotal),
    discountTotal: r(serviceDiscount + itemsDiscount),
    total: r(servicePrice - serviceDiscount + itemsTotal),
  };
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

export interface BookingEventRow {
  action: 'created' | 'status_changed' | 'rescheduled' | 'edited' | 'anonymized';
  payload: Record<string, unknown>;
}

const CHANGE_LABELS: Record<string, string> = {
  customer: 'datos del cliente',
  items: 'productos',
  answers: 'información adicional',
  reprice: 'precios actualizados',
};

/** Texto de una línea del historial (sin la fecha ni el autor). */
export function describeEvent(e: BookingEventRow, formatWhen: (iso: string) => string): string {
  const p = e.payload;
  switch (e.action) {
    case 'created':
      return `Reserva creada desde ${p.source === 'admin' ? 'el panel' : 'el sitio web'}${p.forced ? ' (fuera de disponibilidad)' : ''}`;
    case 'status_changed': {
      const to = STATUS_LABELS[p.to as BookingStatus] ?? String(p.to);
      const who = p.by === 'customer' ? ' por el cliente' : '';
      return `${to}${who}${typeof p.reason === 'string' ? `: «${p.reason}»` : ''}`;
    }
    case 'rescheduled':
      return `Reprogramada: ${formatWhen(String(p.from))} → ${formatWhen(String(p.to))}${p.forced ? ' (forzada)' : ''}`;
    case 'edited': {
      const changes = Array.isArray(p.changes) ? p.changes.map((c) => CHANGE_LABELS[String(c)] ?? String(c)) : [];
      return `Editada${changes.length ? `: ${changes.join(', ')}` : ''}`;
    }
    case 'anonymized':
      return 'Datos personales del cliente eliminados a petición';
  }
}
