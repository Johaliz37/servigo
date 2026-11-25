/**
 * Fase 07: información adicional que el cliente diligencia al reservar. TS puro: lo usan el
 * constructor del panel, el formulario público (fase 10) y el detalle de reservas (fase 11).
 *
 * La BD (trigger `booking_fields_validate`) garantiza la forma de `options` y `validation`;
 * `create_booking` (fase 10) debe validar las respuestas con las mismas reglas que
 * `buildAnswersSchema`.
 */
import { z } from 'zod';
import { slugify } from './format';

export type FieldType = 'text' | 'textarea' | 'select' | 'multiselect' | 'radio' | 'checkbox' | 'number' | 'date';

export const FIELD_TYPES: readonly FieldType[] = [
  'text',
  'textarea',
  'select',
  'multiselect',
  'radio',
  'checkbox',
  'number',
  'date',
];

export const FIELD_TYPE_INFO: Record<FieldType, { label: string; description: string }> = {
  text: { label: 'Texto corto', description: 'Una línea: nombre, placa, referencia…' },
  textarea: { label: 'Texto libre', description: 'Un párrafo: comentarios, indicaciones…' },
  select: { label: 'Lista de ítems (una)', description: 'Lista desplegable; el cliente elige una opción.' },
  multiselect: { label: 'Lista de ítems (varias)', description: 'El cliente marca una o varias opciones.' },
  radio: { label: 'Lista de opciones', description: 'Opciones visibles; el cliente elige una.' },
  checkbox: { label: 'Check', description: 'Sí/no, por ejemplo «Acepto las políticas».' },
  number: { label: 'Número', description: 'Edad, cantidad de personas…' },
  date: { label: 'Fecha', description: 'Fecha de nacimiento, de un evento…' },
};

export const LIST_TYPES: readonly FieldType[] = ['select', 'multiselect', 'radio'];
export const TEXT_TYPES: readonly FieldType[] = ['text', 'textarea'];
export const isListType = (t: FieldType) => LIST_TYPES.includes(t);

/** Topes que siempre aplican aunque la empresa no ponga máximo. */
export const TEXT_HARD_MAX: Record<'text' | 'textarea', number> = { text: 500, textarea: 5000 };
export const MAX_OPTIONS = 50;

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  patternMessage?: string;
  /** Número: valor. Multiselect: cantidad de opciones marcadas. */
  min?: number;
  max?: number;
}

export interface BookingField {
  id: string;
  service_id: string | null;
  label: string;
  help_text: string | null;
  placeholder: string | null;
  type: FieldType;
  options: FieldOption[];
  required: boolean;
  validation: FieldValidation;
  is_active: boolean;
  sort_order: number;
}

/** Respuesta guardada en `booking_answers` (copia de label y type). */
export interface FieldAnswer {
  field_id: string | null;
  label: string;
  type: FieldType;
  value: AnswerValue;
}

export type AnswerValue = string | number | boolean | string[];

// ---------------------------------------------------------------------------
// Lectura defensiva de las columnas jsonb
// ---------------------------------------------------------------------------

export function parseOptions(json: unknown): FieldOption[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((o) =>
    o && typeof o === 'object' && typeof o.value === 'string' && typeof o.label === 'string'
      ? [{ value: o.value, label: o.label }]
      : [],
  );
}

export function parseValidation(json: unknown): FieldValidation {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  const v = json as Record<string, unknown>;
  const out: FieldValidation = {};
  for (const key of ['minLength', 'maxLength', 'min', 'max'] as const) {
    if (typeof v[key] === 'number' && Number.isFinite(v[key])) out[key] = v[key];
  }
  if (typeof v.pattern === 'string' && v.pattern) out.pattern = v.pattern;
  if (typeof v.patternMessage === 'string' && v.patternMessage) out.patternMessage = v.patternMessage;
  return out;
}

/** Fila de la BD → BookingField. */
export function toBookingField(row: {
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
}): BookingField {
  return { ...row, options: parseOptions(row.options), validation: parseValidation(row.validation) };
}

/** RegExp del patrón, o null si no compila (la UI no deja guardar uno inválido). */
export function compilePattern(pattern: string | undefined): RegExp | null {
  if (!pattern) return null;
  try {
    // `u` para que «\p{L}» y similares funcionen; el patrón debe cubrir todo el valor.
    return new RegExp(`^(?:${pattern})$`, 'u');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Opciones: value estable
// ---------------------------------------------------------------------------

/**
 * Valor para una opción nueva a partir de su texto, único entre los existentes. Se fija al
 * crear la opción y **no** cambia al renombrarla: las respuestas guardan el value.
 */
export function optionValue(label: string, existing: readonly string[]): string {
  const base = slugify(label, 56) || 'opcion';
  let value = base;
  for (let i = 2; existing.includes(value); i++) value = `${base}-${i}`;
  return value;
}

// ---------------------------------------------------------------------------
// Qué campos se piden
// ---------------------------------------------------------------------------

/** Generales + los del servicio, solo activos: primero los generales, cada grupo por `sort_order`. */
export function fieldsForService<F extends Pick<BookingField, 'service_id' | 'is_active' | 'sort_order'>>(
  all: readonly F[],
  serviceId: string | null,
): F[] {
  const bySort = (a: F, b: F) => a.sort_order - b.sort_order;
  const general = all.filter((f) => f.is_active && f.service_id === null).sort(bySort);
  const own = serviceId ? all.filter((f) => f.is_active && f.service_id === serviceId).sort(bySort) : [];
  return [...general, ...own];
}

// ---------------------------------------------------------------------------
// Validación de respuestas
// ---------------------------------------------------------------------------

const REQUIRED = 'Este dato es obligatorio';
const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDay(value: string): boolean {
  const m = DATE_REGEX.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const emptyToUndefined = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);

function textSchema(field: BookingField) {
  const hardMax = TEXT_HARD_MAX[field.type as 'text' | 'textarea'];
  const max = Math.min(field.validation.maxLength ?? hardMax, hardMax);
  const pattern = compilePattern(field.validation.pattern);
  let s = z
    .string({ error: REQUIRED })
    .trim()
    .max(max, { error: `Máximo ${max} caracteres` });
  if (field.validation.minLength) {
    const min = field.validation.minLength;
    s = s.min(min, { error: `Mínimo ${min} caracteres` });
  }
  if (pattern) s = s.regex(pattern, { error: field.validation.patternMessage || 'El formato no es válido' });
  return field.required ? z.preprocess(emptyToUndefined, s) : z.preprocess(emptyToUndefined, s.optional());
}

function choiceSchema(field: BookingField) {
  const values = field.options.map((o) => o.value);
  const s = z.string({ error: REQUIRED }).refine((v) => values.includes(v), { error: 'Elige una opción de la lista' });
  return field.required ? z.preprocess(emptyToUndefined, s) : z.preprocess(emptyToUndefined, s.optional());
}

function multiSchema(field: BookingField) {
  const values = field.options.map((o) => o.value);
  const { min, max } = field.validation;
  return z
    .array(z.string(), { error: 'Elige opciones de la lista' })
    .default([])
    .superRefine((list, ctx) => {
      if (list.some((v) => !values.includes(v))) {
        ctx.addIssue({ code: 'custom', message: 'Elige opciones de la lista' });
      } else if (new Set(list).size !== list.length) {
        ctx.addIssue({ code: 'custom', message: 'Hay opciones repetidas' });
      } else if (field.required && list.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'Elige al menos una opción' });
      } else if (list.length > 0 && min !== undefined && list.length < min) {
        ctx.addIssue({ code: 'custom', message: `Elige al menos ${min}` });
      } else if (max !== undefined && list.length > max) {
        ctx.addIssue({ code: 'custom', message: `Elige como máximo ${max}` });
      }
    });
}

function checkboxSchema(field: BookingField) {
  const s = z.boolean({ error: 'Valor no válido' }).default(false);
  return field.required ? s.refine((v) => v, { error: 'Debes marcar esta casilla' }) : s;
}

function numberSchema(field: BookingField) {
  const { min, max } = field.validation;
  // Vacío → "obligatorio"; texto que no es número → "escribe un número".
  let s = z.number({ error: (iss) => (iss.input === undefined ? REQUIRED : 'Escribe un número') });
  if (min !== undefined) s = s.min(min, { error: `Mínimo ${min}` });
  if (max !== undefined) s = s.max(max, { error: `Máximo ${max}` });
  const toNumber = (v: unknown) => {
    const e = emptyToUndefined(v);
    if (typeof e === 'string') return Number(e.replace(',', '.'));
    return e;
  };
  return field.required ? z.preprocess(toNumber, s) : z.preprocess(toNumber, s.optional());
}

function dateSchema(field: BookingField) {
  const s = z.string({ error: REQUIRED }).refine(isValidDay, { error: 'Fecha no válida' });
  return field.required ? z.preprocess(emptyToUndefined, s) : z.preprocess(emptyToUndefined, s.optional());
}

export function fieldSchema(field: BookingField): z.ZodType {
  switch (field.type) {
    case 'text':
    case 'textarea':
      return textSchema(field);
    case 'select':
    case 'radio':
      return choiceSchema(field);
    case 'multiselect':
      return multiSchema(field);
    case 'checkbox':
      return checkboxSchema(field);
    case 'number':
      return numberSchema(field);
    case 'date':
      return dateSchema(field);
  }
}

/**
 * Esquema Zod de las respuestas: un campo por id. Las claves desconocidas se descartan y
 * los opcionales vacíos quedan `undefined` (no se guardan).
 */
export function buildAnswersSchema(fields: readonly BookingField[]) {
  return z.object(Object.fromEntries(fields.map((f) => [f.id, fieldSchema(f)])));
}

export type Answers = Record<string, AnswerValue | undefined>;

/** Valores iniciales del formulario (los controles necesitan algo definido). */
export function defaultAnswers(fields: readonly BookingField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((f) => [f.id, f.type === 'multiselect' ? [] : f.type === 'checkbox' ? false : '']),
  );
}

/** Respuestas validadas → filas de `booking_answers` (copia de label y type; sin vacíos). */
export function toAnswerRows(fields: readonly BookingField[], answers: Answers): FieldAnswer[] {
  return fields.flatMap((f) => {
    const value = answers[f.id];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) return [];
    return [{ field_id: f.id, label: f.label, type: f.type, value }];
  });
}

// ---------------------------------------------------------------------------
// Mostrar respuestas
// ---------------------------------------------------------------------------

/**
 * Texto legible de una respuesta. Las opciones se buscan por value en el campo actual (así
 * renombrar una opción no rompe nada); si ya no existe, se muestra el value guardado.
 */
export function formatAnswer(
  answer: Pick<FieldAnswer, 'type' | 'value'>,
  options: readonly FieldOption[] = [],
): string {
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const { type, value } = answer;
  if (type === 'checkbox') return value === true ? 'Sí' : 'No';
  if (type === 'multiselect') return Array.isArray(value) ? value.map(labelOf).join(', ') : String(value);
  if (type === 'select' || type === 'radio') return labelOf(String(value));
  if (type === 'date' && typeof value === 'string') {
    const m = DATE_REGEX.exec(value);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Constructor (panel): esquema de un campo
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres` })
    .transform((v) => (v === '' ? null : v))
    .nullable();

const optionalInt = (min: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z
      .number({ error: 'Escribe un número' })
      .int({ error: 'Debe ser un número entero' })
      .min(min, { error: `Mínimo ${min}` })
      .optional(),
  );

const optionalNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
  z.number({ error: 'Escribe un número' }).optional(),
);

export const fieldEditorSchema = z
  .object({
    type: z.enum(FIELD_TYPES as [FieldType, ...FieldType[]]),
    label: z.string().trim().min(1, { error: 'Escribe la pregunta' }).max(200, { error: 'Máximo 200 caracteres' }),
    help_text: optionalText(300),
    placeholder: optionalText(120),
    required: z.boolean(),
    is_active: z.boolean(),
    options: z
      .array(
        z.object({
          value: z.string(),
          label: z.string().trim().min(1, { error: 'Escribe la opción' }).max(100, { error: 'Máximo 100 caracteres' }),
        }),
      )
      .max(MAX_OPTIONS, { error: `Máximo ${MAX_OPTIONS} opciones` }),
    minLength: optionalInt(0),
    maxLength: optionalInt(1),
    pattern: z.string().trim().max(200, { error: 'Máximo 200 caracteres' }),
    patternMessage: z.string().trim().max(120, { error: 'Máximo 120 caracteres' }),
    min: optionalNumber,
    max: optionalNumber,
  })
  .superRefine((v, ctx) => {
    if (isListType(v.type)) {
      if (v.options.length === 0)
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'Añade al menos una opción' });
      const labels = v.options.map((o) => o.label.trim().toLowerCase());
      labels.forEach((l, i) => {
        if (labels.indexOf(l) !== i) {
          ctx.addIssue({ code: 'custom', path: ['options', i, 'label'], message: 'Opción repetida' });
        }
      });
    }
    if (v.minLength !== undefined && v.maxLength !== undefined && v.minLength > v.maxLength) {
      ctx.addIssue({ code: 'custom', path: ['maxLength'], message: 'Debe ser mayor o igual al mínimo' });
    }
    if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
      ctx.addIssue({ code: 'custom', path: ['max'], message: 'Debe ser mayor o igual al mínimo' });
    }
    if (v.type === 'multiselect') {
      for (const key of ['min', 'max'] as const) {
        const n = v[key];
        if (n !== undefined && (!Number.isInteger(n) || n < 0)) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'Debe ser un entero ≥ 0' });
        }
      }
    }
    if (TEXT_TYPES.includes(v.type) && v.pattern && !compilePattern(v.pattern)) {
      ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'El patrón no es una expresión regular válida' });
    }
  });

export type FieldEditorInput = z.input<typeof fieldEditorSchema>;
export type FieldEditorValues = z.output<typeof fieldEditorSchema>;

export function emptyFieldEditor(type: FieldType): FieldEditorInput {
  return {
    type,
    label: '',
    help_text: '',
    placeholder: '',
    required: type === 'checkbox',
    is_active: true,
    options: [],
    minLength: '',
    maxLength: '',
    pattern: '',
    patternMessage: '',
    min: '',
    max: '',
  };
}

export function fieldToEditor(field: BookingField): FieldEditorInput {
  const v = field.validation;
  const s = (n: number | undefined) => (n === undefined ? '' : String(n));
  return {
    type: field.type,
    label: field.label,
    help_text: field.help_text ?? '',
    placeholder: field.placeholder ?? '',
    required: field.required,
    is_active: field.is_active,
    options: field.options,
    minLength: s(v.minLength),
    maxLength: s(v.maxLength),
    pattern: v.pattern ?? '',
    patternMessage: v.patternMessage ?? '',
    min: s(v.min),
    max: s(v.max),
  };
}

/** Valores del editor → columnas de `booking_fields` (solo lo que aplica al tipo). */
export function editorToRow(values: FieldEditorValues) {
  const validation: FieldValidation = {};
  if (TEXT_TYPES.includes(values.type)) {
    if (values.minLength !== undefined) validation.minLength = values.minLength;
    if (values.maxLength !== undefined) validation.maxLength = values.maxLength;
    if (values.pattern) validation.pattern = values.pattern;
    if (values.pattern && values.patternMessage) validation.patternMessage = values.patternMessage;
  }
  if (values.type === 'number' || values.type === 'multiselect') {
    if (values.min !== undefined) validation.min = values.min;
    if (values.max !== undefined) validation.max = values.max;
  }
  const usesPlaceholder = ['text', 'textarea', 'number', 'select'].includes(values.type);
  return {
    type: values.type,
    label: values.label,
    help_text: values.help_text,
    placeholder: usesPlaceholder ? values.placeholder : null,
    required: values.required,
    is_active: values.is_active,
    options: isListType(values.type) ? values.options.map((o) => ({ value: o.value, label: o.label.trim() })) : [],
    validation,
  };
}
