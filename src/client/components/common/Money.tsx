import { formatMoney } from '@shared/format';

/** Monto con la moneda y el locale de la empresa. */
export function Money({ amount, currency, locale }: { amount: number; currency: string; locale: string }) {
  return <span className="tabular-nums">{formatMoney(amount, currency, locale)}</span>;
}
