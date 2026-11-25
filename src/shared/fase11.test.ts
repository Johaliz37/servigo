import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  bookingsCsv,
  describeEvent,
  editQuote,
  mergeStatuses,
  messageText,
  searchFilter,
  tabCriteria,
  toCsv,
  transitionAllowed,
  whatsappLink,
} from './booking-admin';

const now = new Date('2026-11-25T15:00:00Z');
const past = '2026-11-25T14:00:00Z';
const future = '2026-11-26T14:00:00Z';

describe('máquina de estados (= booking_transition_allowed)', () => {
  it('pending → confirmar o cancelar; confirmed → completar/no asistió solo si ya pasó', () => {
    expect(allowedTransitions('pending', past, now)).toEqual(['confirmed', 'cancelled']);
    expect(allowedTransitions('confirmed', future, now)).toEqual(['cancelled']);
    expect(allowedTransitions('confirmed', past, now)).toEqual(['completed', 'no_show', 'cancelled']);
    for (const s of ['completed', 'no_show', 'cancelled'] as const) {
      expect(allowedTransitions(s, past, now)).toEqual([]);
    }
    expect(transitionAllowed('pending', 'completed', past, now)).toBe(false);
  });
});

describe('pestañas de la bandeja', () => {
  const today = { start: Date.parse('2026-11-25T05:00:00Z'), end: Date.parse('2026-11-26T05:00:00Z') };
  it('hoy, próximas, pendientes, pasadas, canceladas', () => {
    expect(tabCriteria('today', now, today)).toEqual({
      statuses: null,
      from: '2026-11-25T05:00:00.000Z',
      to: '2026-11-26T05:00:00.000Z',
      ascending: true,
    });
    expect(tabCriteria('upcoming', now, today)).toMatchObject({
      statuses: ['pending', 'confirmed'],
      from: now.toISOString(),
    });
    expect(tabCriteria('pending', now, today).statuses).toEqual(['pending']);
    expect(tabCriteria('past', now, today)).toMatchObject({ to: now.toISOString(), ascending: false });
    expect(tabCriteria('past', now, today).statuses).not.toContain('cancelled');
    expect(tabCriteria('cancelled', now, today).statuses).toEqual(['cancelled']);
  });

  it('el estado elegido se cruza con el de la pestaña', () => {
    expect(mergeStatuses(null, 'confirmed')).toEqual(['confirmed']);
    expect(mergeStatuses(['pending', 'confirmed'], 'confirmed')).toEqual(['confirmed']);
    expect(mergeStatuses(['cancelled'], 'confirmed')).toEqual([]);
    expect(mergeStatuses(['pending'], null)).toEqual(['pending']);
  });
});

describe('búsqueda', () => {
  it('quita la sintaxis de PostgREST y busca por código, nombre, correo y teléfono', () => {
    expect(searchFilter('k7m2-9qxa')).toContain('code.ilike.*K7M29QXA*');
    expect(searchFilter('300 123 45')).toContain('customer_phone.ilike.*30012345*');
    expect(searchFilter('Ana')).toBe('customer_name.ilike.*Ana*,customer_email.ilike.*Ana*,code.ilike.*ANA*');
    expect(searchFilter('Laura Gómez')).toBe('customer_name.ilike.*Laura Gómez*,customer_email.ilike.*Laura Gómez*');
    const evil = searchFilter('a),status.eq.cancelled,(x*:"%');
    expect(evil).not.toMatch(/[()"%:]/);
    expect(evil?.split(',')).toHaveLength(2);
    expect(searchFilter(' a ')).toBeNull();
  });
});

describe('CSV', () => {
  it('RFC 4180 y sin fórmulas', () => {
    expect(toCsv([['a', 'b,c', 'd"e', null, 5]])).toBe('a,"b,c","d""e",,5');
    expect(toCsv([['=HYPERLINK("x")', '+573001234567', '-5', '@sum', '-x']])).toBe(
      `"'=HYPERLINK(""x"")",+573001234567,-5,'@sum,'-x`,
    );
    expect(toCsv([['a'], ['b']])).toBe('a\r\nb');
  });

  it('fecha y hora en la zona de la sede', () => {
    const csv = bookingsCsv(
      [
        {
          code: 'K7M29QXA',
          status: 'confirmed',
          starts_at: '2026-12-01T14:00:00Z',
          source: 'web',
          customer_name: 'Ana',
          customer_phone: '+573001234567',
          customer_email: null,
          service_name: 'Corte',
          total: 35000,
          currency: 'COP',
          branch: { name: 'Centro', timezone: 'America/Bogota' },
        },
      ],
      'UTC',
    );
    const [header, row] = csv.split('\r\n');
    expect(header?.startsWith('Código,Fecha,Hora,Sede')).toBe(true);
    expect(row).toBe('K7M2-9QXA,2026-12-01,09:00,Centro,Corte,Ana,+573001234567,,Confirmada,Web,35000,COP');
  });
});

describe('WhatsApp', () => {
  it('plantilla y enlace wa.me', () => {
    const text = messageText('confirmed', {
      code: 'K7M29QXA',
      customer_name: 'Laura Gómez',
      service_name: 'Corte',
      when: 'martes 1 de diciembre, 9:00',
      branch_name: 'Centro',
      company_name: 'Barbería Demo',
    });
    expect(text).toBe(
      'Hola Laura, tu reserva K7M2-9QXA de Corte está confirmada para el martes 1 de diciembre, 9:00 en Centro. ¡Te esperamos! — Barbería Demo',
    );
    expect(whatsappLink('+57 300 123 4567', 'Hola y más')).toBe('https://wa.me/573001234567?text=Hola%20y%20m%C3%A1s');
  });
});

describe('editar: totales (= update_booking_admin, pgTAP fase11)', () => {
  const base = {
    currency: 'COP',
    service: { price: 100, discount: 10 },
    currentService: { price: 100, final_price: 90 },
    items: [{ product_id: 'p', name: 'Producto', unit_price: 10, discount: 0, quantity: 1, line_total: 10 }],
    addons: [{ id: 'p', name: 'Producto', price: 15, final_price: 15 }],
  };

  it('precio congelado: 100 − 10 + 3 × 10 = 120', () => {
    const q = editQuote({ ...base, quantities: { p: 3 }, reprice: false });
    expect(q).toMatchObject({ productsTotal: 30, discountTotal: 10, total: 120 });
    expect(q.lines[0]).toMatchObject({ frozen: true, unitPrice: 10 });
  });

  it('precios actuales: 90 + 3 × 15 = 135; un producto nuevo siempre toma el actual', () => {
    expect(editQuote({ ...base, quantities: { p: 3 }, reprice: true }).total).toBe(135);
    const added = editQuote({
      ...base,
      addons: [...base.addons, { id: 'n', name: 'Nuevo', price: 8, final_price: 6 }],
      quantities: { p: 1, n: 2 },
      reprice: false,
    });
    expect(added).toMatchObject({ productsTotal: 26, discountTotal: 14, total: 112 });
  });

  it('quitar productos y conservar líneas sin producto', () => {
    const q = editQuote({
      ...base,
      items: [
        ...base.items,
        { product_id: null, name: 'Borrado', unit_price: 5, discount: 0, quantity: 2, line_total: 10 },
      ],
      quantities: { p: 0 },
      reprice: false,
    });
    expect(q.lines.map((l) => l.name)).toEqual(['Borrado']);
    expect(q.total).toBe(100);
  });
});

describe('historial', () => {
  const when = (iso: string) => iso.slice(11, 16);
  it('describe cada acción', () => {
    expect(describeEvent({ action: 'created', payload: { source: 'web' } }, when)).toBe(
      'Reserva creada desde el sitio web',
    );
    expect(describeEvent({ action: 'status_changed', payload: { to: 'cancelled', reason: 'Llamó' } }, when)).toBe(
      'Cancelada: «Llamó»',
    );
    expect(describeEvent({ action: 'status_changed', payload: { to: 'cancelled', by: 'customer' } }, when)).toBe(
      'Cancelada por el cliente',
    );
    expect(
      describeEvent(
        { action: 'rescheduled', payload: { from: '2026-12-01T14:00:00Z', to: '2026-12-01T15:00:00Z', forced: true } },
        when,
      ),
    ).toBe('Reprogramada: 14:00 → 15:00 (forzada)');
    expect(describeEvent({ action: 'edited', payload: { changes: ['items', 'reprice'] } }, when)).toBe(
      'Editada: productos, precios actualizados',
    );
  });
});
