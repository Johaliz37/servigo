-- Fase 10: create_booking revalida todo en SQL (cupo, productos, stock, servicio, sede,
-- datos y respuestas), calcula precios con effective_catalog/addons y deja historial.
-- create_tenant deja: servicio de 100 con -10 %, capacidad 1 y 30 min; producto de 10
-- (allow_in_booking, sin stock) asociado al servicio (máx. 10); campo general «Notas» (texto).
-- La concurrencia real (dos peticiones a la vez) la prueba la E2E; aquí, el mismo cupo dos veces.
begin;
select plan(36);

create temp table fx on commit drop as select tests.create_tenant('bk-co') as a;
alter table fx add column other jsonb, add column at timestamptz;
update fx set other = tests.create_tenant('bk-otra'),
              at = date_trunc('hour', now()) + interval '3 days';

create function pg_temp.fx(p_key text) returns uuid language sql as $$ select (a ->> p_key)::uuid from fx $$;
create function pg_temp.other(p_key text) returns uuid language sql as $$ select (other ->> p_key)::uuid from fx $$;
create function pg_temp.at(p_hours int default 0) returns timestamptz language sql as $$
  select at + make_interval(hours => p_hours) from fx $$;

-- Payload base: se modifica con || en cada caso.
create function pg_temp.payload(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'company_id', pg_temp.fx('company'), 'branch_id', pg_temp.fx('b1'), 'service_id', pg_temp.fx('service'),
    'starts_at', pg_temp.at(), 'capacity', 1,
    'customer', jsonb_build_object('name', 'Juan Pérez', 'phone', '+573001234567', 'email', 'juan@test.local'),
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.fx('product'), 'quantity', 2)),
    'answers', jsonb_build_array(jsonb_build_object('field_id', pg_temp.fx('field'), 'value', 'Sin gel')),
    'privacy_consent', true
  ) || p_extra $$;

create temp table res (k text primary key, v jsonb) on commit drop;
grant select on fx to anon;
grant execute on function pg_temp.fx(text) to anon;

-- Permisos ----------------------------------------------------------------------
select tests.authenticate_as_anon();
select throws_ok($$select public.create_booking('{}')$$, '42501', null, 'anon no crea reservas directo en la BD');
select throws_ok($$select public.find_bookings(null, '+573001234567')$$, '42501', null, 'anon no busca reservas');
select isnt(public.get_booking_form('bk-co', 'sede-1', pg_temp.fx('service')), null, 'anon lee el formulario de reserva');
select tests.clear_authentication();

-- Reserva correcta -------------------------------------------------------------------
insert into res values ('ok', public.create_booking(pg_temp.payload()));
select matches((select v ->> 'code' from res where k = 'ok'), '^[0-9A-HJKMNP-TV-Z]{8}$', 'devuelve un código Crockford de 8');
select is((select v ->> 'status' from res where k = 'ok'), 'pending', 'sin auto_confirm queda pendiente');
select results_eq(
  $$select service_price, service_discount, products_total, discount_total, total, ends_at - starts_at,
           block_ends_at - block_starts_at
    from public.bookings where id = (select (v ->> 'id')::uuid from res where k = 'ok')$$,
  $$values (100::numeric, 10::numeric, 20::numeric, 10::numeric, 110::numeric, interval '30 minutes', interval '30 minutes')$$,
  'precios de effective_catalog: 100 − 10 + 2 × 10 = 110');
select results_eq(
  $$select name, unit_price, discount, quantity, line_total from public.booking_items
    where booking_id = (select (v ->> 'id')::uuid from res where k = 'ok')$$,
  $$values ('Producto'::text, 10::numeric, 0::numeric, 2, 20::numeric)$$,
  'línea del producto con su snapshot');
select results_eq(
  $$select label, type::text, value from public.booking_answers
    where booking_id = (select (v ->> 'id')::uuid from res where k = 'ok')$$,
  $$values ('Notas'::text, 'text'::text, '"Sin gel"'::jsonb)$$,
  'respuesta guardada con copia de label y tipo');
select is((select count(*)::int from public.booking_events
           where booking_id = (select (v ->> 'id')::uuid from res where k = 'ok') and action = 'created'), 1,
  'historial: created');
select is((select name from public.customers where company_id = pg_temp.fx('company') and phone = '+573001234567'),
  'Juan Pérez', 'cliente creado por teléfono');

-- Cupo ----------------------------------------------------------------------------------
select throws_ok($$select public.create_booking(pg_temp.payload('{"customer": {"name": "Ana", "phone": "+573009999999"}}'))$$,
  'SV001', 'SLOT_TAKEN', 'el mismo cupo con capacidad 1 → SLOT_TAKEN');
select throws_ok(
  format($$select public.create_booking(pg_temp.payload(jsonb_build_object('starts_at', %L::timestamptz)))$$,
         pg_temp.at() + interval '15 minutes'),
  'SV001', 'SLOT_TAKEN', 'un bloque que se solapa también cuenta');
select lives_ok($$select public.create_booking(pg_temp.payload('{"capacity": 2, "items": []}'))$$,
  'con capacidad 2 (override de la ventana) entra una segunda');
select throws_ok(
  format($$select public.create_booking(pg_temp.payload(jsonb_build_object('starts_at', %L::timestamptz)))$$,
         now() - interval '1 hour'),
  'SV001', null, 'en el pasado → rechazada');
select lives_ok(
  format($$select public.create_booking(pg_temp.payload(jsonb_build_object('branch_id', %L::uuid, 'items', '[]'::jsonb)))$$,
         pg_temp.fx('b2')),
  'el mismo horario en otra sede es otro cupo');

-- Productos -----------------------------------------------------------------------------
insert into public.catalog_items (company_id, kind, name, price, allow_in_booking)
values (pg_temp.fx('company'), 'product', 'Suelto', 5, true);
select throws_ok(
  format($$select public.create_booking(pg_temp.payload(jsonb_build_object('starts_at', %L::timestamptz,
           'items', jsonb_build_array(jsonb_build_object('product_id', %L::uuid, 'quantity', 1)))))$$,
         pg_temp.at(1), (select id from public.catalog_items where name = 'Suelto')),
  'SV002', null, 'un producto que no es complemento del servicio → rechazado');
select throws_ok(
  format($$select public.create_booking(pg_temp.payload(jsonb_build_object('starts_at', %L::timestamptz,
           'items', jsonb_build_array(jsonb_build_object('product_id', %L::uuid, 'quantity', 11)))))$$,
         pg_temp.at(1), pg_temp.fx('product')),
  'SV002', null, 'más de la cantidad máxima → rechazada');
select throws_ok(
  format($$select public.create_booking(pg_temp.payload(jsonb_build_object('starts_at', %L::timestamptz,
           'items', jsonb_build_array(jsonb_build_object('product_id', %L::uuid, 'quantity', 1),
                                      jsonb_build_object('product_id', %L::uuid, 'quantity', 1)))))$$,
         pg_temp.at(1), pg_temp.fx('product'), pg_temp.fx('product')),
  'SV002', null, 'producto repetido → rechazado');
update public.catalog_items set stock = 3 where id = pg_temp.fx('product');
select throws_ok(
  format($$select public.create_booking(pg_temp.payload(jsonb_build_object('starts_at', %L::timestamptz,
           'items', jsonb_build_array(jsonb_build_object('product_id', %L::uuid, 'quantity', 4)))))$$,
         pg_temp.at(1), pg_temp.fx('product')),
  'SV002', null, 'sin stock suficiente → rechazada');
insert into res values ('stock', public.create_booking(pg_temp.payload(jsonb_build_object('starts_at', pg_temp.at(1)))));
select is((select stock from public.catalog_items where id = pg_temp.fx('product')), 1, 'el stock se descuenta (3 − 2)');

-- Servicio y sede ------------------------------------------------------------------------
select throws_ok(
  format($$select public.create_booking(pg_temp.payload(jsonb_build_object('branch_id', %L::uuid)))$$, pg_temp.other('b1')),
  'SV004', null, 'sede de otra empresa → rechazada');
update public.catalog_items set is_active = false where id = pg_temp.fx('service');
select throws_ok(
  format($$select public.create_booking(pg_temp.payload(jsonb_build_object('starts_at', %L::timestamptz, 'items', '[]'::jsonb)))$$,
         pg_temp.at(5)),
  'SV004', null, 'servicio inactivo → rechazado');
update public.catalog_items set is_active = true where id = pg_temp.fx('service');

-- Datos y respuestas --------------------------------------------------------------------
create function pg_temp.try_at(p_hours int, p_extra jsonb) returns jsonb language sql as $$
  select public.create_booking(pg_temp.payload(jsonb_build_object('starts_at', pg_temp.at(p_hours), 'items', '[]'::jsonb) || p_extra)) $$;
select throws_ok($$select pg_temp.try_at(6, '{"customer": {"name": "Ana", "phone": "3001234567"}}')$$,
  'SV003', 'Teléfono no válido', 'teléfono sin formato E.164 → rechazado');
update public.companies set booking_settings = booking_settings || '{"require_email": true}' where id = pg_temp.fx('company');
select throws_ok($$select pg_temp.try_at(6, '{"customer": {"name": "Ana", "phone": "+573001111111"}}')$$,
  'SV003', 'El correo es obligatorio', 'require_email exige correo');
update public.booking_fields set required = true, validation = '{"pattern": "[a-z ]+"}' where id = pg_temp.fx('field');
select throws_ok($$select pg_temp.try_at(6, '{"answers": []}')$$, 'SV003', null, 'campo obligatorio vacío → rechazado');
select throws_ok($$select pg_temp.try_at(6, '{"answers": [{"field_id": "00000000-0000-0000-0000-000000000000", "value": "x"}]}')$$,
  'SV003', null, 'un campo desconocido no cuenta como respuesta');
select throws_ok(format($$select pg_temp.try_at(6, '{"answers": [{"field_id": "%s", "value": "Con Gel 2"}]}')$$, pg_temp.fx('field')),
  'SV003', null, 'patrón anclado: «Con Gel 2» no cumple [a-z ]+');
insert into public.booking_fields (company_id, label, type, options, required)
values (pg_temp.fx('company'), 'Tipo', 'select', '[{"value": "a", "label": "A"}]', false);
select throws_ok(
  format($$select pg_temp.try_at(6, '{"answers": [{"field_id": "%s", "value": "sin gel"}, {"field_id": "%s", "value": "zz"}]}')$$,
         pg_temp.fx('field'), (select id from public.booking_fields where label = 'Tipo')),
  'SV003', null, 'opción que no existe → rechazada');

-- Auto-confirmación ------------------------------------------------------------------------
update public.companies set booking_settings = booking_settings || '{"auto_confirm": true}' where id = pg_temp.fx('company');
insert into res values ('auto', pg_temp.try_at(7, format('{"answers": [{"field_id": "%s", "value": "sin gel"}]}', pg_temp.fx('field'))::jsonb));
select is((select v ->> 'status' from res where k = 'auto'), 'confirmed', 'con auto_confirm queda confirmada');

-- Consulta ------------------------------------------------------------------------------------
select is(public.mask_name(' Juan  Pérez '), 'Ju*** Pé***', 'nombre enmascarado');
select is(
  public.get_booking_public(pg_temp.fx('company'), lower((select v ->> 'code' from res where k = 'ok'))) ->> 'total',
  '110.00', 'detalle por código (sin distinguir mayúsculas)');
select is(public.get_booking_public(pg_temp.other('company'), (select v ->> 'code' from res where k = 'ok')), null,
  'el código no existe en otra empresa');
select is(
  (select count(*)::int from jsonb_array_elements(public.find_bookings(pg_temp.fx('company'), '+573001234567')) x
   where x ->> 'customer_name' = 'Ju*** Pé***'),
  5, 'búsqueda por teléfono: solo datos mínimos y nombre enmascarado');

-- Cancelación ---------------------------------------------------------------------------------
select throws_ok(format($$select public.cancel_booking_public(%L, %L)$$, pg_temp.fx('company'), (select v ->> 'code' from res where k = 'ok')),
  'SV005', 'Esta empresa no permite cancelar en línea', 'sin allow_customer_cancel no se cancela');
update public.companies set booking_settings = booking_settings || '{"allow_customer_cancel": true, "cancel_limit_hours": 24}'
where id = pg_temp.fx('company');
select is(public.cancel_booking_public(pg_temp.fx('company'), (select v ->> 'code' from res where k = 'stock')) ->> 'status',
  'cancelled', 'con el permiso y fuera del plazo, se cancela');
select is((select stock from public.catalog_items where id = pg_temp.fx('product')), 3, 'al cancelar vuelve el stock');

select * from finish();
rollback;
