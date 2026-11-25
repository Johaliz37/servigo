/** Formato de dinero, fechas en la zona de la sede y slugs. TS puro. */
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';

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

/**
 * Fecha/hora en la zona horaria IANA de la sede (00 §6: la UI muestra la hora de la
 * sede, no la del navegador). `pattern` usa tokens de date-fns.
 */
export function formatInTimeZone(
  date: Date | string | number,
  timeZone: string,
  pattern = 'd MMM yyyy, h:mm a',
): string {
  const d = new TZDate(new Date(date).getTime(), timeZone);
  return format(d, pattern, { locale: es });
}

/** "Barbería El Corte" → "barberia-el-corte" (para sugerir slugs; se valida aparte). */
export function slugify(text: string, maxLength = 32): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}
