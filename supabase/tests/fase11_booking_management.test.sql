-- Fase 11: gestión de reservas desde el panel (D29). Máquina de estados, reprogramar (con y
-- sin forzar), editar con precios congelados o actuales, reserva manual, historial con el
-- usuario y aislamiento por sede del staff, todo verificado en SQL (no solo en la UI).
-- create_tenant deja: servicio de 100 con -10 %, capacidad 1 y 30 min; producto de 10 asociado
-- al servicio; campo «Notas»; booking1 (sede 1) y booking2 (sede 2) pendientes y «ahora».
begin;
select plan(48);

create temp table fx on commit drop as select tests.create_tenant('gr-co') as a;
alter table fx add column staff uuid, add column admin uuid, add column at timestamptz;
update fx set staff = tests.create_user('gr-staff@test.local'),
              admin = tests.create_user('gr-admin@test.local'),
              at = date_trunc('hour', now()) + interval '3 days';

insert into public.company_members (company_id, user_id, role, branch_ids)
select (a ->> 'company')::uuid, staff, 'staff'::public.member_role, array[(a ->> 'b1')::uuid] from fx
union all
select (a ->> 'company')::uuid, admin, 'admin', null from fx;

create function pg_temp.fx(p_key text) returns uuid language sql as $$ select (a ->> p_key)::uuid from fx $$;
create function pg_temp.at(p_hours int default 0) returns timestamptz language sql as $$
  select at + make_interval(hours => p_hours) from fx $$;
create function pg_temp.payload(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'company_id', pg_temp.fx('company'), 'branch_id', pg_temp.fx('b1'), 'service_id', pg_temp.fx('service'),
    'starts_at', pg_temp.at(), 'capacity', 1,
    'customer', jsonb_build_object('name', 'Marta Ruiz', 'phone', '+573005550001'),
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.fx('product'), 'quantity', 1)),
    'answers', '[]'::jsonb
  ) || p_extra $$;

create temp table res (k text primary key, v jsonb) on commit drop;
grant select, insert on fx, res to authenticated;
grant execute on function pg_temp.fx(text), pg_temp.at(int), pg_temp.payload(jsonb) to authenticated;

-- Sin escritura directa (D29) ------------------------------------------------------------
select tests.authenticate_as((select staff from fx));
select throws_ok(
  format($$update public.bookings set status = 'completed' where id = %L$$, pg_temp.fx('booking1')),
  '42501', null, 'staff no cambia el estado con un update directo');
select throws_ok(
  format($$insert into public.booking_events (company_id, booking_id, action) values (%L, %L, 'edited')$$,
         pg_temp.fx('company'), pg_temp.fx('booking1')),
  '42501', null, 'nadie escribe el historial a mano');
select is(
  tests.affected_rows(format($$update public.bookings set internal_notes = 'Trae su tinte' where id = %L$$,
                             pg_temp.fx('booking1'))),
  1, 'las notas internas sí se editan directo (RLS: su sede)');

-- Reserva manual -------------------------------------------------------------------------
insert into res values ('manual', public.create_booking_admin(pg_temp.payload()));
select is((select v ->> 'status' from res where k = 'manual'), 'confirmed', 'manual: confirmada por defecto');
select results_eq(
  $$select source, created_by, total from public.bookings where id = (select (v ->> 'id')::uuid from res where k = 'manual')$$,
  $$select 'admin'::text, staff, 100::numeric from fx$$,
  'manual: origen admin, created_by y total 90 + 10');
select is(
  (select actor from public.booking_events
   where booking_id = (select (v ->> 'id')::uuid from res where k = 'manual') and action = 'created'),
  (select staff from fx), 'manual: el historial guarda quién la creó');
select throws_ok($$select public.create_booking_admin(pg_temp.payload())$$, 'SV001', 'SLOT_TAKEN',
  'manual: el cupo lleno se rechaza igual que en la web');
select throws_ok($$select public.create_booking_admin(pg_temp.payload('{"capacity": 50}'))$$, 'SV001', 'SLOT_TAKEN',
  'manual: una capacidad inflada desde el navegador se acota a la configurada');
select throws_ok($$select public.create_booking_admin(pg_temp.payload('{"force": true}'))$$, '42501', null,
  'staff no puede forzar');
select throws_ok(
  format($$select public.create_booking_admin(pg_temp.payload(jsonb_build_object('branch_id', %L::uuid)))$$,
         pg_temp.fx('b2')),
  '42501', null, 'staff no crea reservas en otra sede');
select throws_ok(
  format($$select public.create_booking_admin(pg_temp.payload(jsonb_build_object('starts_at', %L::timestamptz)))$$,
         now() - interval '2 hours'),
  'SV001', null, 'manual en el pasado sin forzar → rechazada');
select throws_ok($$select public.create_booking_admin(pg_temp.payload('{"status": "completed", "starts_at": null}'))$$,
  'SV001', null, 'sin horario → rechazada');
select tests.clear_authentication();

select tests.authenticate_as((select admin from fx));
insert into res values ('forced', public.create_booking_admin(pg_temp.payload('{"force": true, "status": "pending"}')));
select is((select v ->> 'status' from res where k = 'forced'), 'pending', 'admin fuerza el mismo cupo (estado pedido)');
select is(
  (select payload ->> 'forced' from public.booking_events
   where booking_id = (select (v ->> 'id')::uuid from res where k = 'forced')),
  'true', 'el historial marca que se forzó');
insert into res values ('walkin', public.create_booking_admin(
  pg_temp.payload(jsonb_build_object('force', true, 'starts_at', now() - interval '1 hour', 'items', '[]'::jsonb))));
select isnt((select v ->> 'id' from res where k = 'walkin'), null, 'admin registra una reserva pasada forzando');
select tests.clear_authentication();

-- Máquina de estados -------------------------------------------------------------------
select ok(public.booking_transition_allowed('pending', 'confirmed', now() + interval '1 day'), 'pending → confirmed');
select ok(not public.booking_transition_allowed('pending', 'completed', now() - interval '1 day'),
  'pending → completed no (primero se confirma)');
select ok(not public.booking_transition_allowed('confirmed', 'completed', now() + interval '1 day'),
  'completar una reserva futura no');
select ok(public.booking_transition_allowed('confirmed', 'no_show', now() - interval '1 hour'), 'confirmed → no_show si ya pasó');
select ok(not public.booking_transition_allowed('cancelled', 'confirmed', now()), 'cancelled es final');
select ok(not public.booking_transition_allowed('completed', 'cancelled', now()), 'completed es final');

select tests.authenticate_as((select staff from fx));
select throws_ok(
  format($$select public.change_booking_status(%L, 'confirmed')$$, pg_temp.fx('booking2')),
  '42501', null, 'staff no cambia reservas de otra sede (RLS + RPC)');
select throws_ok(
  format($$select public.change_booking_status(%L, 'completed')$$, (select (v ->> 'id')::uuid from res where k = 'manual')),
  'SV006', null, 'completar una reserva futura → SV006');
select lives_ok(
  format($$select public.change_booking_status(%L, 'confirmed')$$, pg_temp.fx('booking1')),
  'staff confirma una reserva de su sede');
select results_eq(
  format($$select actor, payload ->> 'from', payload ->> 'to' from public.booking_events
           where booking_id = %L and action = 'status_changed'$$, pg_temp.fx('booking1')),
  $$select staff, 'pending'::text, 'confirmed'::text from fx$$,
  'historial: cambio de estado con el usuario');
select lives_ok(
  format($$select public.change_booking_status(%L, 'completed')$$, pg_temp.fx('booking1')),
  'confirmed → completed (la hora ya pasó)');
select throws_ok(
  format($$select public.change_booking_status(%L, 'cancelled')$$, pg_temp.fx('booking1')),
  'SV006', null, 'una completada ya no se cancela');
select lives_ok(
  format($$select public.change_booking_status(%L, 'cancelled', 'El cliente llamó')$$,
         (select (v ->> 'id')::uuid from res where k = 'manual')),
  'cancelar con motivo');
select results_eq(
  format($$select status::text, cancel_reason, cancelled_at is not null from public.bookings where id = %L$$,
         (select (v ->> 'id')::uuid from res where k = 'manual')),
  $$values ('cancelled'::text, 'El cliente llamó'::text, true)$$,
  'cancelada: motivo y fecha');
select tests.clear_authentication();

-- Reprogramar ---------------------------------------------------------------------------
-- El cupo de pg_temp.at() lo ocupa «forced» (pendiente). Otra reserva en at()+2h.
select tests.authenticate_as((select admin from fx));
insert into res values ('move', public.create_booking_admin(
  pg_temp.payload(jsonb_build_object('starts_at', pg_temp.at(2), 'items', '[]'::jsonb))));
select tests.clear_authentication();

select tests.authenticate_as((select staff from fx));
select throws_ok(
  format($$select public.reschedule_booking(%L, %L, 1)$$, (select (v ->> 'id')::uuid from res where k = 'move'), pg_temp.at()),
  'SV001', 'SLOT_TAKEN', 'reprogramar a un horario lleno falla');
select throws_ok(
  format($$select public.reschedule_booking(%L, %L, 1, true)$$, (select (v ->> 'id')::uuid from res where k = 'move'), pg_temp.at()),
  '42501', null, 'staff no puede forzar la reprogramación');
select lives_ok(
  format($$select public.reschedule_booking(%L, %L, 1)$$, (select (v ->> 'id')::uuid from res where k = 'move'),
         pg_temp.at(2) + interval '15 minutes'),
  'mover dentro de su propio bloque no choca consigo misma');
select results_eq(
  format($$select starts_at, ends_at - starts_at, block_ends_at - block_starts_at from public.bookings where id = %L$$,
         (select (v ->> 'id')::uuid from res where k = 'move')),
  $$select at + interval '2 hours 15 minutes', interval '30 minutes', interval '30 minutes' from fx$$,
  'conserva duración y buffers');
select tests.clear_authentication();

select tests.authenticate_as((select admin from fx));
select lives_ok(
  format($$select public.reschedule_booking(%L, %L, null, true)$$, (select (v ->> 'id')::uuid from res where k = 'move'), pg_temp.at()),
  'admin fuerza la reprogramación a un horario lleno');
select results_eq(
  format($$select actor, payload ->> 'forced' from public.booking_events where booking_id = %L and action = 'rescheduled' and payload ? 'forced'
           order by created_at desc, id limit 1$$, (select (v ->> 'id')::uuid from res where k = 'move')),
  $$select admin, 'true'::text from fx$$,
  'historial: reprogramada a la fuerza, por el admin');
select tests.clear_authentication();

-- Editar ------------------------------------------------------------------------------
-- «forced» tiene 1 producto a 10. Subir el precio del producto: la edición conserva el congelado.
update public.catalog_items set price = 15 where id = pg_temp.fx('product');
select tests.authenticate_as((select admin from fx));
select lives_ok(
  format($$select public.update_booking_admin(%L, jsonb_build_object('items',
           jsonb_build_array(jsonb_build_object('product_id', %L::uuid, 'quantity', 3))))$$,
         (select (v ->> 'id')::uuid from res where k = 'forced'), pg_temp.fx('product')),
  'editar la cantidad de un producto');
select results_eq(
  format($$select products_total, discount_total, total from public.bookings where id = %L$$,
         (select (v ->> 'id')::uuid from res where k = 'forced')),
  $$values (30::numeric, 10::numeric, 120::numeric)$$,
  'precio congelado: 100 − 10 + 3 × 10 = 120');
select lives_ok(
  format($$select public.update_booking_admin(%L, '{"reprice": true}')$$, (select (v ->> 'id')::uuid from res where k = 'forced')),
  'recalcular con precios actuales');
select results_eq(
  format($$select products_total, total from public.bookings where id = %L$$,
         (select (v ->> 'id')::uuid from res where k = 'forced')),
  $$values (45::numeric, 135::numeric)$$,
  'precios actuales: 90 + 3 × 15 = 135');
select lives_ok(
  format($$select public.update_booking_admin(%L, jsonb_build_object(
           'customer', jsonb_build_object('name', 'Marta Ruiz G.', 'phone', '+573005550002', 'email', 'marta@test.local'),
           'answers', jsonb_build_array(jsonb_build_object('field_id', %L::uuid, 'value', 'Alérgica al amoniaco'))))$$,
         (select (v ->> 'id')::uuid from res where k = 'forced'), pg_temp.fx('field')),
  'editar cliente y respuestas');
select results_eq(
  format($$select b.customer_name, b.customer_phone, c.phone, a.value
           from public.bookings b join public.customers c on c.id = b.customer_id
           join public.booking_answers a on a.booking_id = b.id where b.id = %L$$,
         (select (v ->> 'id')::uuid from res where k = 'forced')),
  $$values ('Marta Ruiz G.'::text, '+573005550002'::text, '+573005550002'::text, '"Alérgica al amoniaco"'::jsonb)$$,
  'snapshot del cliente, cliente por teléfono y respuesta nueva');
select is(
  (select count(*)::int from public.booking_events
   where booking_id = (select (v ->> 'id')::uuid from res where k = 'forced') and action = 'edited' and actor = (select admin from fx)),
  3, 'cada edición queda en el historial con el usuario');
select throws_ok(
  format($$select public.update_booking_admin(%L, '{"customer": {"name": "X", "phone": "300"}}')$$,
         (select (v ->> 'id')::uuid from res where k = 'forced')),
  'SV003', null, 'teléfono no válido → SV003');
select throws_ok(
  format($$select public.update_booking_admin(%L, '{"reprice": true}')$$, (select (v ->> 'id')::uuid from res where k = 'manual')),
  'SV006', null, 'una cancelada no se edita');
select tests.clear_authentication();

-- Cupos del panel y clientes ----------------------------------------------------------------
select tests.authenticate_as((select staff from fx));
select throws_ok(
  format($$select public.admin_slot_inputs(%L, %L, now(), now() + interval '1 day')$$, pg_temp.fx('b2'), pg_temp.fx('service')),
  '42501', null, 'staff no lee cupos de otra sede');
select is(
  (select bookings_count from public.customer_stats where phone = '+573000000001'),
  1, 'customer_stats: staff solo cuenta las reservas de su sede');
select is(
  (select actor_email from public.booking_history(pg_temp.fx('booking1')) where action = 'status_changed' limit 1),
  'gr-staff@test.local', 'booking_history: con el correo de quien hizo el cambio');
select throws_ok(
  format($$select * from public.booking_history(%L)$$, pg_temp.fx('booking2')),
  '42501', null, 'booking_history: staff no ve el historial de otra sede');
select tests.clear_authentication();

select * from finish();
rollback;
