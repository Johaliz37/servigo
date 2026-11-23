-- Restricciones de negocio (CHECK y triggers de validación).
begin;
select plan(22);

create temp table fx on commit drop as select tests.create_tenant('cons-co') as a;
alter table fx add column superadmin uuid;
update fx set superadmin = tests.create_user('root@test.local');
insert into public.platform_admins (user_id) select superadmin from fx;
grant select on fx to authenticated;

-- Catálogo ---------------------------------------------------------------------
select throws_ok(
  format($$insert into public.catalog_items (company_id, kind, name, price) values (%L, 'service', 'x', 1)$$,
         (select a ->> 'company' from fx)),
  '23514', null, 'servicio sin duración falla');

select throws_ok(
  format($$insert into public.catalog_items (company_id, kind, name, price, duration_minutes) values (%L, 'product', 'x', 1, 30)$$,
         (select a ->> 'company' from fx)),
  '23514', null, 'producto con duración falla');

select throws_ok(
  format($$insert into public.catalog_items (company_id, kind, name, price, duration_minutes) values (%L, 'service', 'x', -1, 30)$$,
         (select a ->> 'company' from fx)),
  '23514', null, 'precio negativo falla');

select throws_ok(
  format($$insert into public.discounts (company_id, item_id, type, value, ends_at) values (%L, %L, 'percent', 101, now() + interval '1 day')$$,
         (select a ->> 'company' from fx), (select a ->> 'service' from fx)),
  '23514', null, 'porcentaje > 100 falla');

select lives_ok(
  format($$insert into public.discounts (company_id, item_id, type, value, ends_at) values (%L, %L, 'percent', 100, now() + interval '1 day')$$,
         (select a ->> 'company' from fx), (select a ->> 'service' from fx)),
  'porcentaje = 100 se acepta');

select throws_ok(
  format($$insert into public.discounts (company_id, item_id, type, value, starts_at, ends_at)
           values (%L, %L, 'fixed', 1, now() + interval '2 days', now() + interval '1 day')$$,
         (select a ->> 'company' from fx), (select a ->> 'service' from fx)),
  '23514', null, 'descuento que empieza después de terminar falla');

-- Fotos: el fixture trae 1; se admiten hasta 8.
select lives_ok(
  format($$insert into public.catalog_item_photos (company_id, item_id, path)
           select %L, %L, 'p' || n || '.webp' from generate_series(2, 8) n$$,
         (select a ->> 'company' from fx), (select a ->> 'service' from fx)),
  'hasta 8 fotos por ítem');

select throws_ok(
  format($$insert into public.catalog_item_photos (company_id, item_id, path) values (%L, %L, 'p9.webp')$$,
         (select a ->> 'company' from fx), (select a ->> 'service' from fx)),
  '23514', null, 'la 9.ª foto falla');

-- Slugs ------------------------------------------------------------------------
select throws_ok($$insert into public.companies (slug, name) values ('www', 'x')$$, '23514', null, 'slug reservado falla');

insert into public.reserved_slugs (slug, reason) values ('Agenda', 'roquintech_product');
select throws_ok($$insert into public.companies (slug, name) values ('agenda', 'x')$$, '23514', null,
  'slug reservado se compara sin mayúsculas');

select throws_ok($$insert into public.companies (slug, name) values ('a--b', 'x')$$, '23514', null, 'slug con -- falla');
select throws_ok($$insert into public.companies (slug, name) values ('ab', 'x')$$, '23514', null, 'slug de 2 caracteres falla');
select throws_ok($$insert into public.companies (slug, name) values ('Mayus', 'x')$$, '23514', null, 'slug con mayúsculas falla');

-- Otros formatos ---------------------------------------------------------------
select throws_ok(
  format($$insert into public.customers (company_id, name, phone) values (%L, 'x', '3001234567')$$, (select a ->> 'company' from fx)),
  '23514', null, 'teléfono que no es E.164 falla');

select throws_ok(
  format($$update public.companies set timezone = 'Marte/Olympus' where id = %L$$, (select a ->> 'company' from fx)),
  '23514', null, 'zona horaria inválida falla');

select throws_ok(
  format($$update public.companies set primary_color = 'rojo' where id = %L$$, (select a ->> 'company' from fx)),
  '23514', null, 'color que no es #RRGGBB falla');

select throws_ok(
  format($$insert into public.booking_fields (company_id, label, type) values (%L, 'x', 'select')$$, (select a ->> 'company' from fx)),
  '23514', null, 'campo de lista sin opciones falla');

select ok(public.generate_booking_code() ~ '^[0-9A-HJKMNP-TV-Z]{8}$', 'código de reserva Crockford sin I L O U');

-- Campos que solo cambia el superadmin -----------------------------------------
select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));

select throws_ok(
  format($$update public.companies set slug = 'otro-slug' where id = %L$$, (select a ->> 'company' from fx)),
  '42501', null, 'owner no cambia el slug');

select throws_ok(
  format($$update public.companies set status = 'suspended' where id = %L$$, (select a ->> 'company' from fx)),
  '42501', null, 'owner no cambia el estado');

select lives_ok(
  format($$update public.companies set name = 'Nuevo nombre' where id = %L$$, (select a ->> 'company' from fx)),
  'owner cambia el nombre');

select tests.authenticate_as((select superadmin from fx));

select lives_ok(
  format($$update public.companies set status = 'suspended' where id = %L$$, (select a ->> 'company' from fx)),
  'superadmin suspende la empresa');

select tests.clear_authentication();
select * from finish();
rollback;
