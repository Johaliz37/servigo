-- Helpers de pruebas. pg_prove ejecuta los archivos en orden alfabético: este va primero
-- y NO hace rollback, para que los helpers existan en los demás archivos.
-- Solo vive en la BD local/CI (las pruebas nunca corren contra producción).

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- Crea un usuario de auth y devuelve su id.
create or replace function tests.create_user(p_email text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email, now(), now());
  return v_id;
end;
$$;

-- Actúa como un usuario autenticado (equivalente a una petición con su JWT).
create or replace function tests.authenticate_as(p_user uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Actúa como visitante anónimo (publishable key sin sesión).
create or replace function tests.authenticate_as_anon()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Vuelve al rol del test (postgres, sin RLS).
create or replace function tests.clear_authentication()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Crea una empresa con una fila en CADA tabla de tenant y devuelve los ids.
-- Se ejecuta como postgres (sin RLS).
create or replace function tests.create_tenant(p_slug text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_company uuid;
  v_owner uuid := tests.create_user(p_slug || '-owner@test.local');
  v_b1 uuid;
  v_b2 uuid;
  v_service uuid;
  v_product uuid;
  v_field uuid;
  v_customer uuid;
  v_booking1 uuid;
  v_booking2 uuid;
  v_event_company uuid;
  v_event_b2 uuid;
begin
  insert into public.companies (slug, name) values (p_slug, 'Empresa ' || p_slug) returning id into v_company;
  insert into public.company_members (company_id, user_id, role) values (v_company, v_owner, 'owner');
  insert into public.company_invitations (company_id, email, role) values (v_company, 'nuevo@' || p_slug || '.test', 'staff');

  insert into public.branches (company_id, slug, name) values (v_company, 'sede-1', 'Sede 1') returning id into v_b1;
  insert into public.branches (company_id, slug, name) values (v_company, 'sede-2', 'Sede 2') returning id into v_b2;

  insert into public.about_sections (company_id, title) values (v_company, 'Acerca');
  insert into public.sponsors (company_id, branch_id, name) values (v_company, v_b1, 'Patrocinador');
  insert into public.social_links (company_id, network, url) values (v_company, 'instagram', 'https://instagram.com/x');

  insert into public.catalog_items (company_id, kind, name, price, duration_minutes)
  values (v_company, 'service', 'Servicio', 100, 30) returning id into v_service;
  insert into public.catalog_items (company_id, kind, name, price, allow_in_booking)
  values (v_company, 'product', 'Producto', 10, true) returning id into v_product;
  insert into public.catalog_item_details (company_id, item_id, label) values (v_company, v_service, 'Detalle');
  insert into public.catalog_item_photos (company_id, item_id, path) values (v_company, v_service, v_company || '/items/a.webp');
  insert into public.discounts (company_id, item_id, type, value, ends_at)
  values (v_company, v_service, 'percent', 10, now() + interval '1 day');
  insert into public.service_products (company_id, service_id, product_id) values (v_company, v_service, v_product);
  insert into public.branch_catalog_items (company_id, branch_id, item_id) values (v_company, v_b1, v_service);

  insert into public.booking_fields (company_id, label, type) values (v_company, 'Notas', 'text') returning id into v_field;

  insert into public.availability_events (company_id, branch_id, kind, starts_at, ends_at)
  values (v_company, null, 'open', now(), now() + interval '8 hours') returning id into v_event_company;
  insert into public.availability_events (company_id, branch_id, kind, starts_at, ends_at)
  values (v_company, v_b2, 'open', now(), now() + interval '8 hours') returning id into v_event_b2;

  insert into public.customers (company_id, name, phone) values (v_company, 'Cliente', '+573000000001')
  returning id into v_customer;

  insert into public.bookings (
    company_id, branch_id, service_id, customer_id, starts_at, ends_at, block_starts_at, block_ends_at,
    customer_name, customer_phone, service_name, service_price, total, currency
  )
  values (v_company, v_b1, v_service, v_customer, now(), now() + interval '30 minutes', now(), now() + interval '30 minutes',
          'Cliente', '+573000000001', 'Servicio', 100, 100, 'COP')
  returning id into v_booking1;

  insert into public.bookings (
    company_id, branch_id, service_id, customer_id, starts_at, ends_at, block_starts_at, block_ends_at,
    customer_name, customer_phone, service_name, service_price, total, currency
  )
  values (v_company, v_b2, v_service, v_customer, now(), now() + interval '30 minutes', now(), now() + interval '30 minutes',
          'Cliente', '+573000000001', 'Servicio', 100, 100, 'COP')
  returning id into v_booking2;

  insert into public.booking_items (company_id, booking_id, product_id, name, unit_price, quantity, line_total)
  values (v_company, v_booking1, v_product, 'Producto', 10, 1, 10);
  insert into public.booking_answers (company_id, booking_id, field_id, label, type, value)
  values (v_company, v_booking1, v_field, 'Notas', 'text', '"hola"');
  insert into public.booking_events (company_id, booking_id, action) values (v_company, v_booking1, 'created');

  return jsonb_build_object(
    'company', v_company, 'owner', v_owner, 'b1', v_b1, 'b2', v_b2,
    'service', v_service, 'product', v_product, 'field', v_field, 'customer', v_customer,
    'booking1', v_booking1, 'booking2', v_booking2,
    'event_company', v_event_company, 'event_b2', v_event_b2
  );
end;
$$;

-- Tablas de tenant (tienen company_id) para las pruebas que recorren todo el esquema.
create or replace function tests.tenant_tables()
returns setof text
language sql
stable
set search_path = ''
as $$
  select c.table_name::text
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and c.column_name = 'company_id' and t.table_type = 'BASE TABLE'
  order by 1;
$$;

-- Ejecuta un UPDATE/DELETE con el rol actual y devuelve cuántas filas afectó.
-- (RLS no lanza error en update/delete: filtra filas. La prueba es que afecte 0.)
create or replace function tests.affected_rows(p_sql text)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
exception when insufficient_privilege then
  -- Sin privilegio de tabla (p. ej. bookings solo cambia por RPC, D29): no modifica nada.
  return 0;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

select plan(1);
select pass('helpers de pruebas instalados');
select * from finish();
