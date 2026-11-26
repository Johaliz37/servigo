import { describe, expect, it } from 'vitest';
import { describeEvent } from './booking-admin';
import {
  catalogItemSchema,
  copyName,
  dayEndIso,
  dayStartIso,
  discountFormSchema,
  emptyCatalogItem,
  formatDuration,
  isoToDay,
  recordToForm,
  toCatalogPayload,
  type CatalogRecord,
} from './catalog';
import { errorMessage, GENERIC_ERROR } from './errors';
import { consentLabel, isAnonymizedPhone, privacyTemplate } from './privacy';

describe('privacidad (D31)', () => {
  it('plantilla con los datos de la empresa y los derechos de la Ley 1581', () => {
    const text = privacyTemplate({ name: 'Spa Luna', email: 'hola@spa.co', phone: '+573001112233', address: null });
    expect(text).toContain('**Spa Luna**');
    expect(text).toContain('correo hola@spa.co, teléfono +573001112233');
    expect(text).toContain('Ley 1581 de 2012');
    expect(text).toContain('Superintendencia de Industria y Comercio');
    expect(text).toMatch(/10 días hábiles.*15 días hábiles/);
  });

  it('sin datos de contacto remite a los del sitio', () => {
    expect(privacyTemplate({ name: 'X', email: null, phone: null, address: null })).toContain(
      'los datos de contacto publicados en este sitio',
    );
  });

  it('casilla, marcador de anonimizado y evento del historial', () => {
    expect(consentLabel('Spa Luna')).toMatch(/^Autorizo a Spa Luna a tratar mis datos/);
    expect(isAnonymizedPhone('anon-0123')).toBe(true);
    expect(isAnonymizedPhone('+573001112233')).toBe(false);
    expect(isAnonymizedPhone(null)).toBe(false);
    expect(describeEvent({ action: 'anonymized', payload: {} }, String)).toMatch(/Datos personales/);
  });
});

describe('catálogo (fase 06)', () => {
  const tz = 'America/Bogota';

  it('días de descuento ↔ instantes en la zona de la empresa', () => {
    expect(dayStartIso('2026-12-01', tz)).toBe('2026-12-01T05:00:00.000Z');
    expect(dayEndIso('2026-12-01', tz)).toBe('2026-12-02T04:59:59.999Z');
    expect(isoToDay('2026-12-02T04:59:59.999Z', tz)).toBe('2026-12-01');
    expect(() => dayStartIso('01/12/2026', tz)).toThrow(/Fecha no válida/);
  });

  it('nombres de copia y duraciones legibles', () => {
    expect(copyName('Corte')).toBe('Corte (copia)');
    expect(copyName('x'.repeat(160))).toHaveLength(160);
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(90)).toBe('1 h 30 min');
  });

  it('esquema: servicio exige duración; dinero con 2 decimales; descuentos coherentes', () => {
    const service = { ...emptyCatalogItem('service'), name: 'Corte', price: '25000' };
    expect(catalogItemSchema.safeParse(service).success).toBe(true);
    expect(catalogItemSchema.safeParse({ ...service, duration_minutes: '' }).success).toBe(false);
    expect(catalogItemSchema.safeParse({ ...service, price: '10.555' }).success).toBe(false);
    expect(catalogItemSchema.safeParse({ ...service, price: '' }).success).toBe(false);
    const product = { ...emptyCatalogItem('product'), name: 'Cera', price: '10' };
    expect(catalogItemSchema.parse(product)).toMatchObject({ duration_minutes: null, stock: null });

    const discount = {
      label: '',
      type: 'percent',
      value: '150',
      starts_on: '2026-12-10',
      ends_on: '2026-12-01',
      branch_id: null,
      is_active: true,
    };
    const issues = discountFormSchema.safeParse(discount).error?.issues.map((i) => i.path.join('.'));
    expect(issues).toEqual(['value', 'ends_on']);
    expect(discountFormSchema.safeParse({ ...discount, value: '10', ends_on: '2026-12-31' }).success).toBe(true);
  });

  const record: CatalogRecord = {
    id: 'i1',
    kind: 'service',
    name: 'Corte',
    reference: null,
    short_description: 'Clásico',
    description: null,
    price: 25000,
    is_active: true,
    is_featured: false,
    duration_minutes: 30,
    buffer_before_minutes: 0,
    buffer_after_minutes: 5,
    capacity: 1,
    allow_in_booking: false,
    stock: null,
    details: [
      { label: 'B', value: null, sort_order: 2 },
      { label: 'A', value: 'x', sort_order: 1 },
    ],
    photos: [
      { path: 'p2.webp', alt: null, is_cover: true, sort_order: 2 },
      { path: 'p1.webp', alt: 'Uno', is_cover: false, sort_order: 1 },
    ],
    discounts: [
      {
        id: 'd1',
        label: 'Navidad',
        type: 'percent',
        value: 10,
        starts_at: null,
        ends_at: '2026-12-26T04:59:59.999Z',
        branch_id: null,
        is_active: true,
      },
    ],
    products: [{ product_id: 'p', max_quantity: 2, sort_order: 0 }],
    branches: [{ branch_id: 'b1', is_active: true, price_override: null }],
  };

  it('BD → formulario: ordena listas y pasa fechas a días', () => {
    const form = recordToForm(record, tz);
    expect(form.details.map((d) => d.label)).toEqual(['A', 'B']);
    expect(form.photos[0]).toEqual({ path: 'p1.webp', alt: 'Uno', is_cover: false });
    expect(form.discounts[0]).toMatchObject({ starts_on: '', ends_on: '2026-12-25', value: '10' });
    expect(form.branches[0]!.price_override).toBe('');
    expect(recordToForm({ ...record, duration_minutes: null, stock: 3 }, tz)).toMatchObject({
      duration_minutes: '',
      stock: '3',
    });
  });

  it('formulario → payload: normaliza por tipo, portada y miniaturas', () => {
    const form = recordToForm(record, tz);
    const values = catalogItemSchema.parse({
      ...form,
      photos: form.photos.map((p) => ({ ...p, alt: p.alt || 'Foto' })),
    });
    const opts = { companyId: 'c1', timeZone: tz, thumbPathOf: (p: string) => p.replace('.webp', '.thumb.webp') };
    const created = toCatalogPayload(values, opts);
    expect(created).toMatchObject({ company_id: 'c1', kind: 'service', capacity: 1, stock: null });
    expect(created.photos.map((p) => [p.thumb_path, p.is_cover])).toEqual([
      ['p1.thumb.webp', false],
      ['p2.thumb.webp', true],
    ]);
    expect(created.discounts[0]).toMatchObject({ id: 'd1', starts_at: null, ends_at: '2026-12-26T04:59:59.999Z' });
    expect('products' in created).toBe(true);

    const product = catalogItemSchema.parse({
      ...recordToForm({ ...record, kind: 'product', allow_in_booking: true, stock: 4 }, tz),
      photos: [{ path: 'a.webp', alt: 'A', is_cover: false }],
      discounts: [{ ...recordToForm(record, tz).discounts[0]!, id: undefined, starts_on: '2026-12-01' }],
    });
    const updated = toCatalogPayload(product, { ...opts, id: 'i1' });
    expect(updated).toMatchObject({ id: 'i1', duration_minutes: null, buffer_after_minutes: 0, stock: 4 });
    expect(updated.photos[0]!.is_cover).toBe(true); // sin portada marcada: la primera
    expect(updated.discounts[0]).toMatchObject({ starts_at: '2026-12-01T05:00:00.000Z' });
    expect('products' in updated).toBe(false);
  });
});

describe('mensajes de error (fase 13 §3)', () => {
  it('Postgres, PostgREST y HTTP → español', () => {
    expect(errorMessage({ code: '57014' })).toMatch(/tardó demasiado/);
    expect(errorMessage({ code: '40001' })).toMatch(/cruce/);
    expect(errorMessage({ code: 'PGRST116' })).toMatch(/No encontramos/);
    expect(errorMessage({ code: '23502' })).toBe('Falta un dato obligatorio.');
    expect(errorMessage({ status: 503 })).toMatch(/no está disponible/);
    expect(errorMessage({ status: 429 })).toMatch(/Demasiados intentos/);
    expect(errorMessage({ status: 401 })).toMatch(/sesión terminó/);
    expect(errorMessage({ status: 403 })).toMatch(/permiso/);
  });

  it('mensajes propios en español y casos límite', () => {
    expect(errorMessage({ code: 'SV001', message: 'SLOT_TAKEN' })).toBe('Ese horario ya está lleno. Elige otro.');
    expect(errorMessage({ code: 'SV003', message: 'Debes autorizar…' })).toBe('Debes autorizar…');
    expect(errorMessage({ code: 'P0001', message: 'Mensaje propio' })).toBe('Mensaje propio');
    expect(errorMessage({ code: '23514', message: 'El slug está reservado' })).toBe('El slug está reservado');
    expect(errorMessage({ code: '23505', message: 'violates "branches_company_id_slug_key"' })).toMatch(/sede/);
    expect(errorMessage({ code: '23505', message: 'otra' })).toBe('Ya existe un registro con esos datos.');
    expect(errorMessage({ name: 'TypeError', message: 'Failed to fetch' })).toMatch(/conexión/);
    expect(errorMessage({ code: 'invalid_credentials' })).toBe('Correo o contraseña incorrectos.');
    expect(errorMessage('Texto')).toBe('Texto');
    expect(errorMessage(null)).toBe(GENERIC_ERROR);
    expect(errorMessage({})).toBe(GENERIC_ERROR);
  });
});
