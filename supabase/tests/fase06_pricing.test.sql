-- Fase 06: paridad de precios SQL ↔ TS. Los MISMOS casos (bloque $cases$) los ejecuta
-- src/shared/pricing.parity.test.ts contra pricing.ts: si una implementación cambia sin la
-- otra, falla alguno de los dos lados.
begin;
select plan(4);

create temp table cases on commit drop as
select c.ordinality::int as n, c.value as c
from jsonb_array_elements($cases$
[
  {"name": "sin descuentos", "base": 35000, "currency": "COP", "branch": null, "at": "2026-11-30T12:00:00Z",
   "discounts": [], "expected": {"discount_id": null, "amount": 0, "final": 35000}},
  {"name": "porcentaje en COP", "base": 35000, "currency": "COP", "branch": null, "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "percent", "value": 15, "starts_at": null,
     "ends_at": "2026-12-01T00:00:00Z", "branch_id": null, "is_active": true, "label": "Promo"}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d1", "amount": 5250, "final": 29750}},
  {"name": "porcentaje con centavos (USD) redondea mitades hacia arriba", "base": 19.99, "currency": "USD",
   "branch": null, "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "percent", "value": 15, "starts_at": null,
     "ends_at": "2026-12-01T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d1", "amount": 3.00, "final": 16.99}},
  {"name": "porcentaje en COP redondea a pesos", "base": 33333, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "percent", "value": 15, "starts_at": null,
     "ends_at": "2026-12-01T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d1", "amount": 5000, "final": 28333}},
  {"name": "porcentaje fraccionario en CLP", "base": 9990, "currency": "CLP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "percent", "value": 12.5, "starts_at": null,
     "ends_at": "2026-12-01T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d1", "amount": 1249, "final": 8741}},
  {"name": "porcentaje 100 deja el precio en 0", "base": 50000, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "percent", "value": 100, "starts_at": null,
     "ends_at": "2026-12-01T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d1", "amount": 50000, "final": 0}},
  {"name": "fijo mayor que el precio deja el precio en 0", "base": 50000, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "fixed", "value": 60000, "starts_at": null,
     "ends_at": "2026-12-01T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d1", "amount": 50000, "final": 0}},
  {"name": "fijo con centavos en COP se redondea", "base": 30000, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "fixed", "value": 5000.50, "starts_at": null,
     "ends_at": "2026-12-01T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d1", "amount": 5001, "final": 24999}},
  {"name": "fijo en USD", "base": 10, "currency": "USD", "branch": null, "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "fixed", "value": 2.5, "starts_at": null,
     "ends_at": "2026-12-01T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d1", "amount": 2.50, "final": 7.50}},
  {"name": "inicio y fecha límite son inclusivos", "base": 1000, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "fixed", "value": 100,
     "starts_at": "2026-11-30T12:00:00Z", "ends_at": "2026-11-30T12:00:00.001Z", "branch_id": null,
     "is_active": true, "label": ""},
    {"id": "00000000-0000-4000-a000-0000000000d2", "type": "fixed", "value": 50, "starts_at": null,
     "ends_at": "2026-11-30T12:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d1", "amount": 100, "final": 900}},
  {"name": "la fecha límite exacta todavía aplica", "base": 1000, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d2", "type": "fixed", "value": 50, "starts_at": null,
     "ends_at": "2026-11-30T12:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d2", "amount": 50, "final": 950}},
  {"name": "vencido un milisegundo antes no aplica", "base": 1000, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "fixed", "value": 100, "starts_at": null,
     "ends_at": "2026-11-30T11:59:59.999Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": null, "amount": 0, "final": 1000}},
  {"name": "programado (aún no empieza) e inactivo no aplican", "base": 1000, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "fixed", "value": 100,
     "starts_at": "2026-11-30T12:00:00.001Z", "ends_at": "2026-12-30T00:00:00Z", "branch_id": null,
     "is_active": true, "label": ""},
    {"id": "00000000-0000-4000-a000-0000000000d2", "type": "fixed", "value": 200, "starts_at": null,
     "ends_at": "2026-12-30T00:00:00Z", "branch_id": null, "is_active": false, "label": ""}],
   "expected": {"discount_id": null, "amount": 0, "final": 1000}},
  {"name": "descuento de otra sede no aplica", "base": 1000, "currency": "COP",
   "branch": "b0000000-0000-4000-a000-000000000001", "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "fixed", "value": 300, "starts_at": null,
     "ends_at": "2026-12-30T00:00:00Z", "branch_id": "b0000000-0000-4000-a000-000000000002", "is_active": true,
     "label": ""},
    {"id": "00000000-0000-4000-a000-0000000000d2", "type": "fixed", "value": 100, "starts_at": null,
     "ends_at": "2026-12-30T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d2", "amount": 100, "final": 900}},
  {"name": "descuento de la sede consultada sí aplica", "base": 1000, "currency": "COP",
   "branch": "b0000000-0000-4000-a000-000000000002", "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "fixed", "value": 300, "starts_at": null,
     "ends_at": "2026-12-30T00:00:00Z", "branch_id": "b0000000-0000-4000-a000-000000000002", "is_active": true,
     "label": ""},
    {"id": "00000000-0000-4000-a000-0000000000d2", "type": "fixed", "value": 100, "starts_at": null,
     "ends_at": "2026-12-30T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d1", "amount": 300, "final": 700}},
  {"name": "sin sede solo aplican los de todas las sedes", "base": 1000, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "fixed", "value": 300, "starts_at": null,
     "ends_at": "2026-12-30T00:00:00Z", "branch_id": "b0000000-0000-4000-a000-000000000002", "is_active": true,
     "label": ""}],
   "expected": {"discount_id": null, "amount": 0, "final": 1000}},
  {"name": "gana el de mayor ahorro", "base": 35000, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "percent", "value": 10, "starts_at": null,
     "ends_at": "2026-12-30T00:00:00Z", "branch_id": null, "is_active": true, "label": ""},
    {"id": "00000000-0000-4000-a000-0000000000d2", "type": "fixed", "value": 4000, "starts_at": null,
     "ends_at": "2026-12-30T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d2", "amount": 4000, "final": 31000}},
  {"name": "empate: gana el que vence antes", "base": 10000, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d1", "type": "fixed", "value": 1000, "starts_at": null,
     "ends_at": "2026-12-30T00:00:00Z", "branch_id": null, "is_active": true, "label": ""},
    {"id": "00000000-0000-4000-a000-0000000000d2", "type": "percent", "value": 10, "starts_at": null,
     "ends_at": "2026-12-15T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d2", "amount": 1000, "final": 9000}},
  {"name": "empate total: gana el id menor", "base": 10000, "currency": "COP", "branch": null,
   "at": "2026-11-30T12:00:00Z",
   "discounts": [{"id": "00000000-0000-4000-a000-0000000000d9", "type": "fixed", "value": 1000, "starts_at": null,
     "ends_at": "2026-12-30T00:00:00Z", "branch_id": null, "is_active": true, "label": ""},
    {"id": "00000000-0000-4000-a000-0000000000d3", "type": "fixed", "value": 1000, "starts_at": null,
     "ends_at": "2026-12-30T00:00:00Z", "branch_id": null, "is_active": true, "label": ""}],
   "expected": {"discount_id": "00000000-0000-4000-a000-0000000000d3", "amount": 1000, "final": 9000}}
]
$cases$::jsonb) with ordinality as c;

create temp table results on commit drop as
select
  n,
  c ->> 'name' as name,
  (c -> 'expected' ->> 'discount_id')::uuid as expected_id,
  (c -> 'expected' ->> 'amount')::numeric as expected_amount,
  (c -> 'expected' ->> 'final')::numeric as expected_final,
  pd.discount_id,
  coalesce(pd.amount, 0) as amount,
  base.v - coalesce(pd.amount, 0) as final
from cases
cross join lateral (
  select round((c ->> 'base')::numeric, public.currency_digits(c ->> 'currency')) as v
) base
left join lateral public.pick_discount(
  array(select d from jsonb_populate_recordset(null::public.discounts, c -> 'discounts') d),
  base.v,
  public.currency_digits(c ->> 'currency'),
  (c ->> 'branch')::uuid,
  (c ->> 'at')::timestamptz
) pd on true;

select is((select count(*)::int from results), 19, 'se evaluaron los 19 casos de paridad');

select is_empty(
  $$select n, name, expected_id, discount_id from results where discount_id is distinct from expected_id$$,
  'pick_discount elige el descuento esperado en todos los casos');

select is_empty(
  $$select n, name, expected_amount, amount, expected_final, final from results
     where amount <> expected_amount or final <> expected_final$$,
  'ahorro y precio final coinciden con lo esperado en todos los casos');

select is(
  array[public.currency_digits('COP'), public.currency_digits('clp'), public.currency_digits('USD'),
        public.currency_digits('EUR')],
  array[0, 0, 2, 2],
  'currency_digits: 0 para COP/CLP, 2 para USD/EUR');

select * from finish();
rollback;
