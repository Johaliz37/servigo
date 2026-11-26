-- Fase 13: auditoría de seguridad del esquema (RLS, políticas, privilegios de anon, search_path
-- de las funciones security definer) y derechos sobre los datos (D31): política de privacidad
-- pública, autorización obligatoria en la reserva web y anonimización de un cliente.
-- create_tenant deja booking1 y booking2 del mismo cliente («customer»).
begin;
select plan(23);

-- Auditoría del esquema (vale para tablas y funciones futuras; anon.test.sql cubre los
-- privilegios de anon y su lista cerrada de RPC) ------------------------------------------
select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  null, 'toda tabla de public tiene RLS');

select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  null, 'toda tabla de public tiene al menos una política');

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not coalesce(p.proconfig @> array['search_path=""'], false)),
  null, 'toda función security definer fija search_path = ''''');

select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and not p.proname like 'get\_%' and p.proname <> 'ping'
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'ninguna función definer de escritura es ejecutable por anon');

-- Fixture ------------------------------------------------------------------------------------
create temp table fx on commit drop as select tests.create_tenant('pv-co') as a;
alter table fx add column other jsonb, add column admin uuid, add column at timestamptz;
update fx set other = tests.create_tenant('pv-otra'),
              admin = tests.create_user('pv-admin@test.local'),
              at = date_trunc('hour', now()) + interval '3 days';
insert into public.company_members (company_id, user_id, role)
select (a ->> 'company')::uuid, admin, 'admin'::public.member_role from fx;

create function pg_temp.fx(p_key text) returns uuid language sql as $$ select (a ->> p_key)::uuid from fx $$;
create function pg_temp.other(p_key text) returns uuid language sql as $$ select (other ->> p_key)::uuid from fx $$;
grant select on fx to anon, authenticated;
grant execute on function pg_temp.fx(text), pg_temp.other(text) to anon, authenticated;

-- Política de privacidad ------------------------------------------------------------------
select tests.authenticate_as_anon();
select is(public.get_public_privacy('pv-co'), '{"policy": null, "updated_at": null}'::jsonb,
  'sin texto propio: policy null (la SPA usa la plantilla)');
select is(public.get_public_privacy('no-existe'), null, 'empresa inexistente → null');

select tests.authenticate_as((select admin from fx));
update public.companies set privacy_policy = '# Mi política', privacy_updated_at = now()
 where id = pg_temp.fx('company');
select tests.authenticate_as_anon();
select is(public.get_public_privacy('pv-co') ->> 'policy', '# Mi política', 'el admin edita su política');

select tests.authenticate_as((select admin from fx));
select is(
  tests.affected_rows(format($$update public.companies set privacy_policy = 'x' where id = %L$$, pg_temp.other('company'))),
  0, 'no edita la política de otra empresa');

-- Autorización en la reserva web ------------------------------------------------------------
select tests.clear_authentication();
create function pg_temp.payload(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'company_id', pg_temp.fx('company'), 'branch_id', pg_temp.fx('b1'), 'service_id', pg_temp.fx('service'),
    'starts_at', (select at from fx), 'capacity', 1,
    'customer', jsonb_build_object('name', 'Rosa Gil', 'phone', '+573007770001'),
    'items', '[]'::jsonb, 'answers', '[]'::jsonb
  ) || p_extra $$;

select throws_ok($$select public.create_booking(pg_temp.payload())$$, 'SV003',
  'Debes autorizar el tratamiento de tus datos personales', 'sin autorización no hay reserva web');
select throws_ok($$select public.create_booking(pg_temp.payload('{"privacy_consent": false}'))$$, 'SV003', null,
  'autorización en false → rechazo');
select throws_ok($$select public.create_booking(pg_temp.payload('{"privacy_consent": "true"}'))$$, 'SV003', null,
  'la autorización debe ser booleana');

create temp table res on commit drop as
  select public.create_booking(pg_temp.payload('{"privacy_consent": true}')) as v;
select isnt((select privacy_consent_at from public.bookings where id = (select (v ->> 'id')::uuid from res)), null,
  'la reserva guarda el instante de la autorización');

-- Anonimización ---------------------------------------------------------------------------
insert into public.booking_answers (company_id, booking_id, field_id, label, type, value)
values (pg_temp.fx('company'), pg_temp.fx('booking1'), pg_temp.fx('field'), 'Notas', 'text', '"Alergia al látex"');
update public.bookings set internal_notes = 'Cliente frecuente', customer_notes = 'Llego tarde',
       customer_email = 'cli@test.local'
 where id = pg_temp.fx('booking1');
insert into public.booking_events (company_id, booking_id, action, payload)
values (pg_temp.fx('company'), pg_temp.fx('booking1'), 'status_changed', '{"from": "pending", "to": "cancelled", "reason": "Se mudó a Cali"}');

select tests.authenticate_as((select admin from fx));
select throws_ok(format($$select public.anonymize_customer(%L)$$, pg_temp.fx('customer')), '42501', null,
  'el admin no puede anonimizar (solo owner)');

select tests.authenticate_as(pg_temp.other('owner'));
select throws_ok(format($$select public.anonymize_customer(%L)$$, pg_temp.fx('customer')), '42501', null,
  'el owner de otra empresa no puede');
select throws_ok(
  format($$select public.dashboard_kpis(%L, null, now() - interval '180 days', now() + interval '180 days')$$, pg_temp.fx('company')),
  '42501', null, 'quien no es miembro no consulta el dashboard (antes recibía ceros)');

select tests.authenticate_as(pg_temp.fx('owner'));
select is(public.anonymize_customer(pg_temp.fx('customer')), 2, 'anonimiza las 2 reservas del cliente');

select tests.clear_authentication();
select is(
  (select row(name, phone ~ '^anon-', email, notes, anonymized_at is not null)::text
     from public.customers where id = pg_temp.fx('customer')),
  row('Cliente eliminado', true, null::text, null::text, true)::text,
  'cliente sin nombre, teléfono, correo ni notas');
select is(
  (select count(*)::int from public.bookings
    where customer_id = pg_temp.fx('customer')
      and customer_name = 'Cliente eliminado' and customer_phone ~ '^anon-'
      and customer_email is null and customer_notes is null and internal_notes is null and cancel_reason is null),
  2, 'reservas sin datos personales');
select is((select count(*)::int from public.booking_answers where booking_id = pg_temp.fx('booking1')), 0,
  'respuestas adicionales borradas');
select is((select count(*)::int from public.booking_events where booking_id = pg_temp.fx('booking1') and payload ? 'reason'),
  0, 'motivos de cancelación quitados del historial');
select is((select count(*)::int from public.booking_events where booking_id = pg_temp.fx('booking1') and action = 'anonymized'),
  1, 'queda un evento «anonymized»');
select is((select total from public.bookings where id = pg_temp.fx('booking1')) > 0, true,
  'las cifras de la reserva se conservan');

select tests.authenticate_as(pg_temp.fx('owner'));
select is(public.anonymize_customer(pg_temp.fx('customer')), 0, 'repetir no hace nada');

select * from finish();
rollback;
