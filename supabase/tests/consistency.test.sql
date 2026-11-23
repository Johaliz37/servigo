-- Referencias cruzadas entre empresas: los triggers las rechazan aunque las FK existan.
begin;
select plan(11);

create temp table fx on commit drop as
select tests.create_tenant('cons-a') as a, tests.create_tenant('cons-b') as b;
grant select on fx to authenticated;

-- Como postgres (sin RLS): el trigger es la única defensa.
select throws_ok(
  format($$insert into public.catalog_item_photos (company_id, item_id, path) values (%L, %L, 'x.webp')$$,
         (select a ->> 'company' from fx), (select b ->> 'service' from fx)),
  '23503', null, 'foto con company_id distinto al del ítem falla');

select throws_ok(
  format($$insert into public.bookings (company_id, branch_id, service_id, customer_id, starts_at, ends_at,
             block_starts_at, block_ends_at, customer_name, customer_phone, service_name, service_price, total, currency)
           values (%L, %L, %L, %L, now(), now() + interval '30 minutes', now(), now() + interval '30 minutes',
                   'x', '+573000000001', 'x', 1, 1, 'COP')$$,
         (select a ->> 'company' from fx), (select b ->> 'b1' from fx),
         (select a ->> 'service' from fx), (select a ->> 'customer' from fx)),
  '23503', null, 'reserva en una sede de otra empresa falla');

select throws_ok(
  format($$update public.company_members set role = 'staff', branch_ids = array[%L::uuid] where user_id = %L$$,
         (select b ->> 'b1' from fx), (select a ->> 'owner' from fx)),
  '23503', null, 'branch_ids con una sede de otra empresa falla');

select throws_ok(
  format($$update public.company_members set branch_ids = array[gen_random_uuid()] where user_id = %L$$,
         (select a ->> 'owner' from fx)),
  '23503', null, 'branch_ids con una sede inexistente falla');

select throws_ok(
  format($$update public.availability_events set service_ids = array[%L::uuid] where id = %L$$,
         (select b ->> 'service' from fx), (select a ->> 'event_company' from fx)),
  '23503', null, 'service_ids con un servicio de otra empresa falla');

select throws_ok(
  format($$update public.catalog_items set company_id = %L where id = %L$$,
         (select b ->> 'company' from fx), (select a ->> 'service' from fx)),
  '23514', null, 'company_id no se puede cambiar');

select throws_ok(
  format($$insert into public.service_products (company_id, service_id, product_id) values (%L, %L, %L)$$,
         (select a ->> 'company' from fx), (select a ->> 'product' from fx), (select a ->> 'service' from fx)),
  '23514', null, 'service_products exige servicio y producto en su lugar');

select throws_ok(
  format($$insert into public.booking_items (company_id, booking_id, product_id, name, unit_price, quantity, line_total)
           values (%L, %L, %L, 'x', 1, 1, 1)$$,
         (select a ->> 'company' from fx), (select a ->> 'booking1' from fx), (select a ->> 'service' from fx)),
  '23514', null, 'booking_items solo admite productos');

select lives_ok(
  format($$insert into public.catalog_item_details (company_id, item_id, label) values (%L, %L, 'ok')$$,
         (select a ->> 'company' from fx), (select a ->> 'service' from fx)),
  'una referencia de la misma empresa funciona');

-- Como owner de A: RLS deja pasar (company_id = A), el trigger detecta el ítem de B.
select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));

select throws_ok(
  format($$insert into public.catalog_item_photos (company_id, item_id, path) values (%L, %L, 'x.webp')$$,
         (select a ->> 'company' from fx), (select b ->> 'service' from fx)),
  '23503', null, 'owner A no engancha una foto a un ítem de B');

select throws_ok(
  format($$insert into public.discounts (company_id, item_id, type, value, ends_at) values (%L, %L, 'fixed', 1, now() + interval '1 day')$$,
         (select a ->> 'company' from fx), (select b ->> 'service' from fx)),
  '23503', null, 'owner A no crea descuentos sobre ítems de B');

select tests.clear_authentication();
select * from finish();
rollback;
