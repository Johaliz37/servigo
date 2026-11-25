/**
 * Precios y descuentos (fase 06 §1). TS puro: lo usan el panel, el sitio público y los tests.
 *
 * La misma lógica vive en SQL (`currency_digits`, `discount_amount`, `pick_discount`, usadas
 * por `effective_catalog` y, en la fase 10, por `create_booking`). **Ambas deben coincidir**:
 * los casos de `supabase/tests/fase06_pricing.test.sql` los verifican pgTAP y
 * `pricing.parity.test.ts` contra las dos implementaciones.
 *
 * Reglas:
 * - Un descuento aplica si está activo, `starts_at ≤ at ≤ ends_at` (inicio opcional, ambos
 *   inclusive) y su sede es la consultada o es de todas (`branch_id` null).
 * - Si aplican varios gana el de **mayor ahorro**; empate → el que vence antes; luego el id.
 * - Decimales: 0 para monedas sin centavos de uso común (COP, CLP…), 2 para el resto (la BD
 *   guarda `numeric(12,2)`). Redondeo al más cercano, mitades hacia arriba (`round` de Postgres).
 * - Porcentaje: `round(base × valor / 100)`. Fijo: `round(valor)`, nunca más que la base.
 */
import { formatInTimeZone, formatMoney, ZERO_DECIMAL_CURRENCIES } from './format';

export type DiscountType = 'percent' | 'fixed';

export interface DiscountLike {
  id: string;
  item_id?: string | undefined;
  label: string;
  type: DiscountType;
  value: number;
  starts_at: string | null;
  ends_at: string;
  branch_id: string | null;
  is_active: boolean;
}

export interface PricedItem {
  id?: string | undefined;
  price: number;
}

export { ZERO_DECIMAL_CURRENCIES };

export function currencyDigits(currency: string): 0 | 2 {
  return ZERO_DECIMAL_CURRENCIES.includes(currency.toUpperCase()) ? 0 : 2;
}

/** Monto en centavos exactos (la BD guarda como máximo 2 decimales). */
function toMinor(amount: number): bigint {
  return BigInt(Math.round(amount * 100));
}

function fromMinor(minor: bigint): number {
  return Number(minor) / 100;
}

/** División entera redondeando mitades hacia arriba (operandos ≥ 0). */
function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  return (n - q * d) * 2n >= d ? q + 1n : q;
}

/** Redondea a `digits` decimales (0 o 2) sin errores de coma flotante. */
export function roundMoney(amount: number, digits: 0 | 2): number {
  if (digits === 2) return fromMinor(toMinor(amount));
  return fromMinor(divRound(toMinor(Math.max(0, amount)), 100n) * 100n);
}

/** Ahorro que produce un descuento sobre `base` (ya redondeada). Nunca supera la base. */
export function discountAmount(base: number, discount: Pick<DiscountLike, 'type' | 'value'>, digits: 0 | 2): number {
  const unit = digits === 0 ? 100n : 1n; // en centavos
  const baseMinor = toMinor(base);
  let minor: bigint;
  if (discount.type === 'percent') {
    // base[centavos] × valor[centésimas] / 10000 = centavos; se redondea a la unidad de la moneda.
    minor = divRound(baseMinor * toMinor(discount.value), 10000n * unit) * unit;
  } else {
    minor = divRound(toMinor(discount.value), unit) * unit;
  }
  return fromMinor(minor < baseMinor ? minor : baseMinor);
}

export type DiscountStatus = 'inactive' | 'scheduled' | 'active' | 'expired';

export const DISCOUNT_STATUS_LABELS: Record<DiscountStatus, string> = {
  inactive: 'Inactivo',
  scheduled: 'Programado',
  active: 'Vigente',
  expired: 'Vencido',
};

/** Estado calculado de un descuento en el instante `at` (sin mirar la sede). */
export function discountStatus(
  discount: Pick<DiscountLike, 'is_active' | 'starts_at' | 'ends_at'>,
  at: Date,
): DiscountStatus {
  const t = at.getTime();
  if (t > new Date(discount.ends_at).getTime()) return 'expired';
  if (!discount.is_active) return 'inactive';
  if (discount.starts_at && t < new Date(discount.starts_at).getTime()) return 'scheduled';
  return 'active';
}

function applies(discount: DiscountLike, item: PricedItem, at: Date, branchId: string | null): boolean {
  return (
    (discount.item_id === undefined || item.id === undefined || discount.item_id === item.id) &&
    discountStatus(discount, at) === 'active' &&
    (discount.branch_id === null || discount.branch_id === branchId)
  );
}

/**
 * Descuento vigente con mayor ahorro para el ítem en `at` y la sede `branchId` (null = solo
 * los de todas las sedes). `base` = precio sobre el que se calcula (por defecto el del ítem).
 */
export function activeDiscount<D extends DiscountLike>(
  item: PricedItem,
  discounts: readonly D[],
  at: Date,
  branchId: string | null,
  options: { base?: number | undefined; currency?: string } = {},
): D | null {
  const digits = currencyDigits(options.currency ?? 'COP');
  const base = roundMoney(options.base ?? item.price, digits);
  let best: { discount: D; amount: number; ends: number } | null = null;
  for (const discount of discounts) {
    if (!applies(discount, item, at, branchId)) continue;
    const amount = discountAmount(base, discount, digits);
    const ends = new Date(discount.ends_at).getTime();
    // Mismo orden que SQL: ahorro desc, ends_at asc, id asc (uuid en minúsculas = orden de bytes).
    if (
      !best ||
      amount > best.amount ||
      (amount === best.amount && (ends < best.ends || (ends === best.ends && discount.id < best.discount.id)))
    ) {
      best = { discount, amount, ends };
    }
  }
  return best?.discount ?? null;
}

export interface EffectivePrice {
  /** Precio antes de descuento (el de la sede si tiene uno propio). */
  base: number;
  discountAmount: number;
  final: number;
  /** Etiqueta del descuento aplicado (la que escribió la empresa), o null. */
  discountLabel: string | null;
  discountType: DiscountType | null;
  discountValue: number | null;
  /** Fecha límite del descuento aplicado. */
  endsAt: string | null;
  discountId: string | null;
}

/** Precio final de un ítem: base (o precio de la sede) menos el descuento dado. */
export function effectivePrice(
  item: PricedItem,
  options: { override?: number | null | undefined; discount?: DiscountLike | null; currency?: string } = {},
): EffectivePrice {
  const digits = currencyDigits(options.currency ?? 'COP');
  const base = roundMoney(options.override ?? item.price, digits);
  const discount = options.discount ?? null;
  const amount = discount ? discountAmount(base, discount, digits) : 0;
  return {
    base,
    discountAmount: amount,
    final: roundMoney(base - amount, digits),
    discountLabel: discount ? discount.label || null : null,
    discountType: discount?.type ?? null,
    discountValue: discount?.value ?? null,
    endsAt: discount?.ends_at ?? null,
    discountId: discount?.id ?? null,
  };
}

/** Atajo: elige el mejor descuento y calcula el precio en un paso. */
export function priceAt(
  item: PricedItem,
  discounts: readonly DiscountLike[],
  at: Date,
  branchId: string | null,
  options: { override?: number | null | undefined; currency?: string } = {},
): EffectivePrice {
  const base = options.override ?? item.price;
  const discount = activeDiscount(item, discounts, at, branchId, { base, ...pick(options, 'currency') });
  return effectivePrice(item, { ...options, discount });
}

function pick<T extends object, K extends keyof T>(obj: T, key: K): Partial<Pick<T, K>> {
  return obj[key] === undefined ? {} : ({ [key]: obj[key] } as Pick<T, K>);
}

export interface PricedLine {
  item: PricedItem;
  discounts: readonly DiscountLike[];
  override?: number | null | undefined;
}

export interface BookingLine extends EffectivePrice {
  quantity: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineTotal: number;
}

export interface BookingTotals {
  service: EffectivePrice;
  addons: BookingLine[];
  /** Precio base del servicio + productos (antes de descuentos). */
  subtotal: number;
  /** Suma de productos antes de descuentos (`bookings.products_total`). */
  productsTotal: number;
  /** Ahorro total: servicio + productos (`bookings.discount_total`). */
  discountTotal: number;
  total: number;
}

/**
 * Totales de una reserva (servicio + productos añadidos) en `at`. El descuento de cada
 * producto se aplica por unidad. Debe coincidir con `create_booking` (fase 10).
 */
export function bookingTotals(input: {
  service: PricedLine;
  addons: (PricedLine & { quantity: number })[];
  at: Date;
  branchId: string | null;
  currency?: string;
}): BookingTotals {
  const digits = currencyDigits(input.currency ?? 'COP');
  const opts = pick(input, 'currency');
  const service = priceAt(input.service.item, input.service.discounts, input.at, input.branchId, {
    override: input.service.override,
    ...opts,
  });
  const addons = input.addons.map((line): BookingLine => {
    const price = priceAt(line.item, line.discounts, input.at, input.branchId, { override: line.override, ...opts });
    const quantity = Math.max(0, Math.trunc(line.quantity));
    return {
      ...price,
      quantity,
      lineSubtotal: roundMoney(price.base * quantity, digits),
      lineDiscount: roundMoney(price.discountAmount * quantity, digits),
      lineTotal: roundMoney(price.final * quantity, digits),
    };
  });
  const productsTotal = roundMoney(
    addons.reduce((sum, l) => sum + l.lineSubtotal, 0),
    digits,
  );
  const discountTotal = roundMoney(
    addons.reduce((sum, l) => sum + l.lineDiscount, service.discountAmount),
    digits,
  );
  const subtotal = roundMoney(service.base + productsTotal, digits);
  return {
    service,
    addons,
    subtotal,
    productsTotal,
    discountTotal,
    total: roundMoney(subtotal - discountTotal, digits),
  };
}

/** Texto del badge: "−15 % hasta 30/11" o "−$ 5.000 hasta 30/11" (fecha en la zona dada). */
export function discountBadge(
  price: Pick<EffectivePrice, 'discountType' | 'discountValue' | 'discountAmount' | 'endsAt'>,
  options: { currency: string; locale: string; timeZone: string },
): string | null {
  if (!price.discountType || price.discountValue === null || !price.endsAt) return null;
  const amount =
    price.discountType === 'percent'
      ? `${new Intl.NumberFormat(options.locale, { maximumFractionDigits: 2 }).format(price.discountValue)} %`
      : formatMoney(price.discountAmount, options.currency, options.locale);
  return `−${amount} hasta ${formatInTimeZone(price.endsAt, options.timeZone, 'dd/MM')}`;
}
