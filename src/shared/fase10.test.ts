import { describe, expect, it } from 'vitest';
import {
  bookingIcs,
  bookingRequestSchema,
  canCustomerCancel,
  dayPart,
  formatCode,
  googleCalendarUrl,
  lookupSchema,
  normalizeCode,
  quoteBooking,
  whatsappBookingText,
  BOOKING_CODE_REGEX,
} from './booking';

const UUID = '30000000-0000-4000-a000-000000000001';

describe('código de reserva', () => {
  it('normaliza lo que escribe el cliente (Crockford)', () => {
    expect(normalizeCode(' k7m2-9qxa ')).toBe('K7M29QXA');
    expect(normalizeCode('O1IL')).toBe('0111');
    expect(BOOKING_CODE_REGEX.test('K7M29QXA')).toBe(true);
    expect(BOOKING_CODE_REGEX.test('K7M29QXU')).toBe(false);
    expect(formatCode('K7M29QXA')).toBe('K7M2-9QXA');
  });
});

describe('esquemas', () => {
  const base = {
    branch_slug: 'centro',
    service_id: UUID,
    starts_at: '2026-12-01T14:00:00.000Z',
    customer: { name: ' Ana ', phone: '+573001234567', email: '', notes: '' },
    privacy_consent: true,
    turnstile: 'tok',
  };

  it('reserva: limpia vacíos y exige E.164', () => {
    const ok = bookingRequestSchema.parse(base);
    expect(ok.customer).toEqual({ name: 'Ana', phone: '+573001234567', email: null, notes: null });
    expect(ok.items).toEqual([]);
    expect(
      bookingRequestSchema.safeParse({ ...base, customer: { ...base.customer, phone: '3001234567' } }).success,
    ).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...base, items: [{ product_id: UUID, quantity: 0 }] }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...base, turnstile: '' }).success).toBe(false);
    // Autorización de datos obligatoria (fase 13, D31).
    expect(bookingRequestSchema.safeParse({ ...base, privacy_consent: false }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...base, privacy_consent: undefined }).success).toBe(false);
  });

  it('búsqueda: por código normaliza y exige contacto; por contacto acepta teléfono o correo', () => {
    const code = lookupSchema.parse({
      mode: 'code',
      code: 'k7m2-9qxa',
      contact: { phone: '+573001234567' },
      turnstile: 't',
    });
    expect(code).toMatchObject({ mode: 'code', code: 'K7M29QXA' });
    expect(
      lookupSchema.safeParse({ mode: 'code', code: 'K7M2', contact: { phone: '+573001234567' }, turnstile: 't' })
        .success,
    ).toBe(false);
    expect(lookupSchema.safeParse({ mode: 'contact', contact: { email: 'a@b.co' }, turnstile: 't' }).success).toBe(
      true,
    );
    expect(lookupSchema.safeParse({ mode: 'contact', contact: {}, turnstile: 't' }).success).toBe(false);
  });
});

describe('totales', () => {
  it('coincide con create_booking: 100 − 10 + 2 × 10 = 110 (pgTAP fase10)', () => {
    const q = quoteBooking(
      { price: 100, final_price: 90 },
      [{ id: 'p', name: 'Producto', price: 10, final_price: 10 }],
      { p: 2 },
      'COP',
    );
    expect(q).toMatchObject({ service: 90, subtotal: 120, discount: 10, total: 110 });
    expect(q.lines).toEqual([{ id: 'p', name: 'Producto', quantity: 2, unitPrice: 10, unitFinal: 10, lineTotal: 20 }]);
  });

  it('descuento por unidad y redondeo a 2 decimales en USD; cantidades en 0 no cuentan', () => {
    const q = quoteBooking(
      { price: 19.99, final_price: 19.99 },
      [
        { id: 'a', name: 'A', price: 3.33, final_price: 2.83 },
        { id: 'b', name: 'B', price: 5, final_price: 5 },
      ],
      { a: 3, b: 0 },
      'USD',
    );
    expect(q.total).toBe(28.48);
    expect(q.discount).toBe(1.5);
    expect(q.lines).toHaveLength(1);
  });
});

describe('cancelación', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  it('solo si la empresa lo permite, está activa y falta más del límite', () => {
    const b = { status: 'confirmed' as const, starts_at: '2026-11-27T12:00:00Z' };
    expect(canCustomerCancel(b, { allowed: true, limit_hours: 24 }, now)).toBe(true);
    expect(canCustomerCancel(b, { allowed: true, limit_hours: 48 }, now)).toBe(false);
    expect(canCustomerCancel(b, { allowed: false, limit_hours: 1 }, now)).toBe(false);
    expect(canCustomerCancel({ ...b, status: 'cancelled' }, { allowed: true, limit_hours: 1 }, now)).toBe(false);
  });
});

describe('calendario y textos', () => {
  const event = {
    uid: 'K7M29QXA@servigo.roquintech.com',
    title: 'Corte, barba; y más',
    start: '2026-12-01T14:00:00.000Z',
    end: '2026-12-01T14:30:00.000Z',
    location: 'Sede Centro, Calle 10',
    description: 'Reserva K7M2-9QXA.\nhttps://demo.roquintech.com/reserva/K7M29QXA',
  };

  it('.ics válido: CRLF, UTC y texto escapado', () => {
    const ics = bookingIcs(event, new Date('2026-11-25T12:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261201T140000Z');
    expect(ics).toContain('DTEND:20261201T143000Z');
    expect(ics).toContain('DTSTAMP:20261125T120000Z');
    expect(ics).toContain('SUMMARY:Corte\\, barba\\; y más');
    expect(ics).toContain('DESCRIPTION:Reserva K7M2-9QXA.\\nhttps');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // Ninguna línea pasa de 75 caracteres.
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });

  it('enlace de Google Calendar', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261201T140000Z/20261201T143000Z');
    expect(url.searchParams.get('text')).toBe(event.title);
  });

  it('franja del día y mensaje de WhatsApp en la hora de la sede', () => {
    expect(dayPart('2026-12-01T14:00:00Z', 'America/Bogota')).toBe('morning'); // 9:00
    expect(dayPart('2026-12-01T17:00:00Z', 'America/Bogota')).toBe('afternoon'); // 12:00
    expect(dayPart('2026-12-01T23:30:00Z', 'America/Bogota')).toBe('evening'); // 18:30
    expect(
      whatsappBookingText({
        code: 'K7M29QXA',
        service_name: 'Corte',
        starts_at: '2026-12-01T14:00:00Z',
        timezone: 'America/Bogota',
      }),
    ).toMatch(/^Hola, mi reserva K7M2-9QXA: Corte, martes, 1 de diciembre de 2026, 9:00/);
  });
});
