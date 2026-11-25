const pad = (n: number) => String(n).padStart(2, '0');

/** Primer y último día (inclusive) del mes de `month` ('YYYY-MM'). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}
