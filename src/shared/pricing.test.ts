import { describe, expect, it } from 'vitest';
import {
  activeDiscount,
  bookingTotals,
  currencyDigits,
  discountAmount,
  discountBadge,
  discountStatus,
  effectivePrice,
  priceAt,
  roundMoney,
  type DiscountLike,
} from './pricing';

const AT = new Date('2026-11-30T12:00:00Z');
const B1 = 'b0000000-0000-4000-a000-000000000001';
const B2 = 'b0000000-0000-4000-a000-000000000002';

function discount(over: Partial<DiscountLike> = {}): DiscountLike {
  return {
    id: '00000000-0000-4000-a000-0000000000d1',
    label: 'Promo',
    type: 'percent',
    value: 10,
    starts_at: null,
    ends_at: '2026-12-01T00:00:00Z',
    branch_id: null,
    is_active: true,
    ...over,
  };
}

describe('currencyDigits y roundMoney', () => {
  it('0 decimales para COP/CLP (sin importar mayúsculas), 2 para el resto', () => {
    expect(currencyDigits('COP')).toBe(0);
    expect(currencyDigits('clp')).toBe(0);
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('EUR')).toBe(2);
  });

  it('redondea mitades hacia arriba sin errores de coma flotante', () => {
    expect(roundMoney(2.5, 0)).toBe(3);
    expect(roundMoney(2.49, 0)).toBe(2);
    expect(roundMoney(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundMoney(19.99, 2)).toBe(19.99);
    expect(roundMoney(35000, 0)).toBe(35000);
  });
});

describe('discountAmount', () => {
  it('porcentaje sobre la base, redondeado a la moneda', () => {
    expect(discountAmount(35000, { type: 'percent', value: 15 }, 0)).toBe(5250);
    expect(discountAmount(33333, { type: 'percent', value: 15 }, 0)).toBe(5000);
    expect(discountAmount(19.99, { type: 'percent', value: 15 }, 2)).toBe(3);
    expect(discountAmount(10, { type: 'percent', value: 33.33 }, 2)).toBe(3.33);
  });

  it('porcentaje 100 = precio completo', () => {
    expect(discountAmount(50000, { type: 'percent', value: 100 }, 0)).toBe(50000);
  });

  it('fijo: redondeado y nunca mayor que la base', () => {
    expect(discountAmount(50000, { type: 'fixed', value: 60000 }, 0)).toBe(50000);
    expect(discountAmount(30000, { type: 'fixed', value: 5000.5 }, 0)).toBe(5001);
    expect(discountAmount(10, { type: 'fixed', value: 2.5 }, 2)).toBe(2.5);
  });

  it('base 0 → ahorro 0', () => {
    expect(discountAmount(0, { type: 'fixed', value: 100 }, 0)).toBe(0);
    expect(discountAmount(0, { type: 'percent', value: 50 }, 0)).toBe(0);
  });

  it('montos grandes (numeric(12,2)) sin perder precisión', () => {
    expect(discountAmount(9_999_999_999.99, { type: 'percent', value: 99.99 }, 2)).toBe(9_998_999_999.99);
  });
});

describe('discountStatus', () => {
  it('programado, vigente, vencido e inactivo', () => {
    expect(discountStatus(discount({ starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-12-10T00:00:00Z' }), AT)).toBe(
      'scheduled',
    );
    expect(discountStatus(discount(), AT)).toBe('active');
    expect(discountStatus(discount({ ends_at: '2026-11-30T11:59:59.999Z' }), AT)).toBe('expired');
    expect(discountStatus(discount({ is_active: false }), AT)).toBe('inactive');
  });

  it('vencido gana sobre inactivo; los límites son inclusivos', () => {
    expect(discountStatus(discount({ is_active: false, ends_at: '2026-11-01T00:00:00Z' }), AT)).toBe('expired');
    expect(discountStatus(discount({ starts_at: AT.toISOString(), ends_at: AT.toISOString() }), AT)).toBe('active');
  });
});

describe('activeDiscount', () => {
  it('sin descuentos → null', () => {
    expect(activeDiscount({ price: 100 }, [], AT, null)).toBeNull();
  });

  it('ignora los de otro ítem', () => {
    const d = discount({ item_id: 'otro' });
    expect(activeDiscount({ id: 'este', price: 100 }, [d], AT, null)).toBeNull();
    expect(activeDiscount({ id: 'otro', price: 100 }, [d], AT, null)).toBe(d);
  });

  it('sede: aplica el de la sede o el de todas; sin sede solo los de todas', () => {
    const own = discount({ id: 'a', branch_id: B2, type: 'fixed', value: 30 });
    const all = discount({ id: 'b', type: 'fixed', value: 10 });
    expect(activeDiscount({ price: 100 }, [own, all], AT, B2)).toBe(own);
    expect(activeDiscount({ price: 100 }, [own, all], AT, B1)).toBe(all);
    expect(activeDiscount({ price: 100 }, [own], AT, null)).toBeNull();
  });

  it('mayor ahorro calculado sobre la base dada (precio de sede)', () => {
    const pct = discount({ id: 'a', type: 'percent', value: 50 });
    const fixed = discount({ id: 'b', type: 'fixed', value: 30 });
    expect(activeDiscount({ price: 100 }, [pct, fixed], AT, null)).toBe(pct); // 50 > 30
    expect(activeDiscount({ price: 100 }, [pct, fixed], AT, null, { base: 40 })).toBe(fixed); // 20 < 30
  });

  it('empates: vence antes, luego id menor', () => {
    const later = discount({ id: 'a', type: 'fixed', value: 10, ends_at: '2026-12-20T00:00:00Z' });
    const sooner = discount({ id: 'z', type: 'fixed', value: 10, ends_at: '2026-12-10T00:00:00Z' });
    expect(activeDiscount({ price: 100 }, [later, sooner], AT, null)).toBe(sooner);
    // Misma fecha en distinto formato ISO: se compara el instante.
    const x = discount({ id: 'b', type: 'fixed', value: 10, ends_at: '2026-12-10T00:00:00.000Z' });
    expect(activeDiscount({ price: 100 }, [sooner, x], AT, null)).toBe(x);
  });

  it('usa los decimales de la moneda para comparar ahorros', () => {
    // USD: 0,60 (0,6 %) < 0,70 (fijo) → fijo. COP: ambos redondean a 1 → empate → id menor (pct).
    const pct = discount({ id: 'a', type: 'percent', value: 0.6 });
    const fixed = discount({ id: 'b', type: 'fixed', value: 0.7 });
    expect(activeDiscount({ price: 100 }, [pct, fixed], AT, null, { currency: 'USD' })).toBe(fixed);
    expect(activeDiscount({ price: 100 }, [pct, fixed], AT, null, { currency: 'COP' })).toBe(pct);
  });
});

describe('effectivePrice y priceAt', () => {
  it('sin descuento: final = base', () => {
    expect(effectivePrice({ price: 35000 })).toEqual({
      base: 35000,
      discountAmount: 0,
      final: 35000,
      discountLabel: null,
      discountType: null,
      discountValue: null,
      endsAt: null,
      discountId: null,
    });
  });

  it('con descuento y precio de sede', () => {
    const d = discount({ value: 20 });
    expect(effectivePrice({ price: 100000 }, { override: 80000, discount: d })).toMatchObject({
      base: 80000,
      discountAmount: 16000,
      final: 64000,
      discountLabel: 'Promo',
      discountType: 'percent',
      discountValue: 20,
      endsAt: d.ends_at,
      discountId: d.id,
    });
  });

  it('etiqueta vacía → null; override null usa el precio del ítem', () => {
    const p = effectivePrice({ price: 1000 }, { override: null, discount: discount({ label: '' }) });
    expect(p.discountLabel).toBeNull();
    expect(p.base).toBe(1000);
  });

  it('redondea la base a la moneda', () => {
    expect(effectivePrice({ price: 999.6 }, { currency: 'COP' }).base).toBe(1000);
    expect(effectivePrice({ price: 999.6 }, { currency: 'USD' }).base).toBe(999.6);
  });

  it('priceAt: el descuento vence y el precio vuelve al base', () => {
    const d = discount({ value: 15, ends_at: '2026-12-01T12:00:00Z' });
    expect(priceAt({ price: 35000 }, [d], AT, null).final).toBe(29750);
    expect(priceAt({ price: 35000 }, [d], new Date('2026-12-01T12:00:00.001Z'), null).final).toBe(35000);
  });

  it('priceAt con override elige el descuento sobre el precio de la sede', () => {
    const pct = discount({ id: 'a', type: 'percent', value: 50 });
    const fixed = discount({ id: 'b', type: 'fixed', value: 30 });
    expect(priceAt({ price: 100 }, [pct, fixed], AT, B1, { override: 40, currency: 'USD' })).toMatchObject({
      base: 40,
      discountId: 'b',
      final: 10,
    });
  });
});

describe('bookingTotals', () => {
  const service = { item: { id: 's', price: 50000 }, discounts: [discount({ item_id: 's', value: 10 })] };
  const cera = {
    item: { id: 'p1', price: 28000 },
    discounts: [discount({ id: 'x', item_id: 'p1', type: 'fixed', value: 3000 })],
  };
  const shampoo = { item: { id: 'p2', price: 25000 }, discounts: [] };

  it('servicio solo', () => {
    const t = bookingTotals({ service, addons: [], at: AT, branchId: B1 });
    expect(t).toMatchObject({ subtotal: 50000, productsTotal: 0, discountTotal: 5000, total: 45000 });
    expect(t.service.final).toBe(45000);
  });

  it('servicio + productos con cantidades y descuento por unidad', () => {
    const t = bookingTotals({
      service,
      addons: [
        { ...cera, quantity: 2 },
        { ...shampoo, quantity: 1 },
      ],
      at: AT,
      branchId: B1,
      currency: 'COP',
    });
    expect(t.addons.map((l) => [l.lineSubtotal, l.lineDiscount, l.lineTotal])).toEqual([
      [56000, 6000, 50000],
      [25000, 0, 25000],
    ]);
    expect(t).toMatchObject({ subtotal: 131000, productsTotal: 81000, discountTotal: 11000, total: 120000 });
  });

  it('precio de sede en servicio y producto; cantidades inválidas → 0', () => {
    const t = bookingTotals({
      service: { ...service, override: 40000 },
      addons: [
        { ...shampoo, override: 20000, quantity: 1.9 },
        { ...cera, quantity: -3 },
      ],
      at: AT,
      branchId: B2,
    });
    expect(t.service).toMatchObject({ base: 40000, final: 36000 });
    expect(t.addons.map((l) => l.quantity)).toEqual([1, 0]);
    expect(t).toMatchObject({ subtotal: 60000, discountTotal: 4000, total: 56000 });
  });

  it('con centavos (USD) suma sin errores de coma flotante', () => {
    const t = bookingTotals({
      service: { item: { price: 0.1 }, discounts: [] },
      addons: [{ item: { price: 0.2 }, discounts: [], quantity: 1 }],
      at: AT,
      branchId: null,
      currency: 'USD',
    });
    expect(t.total).toBe(0.3);
  });

  it('un descuento vencido no cuenta en la reserva', () => {
    const t = bookingTotals({ service, addons: [], at: new Date('2027-01-01T00:00:00Z'), branchId: B1 });
    expect(t.total).toBe(50000);
  });
});

describe('discountBadge', () => {
  const opts = { currency: 'COP', locale: 'es-CO', timeZone: 'America/Bogota' };

  it('porcentaje con fecha en la zona de la empresa', () => {
    // 1 dic 00:00 UTC = 30 nov 19:00 en Bogotá.
    const p = effectivePrice({ price: 100 }, { discount: discount({ value: 20 }) });
    expect(discountBadge(p, opts)).toBe('−20 % hasta 30/11');
  });

  it('fijo muestra el ahorro en dinero', () => {
    const p = effectivePrice({ price: 50000 }, { discount: discount({ type: 'fixed', value: 5000 }) });
    expect(discountBadge(p, opts)).toMatch(/^−\$\s?5\.000 hasta 30\/11$/);
  });

  it('sin descuento → null', () => {
    expect(discountBadge(effectivePrice({ price: 100 }), opts)).toBeNull();
  });
});
