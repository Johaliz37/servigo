/// <reference types="vite/client" />
/**
 * Paridad TS ↔ SQL (fase 06 §1): ejecuta contra pricing.ts los mismos casos que pgTAP
 * ejecuta contra `pick_discount`/`discount_amount` (bloque $cases$ del test SQL).
 */
import { describe, expect, it } from 'vitest';
import sql from '../../supabase/tests/fase06_pricing.test.sql?raw';
import { priceAt, type DiscountLike } from './pricing';

interface ParityCase {
  name: string;
  base: number;
  currency: string;
  branch: string | null;
  at: string;
  discounts: DiscountLike[];
  expected: { discount_id: string | null; amount: number; final: number };
}

const match = /\$cases\$\s*(\[[\s\S]*?\])\s*\$cases\$::jsonb/.exec(sql);
const cases = JSON.parse(match?.[1] ?? '[]') as ParityCase[];

describe('paridad de precios con SQL', () => {
  it('lee los casos del test SQL', () => {
    expect(cases).toHaveLength(19);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const price = priceAt({ price: c.base }, c.discounts, new Date(c.at), c.branch, { currency: c.currency });
    expect(price.discountId).toBe(c.expected.discount_id);
    expect(price.discountAmount).toBe(c.expected.amount);
    expect(price.final).toBe(c.expected.final);
  });
});
