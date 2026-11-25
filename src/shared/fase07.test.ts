import { describe, expect, it } from 'vitest';
import {
  buildAnswersSchema,
  compilePattern,
  defaultAnswers,
  editorToRow,
  emptyFieldEditor,
  fieldEditorSchema,
  fieldsForService,
  fieldToEditor,
  formatAnswer,
  isValidDay,
  optionValue,
  parseOptions,
  parseValidation,
  toAnswerRows,
  toBookingField,
  type BookingField,
  type FieldType,
} from './booking-fields';

let seq = 0;
function field(type: FieldType, over: Partial<BookingField> = {}): BookingField {
  seq++;
  return {
    id: `f${seq}`,
    service_id: null,
    label: `Campo ${seq}`,
    help_text: null,
    placeholder: null,
    type,
    options: [],
    required: false,
    validation: {},
    is_active: true,
    sort_order: seq,
    ...over,
  };
}

const PRESION = [
  { value: 'suave', label: 'Suave' },
  { value: 'media', label: 'Media' },
  { value: 'fuerte', label: 'Fuerte' },
];

/** Valida un solo campo y devuelve el valor de salida o el primer mensaje de error. */
function check(f: BookingField, value: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const result = buildAnswersSchema([f]).safeParse({ [f.id]: value });
  if (result.success) return { ok: true, value: result.data[f.id] };
  return { ok: false, message: result.error.issues[0]?.message ?? '' };
}

describe('texto (text / textarea)', () => {
  it('obligatorio: vacío o solo espacios falla; recorta espacios', () => {
    const f = field('text', { required: true });
    expect(check(f, '')).toEqual({ ok: false, message: 'Este dato es obligatorio' });
    expect(check(f, undefined)).toEqual({ ok: false, message: 'Este dato es obligatorio' });
    expect(check(f, '  Ana  ')).toEqual({ ok: true, value: 'Ana' });
  });

  it('opcional vacío → undefined (no se guarda)', () => {
    expect(check(field('textarea'), '')).toEqual({ ok: true, value: undefined });
  });

  it('respeta minLength y maxLength', () => {
    const f = field('text', { validation: { minLength: 3, maxLength: 5 } });
    expect(check(f, 'ab')).toEqual({ ok: false, message: 'Mínimo 3 caracteres' });
    expect(check(f, 'abcdef')).toEqual({ ok: false, message: 'Máximo 5 caracteres' });
    expect(check(f, 'abcd').ok).toBe(true);
  });

  it('aplica un tope aunque la empresa no ponga máximo (o ponga uno mayor)', () => {
    expect(check(field('text'), 'x'.repeat(501)).ok).toBe(false);
    expect(check(field('text', { validation: { maxLength: 9999 } }), 'x'.repeat(501)).ok).toBe(false);
    expect(check(field('textarea'), 'x'.repeat(5000)).ok).toBe(true);
  });

  it('patrón: debe cubrir todo el valor; mensaje propio o genérico', () => {
    const f = field('text', { validation: { pattern: '[0-9]+', patternMessage: 'Solo números' } });
    expect(check(f, '12a')).toEqual({ ok: false, message: 'Solo números' });
    expect(check(f, '123').ok).toBe(true);
    expect(check(field('text', { validation: { pattern: '[a-z]+' } }), 'A')).toEqual({
      ok: false,
      message: 'El formato no es válido',
    });
    // Un opcional vacío no se compara con el patrón.
    expect(check(f, '').ok).toBe(true);
  });

  it('un valor que no es texto falla', () => {
    expect(check(field('text', { required: true }), 12).ok).toBe(false);
  });
});

describe('listas de una opción (select / radio)', () => {
  it('rechaza una opción inexistente', () => {
    const f = field('radio', { options: PRESION, required: true });
    expect(check(f, 'extrema')).toEqual({ ok: false, message: 'Elige una opción de la lista' });
    expect(check(f, 'media')).toEqual({ ok: true, value: 'media' });
  });

  it('obligatoria sin elegir falla; opcional sin elegir → undefined', () => {
    expect(check(field('select', { options: PRESION, required: true }), '').ok).toBe(false);
    expect(check(field('select', { options: PRESION }), '')).toEqual({ ok: true, value: undefined });
  });
});

describe('lista de varias (multiselect)', () => {
  const opts = [
    { value: 'espalda', label: 'Espalda' },
    { value: 'cuello', label: 'Cuello' },
    { value: 'piernas', label: 'Piernas' },
  ];

  it('rechaza opciones inexistentes o repetidas', () => {
    const f = field('multiselect', { options: opts });
    expect(check(f, ['espalda', 'brazos'])).toEqual({ ok: false, message: 'Elige opciones de la lista' });
    expect(check(f, ['cuello', 'cuello'])).toEqual({ ok: false, message: 'Hay opciones repetidas' });
    expect(check(f, 'cuello').ok).toBe(false);
  });

  it('obligatoria exige al menos una; opcional acepta ninguna', () => {
    expect(check(field('multiselect', { options: opts, required: true }), [])).toEqual({
      ok: false,
      message: 'Elige al menos una opción',
    });
    expect(check(field('multiselect', { options: opts }), undefined)).toEqual({ ok: true, value: [] });
  });

  it('min y max de opciones marcadas', () => {
    const f = field('multiselect', { options: opts, validation: { min: 2, max: 2 } });
    expect(check(f, ['cuello'])).toEqual({ ok: false, message: 'Elige al menos 2' });
    expect(check(f, ['cuello', 'espalda', 'piernas'])).toEqual({ ok: false, message: 'Elige como máximo 2' });
    expect(check(f, ['cuello', 'espalda']).ok).toBe(true);
  });
});

describe('check', () => {
  it('obligatorio = debe estar marcado', () => {
    const f = field('checkbox', { required: true, label: 'Acepto políticas' });
    expect(check(f, false)).toEqual({ ok: false, message: 'Debes marcar esta casilla' });
    expect(check(f, undefined).ok).toBe(false);
    expect(check(f, true)).toEqual({ ok: true, value: true });
  });

  it('opcional: sin marcar = false', () => {
    expect(check(field('checkbox'), undefined)).toEqual({ ok: true, value: false });
    expect(check(field('checkbox'), 'si').ok).toBe(false);
  });
});

describe('número', () => {
  it('convierte texto, respeta min/max y acepta coma decimal', () => {
    const f = field('number', { validation: { min: 1, max: 10 }, required: true });
    expect(check(f, '3')).toEqual({ ok: true, value: 3 });
    expect(check(f, '2,5')).toEqual({ ok: true, value: 2.5 });
    expect(check(f, 0)).toEqual({ ok: false, message: 'Mínimo 1' });
    expect(check(f, '11')).toEqual({ ok: false, message: 'Máximo 10' });
  });

  it('obligatorio vacío vs. texto que no es número', () => {
    const f = field('number', { required: true });
    expect(check(f, '')).toEqual({ ok: false, message: 'Este dato es obligatorio' });
    expect(check(f, 'abc')).toEqual({ ok: false, message: 'Escribe un número' });
    expect(check(field('number'), '')).toEqual({ ok: true, value: undefined });
  });
});

describe('fecha', () => {
  it('formato YYYY-MM-DD y fecha real', () => {
    const f = field('date', { required: true });
    expect(check(f, '2026-02-29')).toEqual({ ok: false, message: 'Fecha no válida' });
    expect(check(f, '29/02/2028').ok).toBe(false);
    expect(check(f, '2028-02-29')).toEqual({ ok: true, value: '2028-02-29' });
    expect(check(f, '')).toEqual({ ok: false, message: 'Este dato es obligatorio' });
    expect(check(field('date'), '')).toEqual({ ok: true, value: undefined });
    expect(isValidDay('2026-13-01')).toBe(false);
  });
});

describe('buildAnswersSchema con varios campos', () => {
  it('descarta claves desconocidas y valida cada campo', () => {
    const a = field('text', { required: true });
    const b = field('checkbox', { required: true });
    const schema = buildAnswersSchema([a, b]);
    const ok = schema.safeParse({ [a.id]: 'hola', [b.id]: true, intruso: 'x' });
    expect(ok.success && ok.data).toEqual({ [a.id]: 'hola', [b.id]: true });
    const bad = schema.safeParse({ [a.id]: '', [b.id]: false });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.path[0])).toEqual([a.id, b.id]);
  });
});

describe('fieldsForService', () => {
  const g1 = field('text', { sort_order: 2 });
  const g2 = field('checkbox', { sort_order: 1 });
  const gOff = field('text', { is_active: false });
  const s1 = field('radio', { service_id: 'masaje', sort_order: 5 });
  const s2 = field('multiselect', { service_id: 'masaje', sort_order: 3 });
  const other = field('text', { service_id: 'facial' });
  const all = [s1, g1, other, gOff, s2, g2];

  it('generales primero, luego los del servicio; cada grupo por sort_order; solo activos', () => {
    expect(fieldsForService(all, 'masaje').map((f) => f.id)).toEqual([g2.id, g1.id, s2.id, s1.id]);
  });

  it('un servicio sin campos propios muestra solo los generales', () => {
    expect(fieldsForService(all, 'corte').map((f) => f.id)).toEqual([g2.id, g1.id]);
    expect(fieldsForService(all, null).map((f) => f.id)).toEqual([g2.id, g1.id]);
  });
});

describe('opciones con value estable', () => {
  it('se genera del texto, sin tildes, y único', () => {
    expect(optionValue('Presión fuerte', [])).toBe('presion-fuerte');
    expect(optionValue('Sí', ['si'])).toBe('si-2');
    expect(optionValue('Sí', ['si', 'si-2'])).toBe('si-3');
    expect(optionValue('¡¿?!', [])).toBe('opcion');
  });

  it('renombrar una opción no rompe respuestas guardadas', () => {
    const opts = [{ value: 'suave', label: 'Suave' }];
    const renamed = [{ value: 'suave', label: 'Muy suave' }];
    const f = field('radio', { options: renamed, required: true });
    // La respuesta guardada sigue siendo válida y se muestra con el texto nuevo.
    expect(check(f, 'suave').ok).toBe(true);
    expect(formatAnswer({ type: 'radio', value: 'suave' }, renamed)).toBe('Muy suave');
    expect(formatAnswer({ type: 'radio', value: 'suave' }, opts)).toBe('Suave');
    // Si la opción se borró, se muestra el value guardado.
    expect(formatAnswer({ type: 'radio', value: 'suave' }, [])).toBe('suave');
  });
});

describe('formatAnswer', () => {
  it('formatea cada tipo', () => {
    expect(formatAnswer({ type: 'checkbox', value: true })).toBe('Sí');
    expect(formatAnswer({ type: 'checkbox', value: false })).toBe('No');
    expect(formatAnswer({ type: 'multiselect', value: ['a', 'b'] }, [{ value: 'a', label: 'A' }])).toBe('A, b');
    expect(formatAnswer({ type: 'multiselect', value: 'x' })).toBe('x');
    expect(formatAnswer({ type: 'date', value: '2026-11-30' })).toBe('30/11/2026');
    expect(formatAnswer({ type: 'date', value: 'raro' })).toBe('raro');
    expect(formatAnswer({ type: 'number', value: 3 })).toBe('3');
    expect(formatAnswer({ type: 'text', value: 'hola' })).toBe('hola');
  });
});

describe('respuestas → filas', () => {
  it('defaultAnswers y toAnswerRows (sin vacíos, con copia de label y type)', () => {
    const t = field('text');
    const m = field('multiselect', { options: PRESION });
    const c = field('checkbox');
    expect(defaultAnswers([t, m, c])).toEqual({ [t.id]: '', [m.id]: [], [c.id]: false });
    expect(toAnswerRows([t, m, c], { [t.id]: undefined, [m.id]: [], [c.id]: false })).toEqual([
      { field_id: c.id, label: c.label, type: 'checkbox', value: false },
    ]);
  });
});

describe('lectura de jsonb', () => {
  it('parseOptions y parseValidation ignoran basura', () => {
    expect(parseOptions([{ value: 'a', label: 'A' }, { value: 1 }, null, 'x'])).toEqual([{ value: 'a', label: 'A' }]);
    expect(parseOptions('nada')).toEqual([]);
    expect(parseValidation({ maxLength: 5, min: 'x', pattern: '', patternMessage: 'm', extra: 1 })).toEqual({
      maxLength: 5,
      patternMessage: 'm',
    });
    expect(parseValidation([])).toEqual({});
    expect(toBookingField({ ...field('text'), options: null, validation: null }).options).toEqual([]);
  });

  it('compilePattern: inválido → null', () => {
    expect(compilePattern('(')).toBeNull();
    expect(compilePattern(undefined)).toBeNull();
    expect(compilePattern('a|b')?.test('ab')).toBe(false);
  });
});

describe('editor de campos', () => {
  it('lista sin opciones u opciones repetidas no se guarda', () => {
    const base = { ...emptyFieldEditor('radio'), label: 'Presión' };
    expect(fieldEditorSchema.safeParse(base).success).toBe(false);
    const dup = fieldEditorSchema.safeParse({
      ...base,
      options: [
        { value: 'a', label: 'Suave' },
        { value: 'b', label: 'suave ' },
      ],
    });
    expect(dup.success).toBe(false);
  });

  it('patrón inválido, min > max y multiselect con decimales se rechazan', () => {
    const text = { ...emptyFieldEditor('text'), label: 'Placa' };
    expect(fieldEditorSchema.safeParse({ ...text, pattern: '(' }).success).toBe(false);
    expect(fieldEditorSchema.safeParse({ ...text, minLength: '5', maxLength: '2' }).success).toBe(false);
    const num = { ...emptyFieldEditor('number'), label: 'Edad' };
    expect(fieldEditorSchema.safeParse({ ...num, min: '10', max: '1' }).success).toBe(false);
    const multi = { ...emptyFieldEditor('multiselect'), label: 'Zonas', options: [{ value: 'a', label: 'A' }] };
    expect(fieldEditorSchema.safeParse({ ...multi, max: '1.5' }).success).toBe(false);
  });

  it('editorToRow guarda solo lo que aplica al tipo; ida y vuelta con fieldToEditor', () => {
    const parsed = fieldEditorSchema.parse({
      ...emptyFieldEditor('checkbox'),
      label: ' Acepto políticas ',
      placeholder: 'no aplica',
      maxLength: '10',
      options: [{ value: 'x', label: 'X' }],
    });
    expect(editorToRow(parsed)).toEqual({
      type: 'checkbox',
      label: 'Acepto políticas',
      help_text: null,
      placeholder: null,
      required: true,
      is_active: true,
      options: [],
      validation: {},
    });

    const text = fieldEditorSchema.parse({
      ...emptyFieldEditor('text'),
      label: 'Código',
      maxLength: '6',
      pattern: '[0-9]+',
      patternMessage: 'Solo números',
    });
    const row = editorToRow(text);
    expect(row.validation).toEqual({ maxLength: 6, pattern: '[0-9]+', patternMessage: 'Solo números' });
    const back = fieldToEditor(toBookingField({ ...field('text'), ...row }));
    expect(back).toMatchObject({ label: 'Código', maxLength: '6', minLength: '', pattern: '[0-9]+' });

    const multi = editorToRow(
      fieldEditorSchema.parse({
        ...emptyFieldEditor('multiselect'),
        label: 'Zonas',
        options: [{ value: 'cuello', label: ' Cuello ' }],
        min: '1',
        max: '2',
      }),
    );
    expect(multi).toMatchObject({ options: [{ value: 'cuello', label: 'Cuello' }], validation: { min: 1, max: 2 } });
  });
});
