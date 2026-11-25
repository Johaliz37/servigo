-- Fase 06: catálogo efectivo por sede, add-ons, guardado transaccional y reglas de borrado.
-- create_tenant deja: servicio (100, -10 % hasta mañana, con reservas), producto (10,
-- allow_in_booking, con reservas) asociado al servicio, b1 y b2 sin catálogo propio.
begin;
select plan(24);

create temp table fx on commit drop as select tests.create_tenant('cat-co') as a;
alter table fx add column other jsonb, add column staff uuid, add column created uuid;
update fx set other = tests.create_tenant('cat-otra'), staff = tests.create_user('staff-cat@test.local');
insert into public.company_members (company_id, user_id, role)
select (a ->> 'company')::uuid, staff, 'staff' from fx;
grant select, update on fx to authenticated;

create function pg_temp.fx(p_key text) returns uuid language sql as $$ select (a ->> p_key)::uuid from fx $$;
grant execute on function pg_temp.fx(text) to authenticated;

select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));

-- effective_catalog -----------------------------------------------------------
select results_eq(
  format($$select name, base_price, discount_amount, final_price from public.effective_catalog(%L)
           where kind = 'service'$$, pg_temp.fx('b1')),
  $$values ('Servicio'::text, 100::numeric, 10::numeric, 90::numeric)$$,
  'el servicio sale con su descuento vigente (-10 %)');

select results_eq(
  format($$select final_price from public.effective_catalog(%L, now() + interval '2 days')
           where kind = 'service'$$, pg_temp.fx('b1')),
  $$values (100::numeric)$$,
  'pasada la fecha límite el precio vuelve al base');

select is(
  (select count(*)::int from public.effective_catalog(pg_temp.fx('b1')) where kind = 'product'),
  1, 'el producto activo también está en el catálogo');

-- effective_addons --------------------------------------------------------------
select results_eq(
  format('select name, final_price, max_quantity from public.effective_addons(%L, %L)',
    pg_temp.fx('service'), pg_temp.fx('b1')),
  $$values ('Producto'::text, 10::numeric, 10)$$,
  'el producto asociado con allow_in_booking es un add-on');

update public.catalog_items set stock = 3 where id = pg_temp.fx('product');
select is(
  (select max_quantity from public.effective_addons(pg_temp.fx('service'), pg_temp.fx('b1'))),
  3, 'la cantidad máxima no supera el stock');

update public.catalog_items set stock = 0 where id = pg_temp.fx('product');
select is_empty(
  format('select 1 from public.effective_addons(%L, %L)', pg_temp.fx('service'), pg_temp.fx('b1')),
  'un producto sin stock no se ofrece');

update public.catalog_items set stock = null, allow_in_booking = false where id = pg_temp.fx('product');
select is_empty(
  format('select 1 from public.effective_addons(%L, %L)', pg_temp.fx('service'), pg_temp.fx('b1')),
  'un producto con allow_in_booking = false no aparece como add-on');
update public.catalog_items set allow_in_booking = true where id = pg_temp.fx('product');

-- Inactivo ----------------------------------------------------------------------
update public.catalog_items set is_active = false where id = pg_temp.fx('service');
select is_empty(
  format($$select 1 from public.effective_catalog(%L) where item_id = %L$$, pg_temp.fx('b1'), pg_temp.fx('service')),
  'inactivar un servicio lo oculta de effective_catalog');
select is_empty(
  format('select 1 from public.effective_addons(%L, %L)', pg_temp.fx('service'), pg_temp.fx('b1')),
  'un servicio inactivo no tiene add-ons');
update public.catalog_items set is_active = true where id = pg_temp.fx('service');

-- Catálogo propio de sede ---------------------------------------------------------
update public.branches set own_catalog = true where id = pg_temp.fx('b2');
update public.branch_catalog_items set price_override = 80
where branch_id = pg_temp.fx('b2') and item_id = pg_temp.fx('service');

select results_eq(
  format($$select base_price, discount_amount, final_price from public.effective_catalog(%L)
           where item_id = %L$$, pg_temp.fx('b2'), pg_temp.fx('service')),
  $$values (80::numeric, 8::numeric, 72::numeric)$$,
  'sede con catálogo propio usa su precio (y el descuento se calcula sobre él)');

select results_eq(
  format($$select base_price from public.effective_catalog(%L) where item_id = %L$$,
    pg_temp.fx('b1'), pg_temp.fx('service')),
  $$values (100::numeric)$$,
  'la sede sin catálogo propio ignora branch_catalog_items');

update public.branch_catalog_items set is_active = false
where branch_id = pg_temp.fx('b2') and item_id = pg_temp.fx('product');
select is_empty(
  format($$select 1 from public.effective_catalog(%L) where item_id = %L$$, pg_temp.fx('b2'), pg_temp.fx('product')),
  'no disponible en la sede con catálogo propio → no aparece');

-- Un descuento solo de b1 no aplica en b2.
insert into public.discounts (company_id, item_id, type, value, ends_at, branch_id)
values (pg_temp.fx('company'), pg_temp.fx('service'), 'fixed', 50, now() + interval '1 day', pg_temp.fx('b1'));
select results_eq(
  format($$select (select final_price from public.effective_catalog(%L) where item_id = %3$L),
                  (select final_price from public.effective_catalog(%2$L) where item_id = %3$L)$$,
    pg_temp.fx('b1'), pg_temp.fx('b2'), pg_temp.fx('service')),
  $$values (50::numeric, 72::numeric)$$,
  'un descuento de sede solo aplica en esa sede');

-- upsert_catalog_item -----------------------------------------------------------
update fx set created = public.upsert_catalog_item(jsonb_build_object(
  'company_id', pg_temp.fx('company'), 'kind', 'service', 'name', 'Masaje', 'reference', 'SRV-1',
  'price', 50000, 'duration_minutes', 60, 'capacity', 1, 'is_active', true,
  'details', jsonb_build_array(
    jsonb_build_object('label', 'Incluye', 'value', 'Toalla'),
    jsonb_build_object('label', 'Duración', 'value', '60 min'),
    jsonb_build_object('label', 'Aceites')),
  'photos', jsonb_build_array(
    jsonb_build_object('path', pg_temp.fx('company') || '/catalog/a.webp', 'alt', 'Sala', 'is_cover', false),
    jsonb_build_object('path', pg_temp.fx('company') || '/catalog/b.webp', 'alt', 'Camilla', 'is_cover', true)),
  'discounts', jsonb_build_array(jsonb_build_object(
    'id', '00000000-0000-4000-a000-0000000000e1', 'label', 'Lanzamiento', 'type', 'percent', 'value', 15,
    'ends_at', now() + interval '1 day')),
  'products', jsonb_build_array(jsonb_build_object('product_id', pg_temp.fx('product'), 'max_quantity', 2)),
  'branches', jsonb_build_array(jsonb_build_object('branch_id', pg_temp.fx('b2'), 'is_active', true))
));

select results_eq(
  format($$select (select count(*)::int from public.catalog_item_details where item_id = %1$L),
                  (select count(*)::int from public.catalog_item_photos where item_id = %1$L),
                  (select count(*)::int from public.discounts where item_id = %1$L),
                  (select count(*)::int from public.service_products where service_id = %1$L),
                  (select count(*)::int from public.branch_catalog_items where item_id = %1$L)$$,
    (select created from fx)),
  $$values (3, 2, 1, 1, 1)$$,
  'upsert crea el ítem con detalles, fotos, descuento, producto y sede');

select results_eq(
  format($$select final_price, cover_alt from public.effective_catalog(%L) where item_id = %L$$,
    pg_temp.fx('b2'), (select created from fx)),
  $$values (42500::numeric, 'Camilla'::text)$$,
  'el ítem nuevo sale con -15 % y su portada');

select lives_ok(
  format($$select public.upsert_catalog_item(jsonb_build_object(
    'id', %L, 'name', 'Masaje largo', 'reference', 'SRV-1', 'price', 60000, 'duration_minutes', 90,
    'details', jsonb_build_array(jsonb_build_object('label', 'Solo uno')),
    'discounts', (select jsonb_agg(to_jsonb(d)) from public.discounts d where d.item_id = %1$L)))$$,
    (select created from fx)),
  'upsert actualiza y reemplaza las listas presentes');

select results_eq(
  format($$select ci.name, ci.price, (select count(*)::int from public.catalog_item_details where item_id = ci.id),
                  (select count(*)::int from public.catalog_item_photos where item_id = ci.id),
                  (select id from public.discounts where item_id = ci.id)
           from public.catalog_items ci where ci.id = %L$$, (select created from fx)),
  $$values ('Masaje largo'::text, 60000::numeric, 1, 2, '00000000-0000-4000-a000-0000000000e1'::uuid)$$,
  'las listas ausentes del payload (fotos) quedan intactas y los descuentos conservan su id');

select throws_ok(
  format($$select public.upsert_catalog_item(jsonb_build_object(
    'company_id', %L, 'kind', 'product', 'name', 'Otro', 'reference', 'SRV-1', 'price', 1))$$,
    pg_temp.fx('company')),
  '23505', null,
  'la referencia es única en la empresa');

select throws_ok(
  format($$select public.upsert_catalog_item(jsonb_build_object('id', %L, 'name', 'X', 'price', 1))$$,
    (select other ->> 'service' from fx)),
  '42501', null,
  'no se puede editar un ítem de otra empresa');

select throws_ok(
  format($$select public.upsert_catalog_item(jsonb_build_object(
    'company_id', %L, 'kind', 'product', 'name', 'X', 'price', 1))$$,
    (select other ->> 'company' from fx)),
  '42501', null,
  'no se puede crear un ítem en otra empresa');

-- Borrar ------------------------------------------------------------------------
select throws_ok(
  format('delete from public.catalog_items where id = %L', pg_temp.fx('service')),
  'P0001', '"Servicio" tiene reservas: inactívalo en lugar de borrarlo',
  'un servicio con reservas no se borra');

select throws_ok(
  format('delete from public.catalog_items where id = %L', pg_temp.fx('product')),
  'P0001', null,
  'un producto vendido en una reserva no se borra');

-- Orden -------------------------------------------------------------------------
select lives_ok(
  format($$select public.reorder_rows('catalog_items', array[%L, %L]::uuid[])$$,
    (select created from fx), pg_temp.fx('service')),
  'reorder_rows ordena el catálogo');

-- Staff -------------------------------------------------------------------------
select tests.authenticate_as((select staff from fx));
select throws_ok(
  format($$select public.upsert_catalog_item(jsonb_build_object(
    'company_id', %L, 'kind', 'product', 'name', 'X', 'price', 1))$$,
    pg_temp.fx('company')),
  '42501', null,
  'staff no edita el catálogo');

select * from finish();
rollback;
