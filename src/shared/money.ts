/** Formato de dinero sin dependencias (lo usa el sitio público sin cargar date-fns). TS puro. */

/** Monedas que en la práctica no usan decimales (Intl dice 2 para COP, pero nadie cobra centavos). */
export const ZERO_DECIMAL_CURRENCIES: readonly string[] = ['COP', 'CLP', 'PYG', 'JPY', 'KRW'];

export function formatMoney(amount: number, currency = 'COP', locale = 'es-CO'): string {
  // COP y similares no usan decimales en la práctica; el resto, los de la moneda.
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.includes(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: zeroDecimal ? 0 : undefined,
    maximumFractionDigits: zeroDecimal ? 0 : undefined,
  }).format(amount);
}
