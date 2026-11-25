/**
 * Fase 06: ficha de servicios y productos (formulario ↔ payload de `upsert_catalog_item`).
 * TS puro: lo usan el panel y los tests.
 */
import { TZDate } from '@date-fns/tz';
import { z } from 'zod';

export type CatalogKind = 'service' | 'product';

export const KIND_LABELS: Record<CatalogKind, { one: string; many: string; path: string }> = {
  service: { one: 'servicio', many: 'Servicios', path: 'servicios' },
  product: { one: 'producto', many: 'Productos', path: 'productos' },
};

export const MAX_PHOTOS = 8;
export const MAX_DETAILS = 30;
export const MAX_DISCOUNTS = 20;
export const MAX_PRICE = 9_999_999_999.99;

// ---------------------------------------------------------------------------
// Fechas de los descuentos: el usuario elige días en la zona de la empresa; se guardan como
// instantes (inicio = 00:00, fecha límite = 23:59:59.999 de ese día).
// ---------------------------------------------------------------------------

const DAY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(day: string): [number, number, number] {
  const m = DAY_REGEX.exec(day);
  if (!m) throw new Error(`Fecha no válida: ${day}`);
  return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
}

export function dayStartIso(day: string, timeZone: string): string {
  const [y, mo, d] = parseDay(day);
  return new Date(new TZDate(y, mo, d, 0, 0, 0, 0, timeZone).getTime()).toISOString();
}

export function dayEndIso(day: string, timeZone: string): string {
  const [y, mo, d] = parseDay(day);
  return new Date(new TZDate(y, mo, d, 23, 59, 59, 999, timeZone).getTime()).toISOString();
}

/** Instante → 'yyyy-mm-dd' en la zona dada (para los `<input type="date">`). */
export function isoToDay(iso: string, timeZone: string): string {
  const d = new TZDate(new Date(iso).getTime(), timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Utilidades de esquema
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres` })
    .transform((v) => (v === '' ? null : v))
    .nullable();

const blankToUndefined = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : Number(v));
const blankToNull = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));

const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

/** Dinero obligatorio (≥ 0, máx. 2 decimales). Los `<input type="number">` entregan texto. */
const money = (required: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .number({ error: required })
      .min(0, { error: 'No puede ser negativo' })
      .max(MAX_PRICE, { error: 'Monto demasiado alto' })
      .refine(twoDecimals, { error: 'Máximo 2 decimales' }),
  );

const optionalMoney = z.preprocess(
  blankToNull,
  z
    .number({ error: 'Escribe un número' })
    .min(0, { error: 'No puede ser negativo' })
    .max(MAX_PRICE, { error: 'Monto demasiado alto' })
    .refine(twoDecimals, { error: 'Máximo 2 decimales' })
    .nullable(),
);

const int = (min: number, max: number, required: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .number({ error: required })
      .int({ error: 'Debe ser un número entero' })
      .min(min, { error: `Mínimo ${min}` })
      .max(max, { error: `Máximo ${max}` }),
  );

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    blankToNull,
    z
      .number({ error: 'Escribe un número' })
      .int({ error: 'Debe ser un número entero' })
      .min(min, { error: `Mínimo ${min}` })
      .max(max, { error: `Máximo ${max}` })
      .nullable(),
  );

// ---------------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------------

export const detailSchema = z.object({
  label: z.string().trim().min(1, { error: 'Escribe el detalle' }).max(160, { error: 'Máximo 160 caracteres' }),
  value: optionalText(160),
});

export const photoSchema = z.object({
  path: z.string().min(1),
  alt: z
    .string()
    .trim()
    .min(1, { error: 'Describe la foto (lo leen los lectores de pantalla)' })
    .max(160, { error: 'Máximo 160 caracteres' }),
  is_cover: z.boolean(),
});

export const discountFormSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().trim().max(60, { error: 'Máximo 60 caracteres' }),
    type: z.enum(['percent', 'fixed']),
    value: z.preprocess(
      blankToUndefined,
      z
        .number({ error: 'Escribe el valor' })
        .gt(0, { error: 'Debe ser mayor que 0' })
        .max(MAX_PRICE, { error: 'Valor demasiado alto' })
        .refine(twoDecimals, { error: 'Máximo 2 decimales' }),
    ),
    starts_on: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/, { error: 'Fecha no válida' }),
    ends_on: z.string().regex(DAY_REGEX, { error: 'Elige la fecha límite' }),
    branch_id: z.string().nullable(),
    is_active: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (d.type === 'percent' && d.value > 100) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Máximo 100 %' });
    }
    if (d.starts_on && d.ends_on && d.starts_on > d.ends_on) {
      ctx.addIssue({ code: 'custom', path: ['ends_on'], message: 'Debe ser igual o posterior al inicio' });
    }
  });

export const serviceProductSchema = z.object({
  product_id: z.string().min(1),
  max_quantity: int(1, 999, 'Escribe la cantidad máxima'),
});

export const branchAvailabilitySchema = z.object({
  branch_id: z.string().min(1),
  is_active: z.boolean(),
  price_override: optionalMoney,
});

export const catalogItemSchema = z
  .object({
    kind: z.enum(['service', 'product']),
    name: z.string().trim().min(1, { error: 'Escribe el nombre' }).max(160, { error: 'Máximo 160 caracteres' }),
    reference: optionalText(60),
    short_description: optionalText(200),
    description: optionalText(5000),
    price: money('Escribe el precio'),
    is_active: z.boolean(),
    is_featured: z.boolean(),
    // Servicios
    duration_minutes: optionalInt(1, 24 * 60),
    buffer_before_minutes: int(0, 24 * 60, 'Escribe los minutos (0 si no hay)'),
    buffer_after_minutes: int(0, 24 * 60, 'Escribe los minutos (0 si no hay)'),
    capacity: int(1, 1000, 'Escribe la capacidad'),
    // Productos
    allow_in_booking: z.boolean(),
    stock: optionalInt(0, 1_000_000),
    details: z.array(detailSchema).max(MAX_DETAILS, { error: `Máximo ${MAX_DETAILS} detalles` }),
    photos: z.array(photoSchema).max(MAX_PHOTOS, { error: `Máximo ${MAX_PHOTOS} fotos` }),
    discounts: z.array(discountFormSchema).max(MAX_DISCOUNTS, { error: `Máximo ${MAX_DISCOUNTS} descuentos` }),
    products: z.array(serviceProductSchema),
    branches: z.array(branchAvailabilitySchema),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'service' && v.duration_minutes === null) {
      ctx.addIssue({ code: 'custom', path: ['duration_minutes'], message: 'Escribe la duración' });
    }
  });

export type CatalogItemInput = z.input<typeof catalogItemSchema>;
export type CatalogItemValues = z.output<typeof catalogItemSchema>;
export type DiscountFormValues = z.output<typeof discountFormSchema>;

export function emptyCatalogItem(kind: CatalogKind): CatalogItemInput {
  return {
    kind,
    name: '',
    reference: '',
    short_description: '',
    description: '',
    price: '',
    is_active: true,
    is_featured: false,
    duration_minutes: kind === 'service' ? 30 : '',
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    capacity: 1,
    allow_in_booking: kind === 'product',
    stock: '',
    details: [],
    photos: [],
    discounts: [],
    products: [],
    branches: [],
  };
}

/** Fila de la BD (con sus listas) tal como la devuelve el select de la ficha. */
export interface CatalogRecord {
  id: string;
  kind: CatalogKind;
  name: string;
  reference: string | null;
  short_description: string | null;
  description: string | null;
  price: number;
  is_active: boolean;
  is_featured: boolean;
  duration_minutes: number | null;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  capacity: number;
  allow_in_booking: boolean;
  stock: number | null;
  details: { label: string; value: string | null; sort_order: number }[];
  photos: { path: string; alt: string | null; is_cover: boolean; sort_order: number }[];
  discounts: {
    id: string;
    label: string;
    type: 'percent' | 'fixed';
    value: number;
    starts_at: string | null;
    ends_at: string;
    branch_id: string | null;
    is_active: boolean;
  }[];
  products: { product_id: string; max_quantity: number; sort_order: number }[];
  branches: { branch_id: string; is_active: boolean; price_override: number | null }[];
}

const bySort = <T extends { sort_order: number }>(rows: T[]) => [...rows].sort((a, b) => a.sort_order - b.sort_order);

/** BD → valores del formulario. */
export function recordToForm(record: CatalogRecord, timeZone: string): CatalogItemInput {
  return {
    kind: record.kind,
    name: record.name,
    reference: record.reference ?? '',
    short_description: record.short_description ?? '',
    description: record.description ?? '',
    price: String(record.price),
    is_active: record.is_active,
    is_featured: record.is_featured,
    duration_minutes: record.duration_minutes === null ? '' : String(record.duration_minutes),
    buffer_before_minutes: String(record.buffer_before_minutes),
    buffer_after_minutes: String(record.buffer_after_minutes),
    capacity: String(record.capacity),
    allow_in_booking: record.allow_in_booking,
    stock: record.stock === null ? '' : String(record.stock),
    details: bySort(record.details).map((d) => ({ label: d.label, value: d.value ?? '' })),
    photos: bySort(record.photos).map((p) => ({ path: p.path, alt: p.alt ?? '', is_cover: p.is_cover })),
    discounts: [...record.discounts]
      .sort((a, b) => a.ends_at.localeCompare(b.ends_at))
      .map((d) => ({
        id: d.id,
        label: d.label,
        type: d.type,
        value: String(d.value),
        starts_on: d.starts_at ? isoToDay(d.starts_at, timeZone) : '',
        ends_on: isoToDay(d.ends_at, timeZone),
        branch_id: d.branch_id,
        is_active: d.is_active,
      })),
    products: bySort(record.products).map((p) => ({ product_id: p.product_id, max_quantity: String(p.max_quantity) })),
    branches: record.branches.map((b) => ({
      branch_id: b.branch_id,
      is_active: b.is_active,
      price_override: b.price_override === null ? '' : String(b.price_override),
    })),
  };
}

export function discountToRow(d: DiscountFormValues, timeZone: string) {
  return {
    ...(d.id ? { id: d.id } : {}),
    label: d.label,
    type: d.type,
    value: d.value,
    starts_at: d.starts_on ? dayStartIso(d.starts_on, timeZone) : null,
    ends_at: dayEndIso(d.ends_on, timeZone),
    branch_id: d.branch_id,
    is_active: d.is_active,
  };
}

/**
 * Valores validados → payload de `upsert_catalog_item`. Los campos que no aplican al tipo se
 * normalizan (los CHECK de la tabla los exigen). La portada: la marcada o, si no, la primera.
 * `thumbPathOf` calcula la miniatura de cada foto (ver content.ts).
 */
export function toCatalogPayload(
  values: CatalogItemValues,
  options: { id?: string | undefined; companyId: string; timeZone: string; thumbPathOf: (path: string) => string },
) {
  const service = values.kind === 'service';
  const coverIndex = Math.max(
    0,
    values.photos.findIndex((p) => p.is_cover),
  );
  return {
    ...(options.id ? { id: options.id } : { company_id: options.companyId, kind: values.kind }),
    name: values.name,
    reference: values.reference,
    short_description: values.short_description,
    description: values.description,
    price: values.price,
    is_active: values.is_active,
    is_featured: values.is_featured,
    duration_minutes: service ? values.duration_minutes : null,
    buffer_before_minutes: service ? values.buffer_before_minutes : 0,
    buffer_after_minutes: service ? values.buffer_after_minutes : 0,
    capacity: service ? values.capacity : 1,
    allow_in_booking: service ? false : values.allow_in_booking,
    stock: service ? null : values.stock,
    details: values.details,
    photos: values.photos.map((p, i) => ({
      path: p.path,
      thumb_path: options.thumbPathOf(p.path),
      alt: p.alt,
      is_cover: i === coverIndex,
    })),
    discounts: values.discounts.map((d) => discountToRow(d, options.timeZone)),
    ...(service ? { products: values.products } : {}),
    branches: values.branches,
  };
}

export type CatalogPayload = ReturnType<typeof toCatalogPayload>;

/** Nombre de la copia al duplicar ("Corte" → "Corte (copia)"), dentro del máximo de 160. */
export function copyName(name: string): string {
  const suffix = ' (copia)';
  return name.slice(0, 160 - suffix.length) + suffix;
}

/** Duración legible: 90 → "1 h 30 min". */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
