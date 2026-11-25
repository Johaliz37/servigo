-- Fase 08: reglas de availability_events y get_slot_inputs.
-- create_tenant deja un evento de empresa (event_company), uno de la sede 2 (event_b2) y una
-- reserva pendiente del servicio en cada sede, todo alrededor de now().
begin;
select plan(21);

create temp table fx on commit drop as select tests.create_tenant('dispo-co') as a;
grant select on fx to authenticated, service_role;

select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));

select lives_ok(
  format($$insert into public.availability_events (company_id, kind, starts_at, ends_at, rrule)
           values (%L, 'open', now(), now() + interval '1 hour', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20271231T045959Z')$$,
    (select a ->> 'company' from fx)),
  'una regla semanal con UNTIL se guarda');

select is(
  (select rrule from public.availability_events where rrule like '%UNTIL=2027%'),
  'FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20271231T045959Z',
  'el prefijo RRULE: se normaliza');

select throws_ok(
  format($$insert into public.availability_events (company_id, kind, starts_at, ends_at, rrule)
           values (%L, 'open', now(), now() + interval '1 hour', 'FREQ=HOURLY')$$, (select a ->> 'company' from fx)),
  '23514', 'Regla de repetición no válida',
  'frecuencias que el motor no entiende se rechazan');

select throws_ok(
  format($$insert into public.availability_events (company_id, kind, starts_at, ends_at, rrule)
           values (%L, 'open', now(), now() + interval '1 hour', 'FREQ=DAILY;COUNT=3; DROP')$$, (select a ->> 'company' from fx)),
  '23514', 'Regla de repetición no válida',
  'una regla mal formada se rechaza');

select throws_ok(
  format($$insert into public.availability_events (company_id, kind, starts_at, ends_at, service_ids)
           values (%L, 'open', now(), now() + interval '1 hour', array[%L]::uuid[])$$,
    (select a ->> 'company' from fx), (select a ->> 'product' from fx)),
  '23514', 'Un horario solo puede limitarse a servicios',
  'service_ids no admite productos');

insert into public.availability_events (company_id, title, kind, starts_at, ends_at, service_ids)
values ((select (a ->> 'company')::uuid from fx), 'vacía', 'open', now(), now() + interval '1 hour', '{}');

select is(
  (select service_ids from public.availability_events where title = 'vacía'),
  null::uuid[],
  'una lista de servicios vacía equivale a todos');

select throws_ok(
  format($$insert into public.availability_events (company_id, kind, starts_at, ends_at)
           values (%L, 'closed', now(), now() + interval '400 days')$$, (select a ->> 'company' from fx)),
  '23514', 'Un evento no puede durar más de un año',
  'duración máxima de un año');

-- Excepciones («solo este evento»).
select throws_ok(
  format($$insert into public.availability_events
             (company_id, kind, starts_at, ends_at, recurrence_parent_id, recurrence_original_start)
           values (%L, 'open', now(), now() + interval '1 hour', %L, now())$$,
    (select a ->> 'company' from fx), (select a ->> 'event_company' from fx)),
  '23514', null,
  'una excepción exige una serie recurrente');

update public.availability_events set rrule = 'FREQ=DAILY' where id = (select (a ->> 'event_company')::uuid from fx);

select throws_ok(
  format($$insert into public.availability_events
             (company_id, branch_id, kind, starts_at, ends_at, recurrence_parent_id, recurrence_original_start)
           values (%L, %L, 'open', now(), now() + interval '1 hour', %L, now())$$,
    (select a ->> 'company' from fx), (select a ->> 'b1' from fx), (select a ->> 'event_company' from fx)),
  '23514', null,
  'una excepción es de la misma sede que su serie');

select lives_ok(
  format($$insert into public.availability_events
             (company_id, kind, starts_at, ends_at, recurrence_parent_id, recurrence_original_start)
           values (%L, 'open', now() + interval '2 hours', now() + interval '3 hours', %L, now())$$,
    (select a ->> 'company' from fx), (select a ->> 'event_company' from fx)),
  'una excepción válida de la serie de empresa se guarda');

-- apply_availability_plan ---------------------------------------------------------
select lives_ok(
  format($$select public.apply_availability_plan(jsonb_build_object(
    'inserts', jsonb_build_array(jsonb_build_object(
      'id', '90000000-0000-4000-a000-000000000001', 'company_id', %L, 'kind', 'open',
      'title', 'Plan', 'starts_at', now(), 'ends_at', now() + interval '1 hour', 'rrule', 'FREQ=DAILY')),
    'updates', jsonb_build_array(jsonb_build_object('id', %L, 'patch', jsonb_build_object('title', 'Renombrado'))),
    'deletes', '[]'::jsonb))$$,
    (select a ->> 'company' from fx), (select a ->> 'event_b2' from fx)),
  'un plan inserta y actualiza en una sola llamada');

select is(
  (select array[(select title from public.availability_events where id = '90000000-0000-4000-a000-000000000001'),
                (select title from public.availability_events where id = (select (a ->> 'event_b2')::uuid from fx))]),
  array['Plan', 'Renombrado'],
  'el update solo cambia las columnas del patch');

select throws_ok(
  format($$select public.apply_availability_plan(jsonb_build_object(
    'inserts', jsonb_build_array(jsonb_build_object(
      'id', '90000000-0000-4000-a000-000000000002', 'company_id', %L, 'kind', 'open',
      'starts_at', now(), 'ends_at', now() + interval '1 hour')),
    'updates', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'patch', '{}'::jsonb))))$$,
    (select a ->> 'company' from fx)),
  '42501', null,
  'si una parte falla no se aplica nada');

select is(
  (select count(*)::int from public.availability_events where id = '90000000-0000-4000-a000-000000000002'),
  0,
  'el insert del plan fallido se deshizo');

select lives_ok(
  $$select public.apply_availability_plan('{"deletes": ["90000000-0000-4000-a000-000000000001", "90000000-0000-4000-a000-0000000000ff"]}')$$,
  'borrar una fila que ya no existe no falla');

-- get_slot_inputs ---------------------------------------------------------------
select throws_ok(
  format($$select public.get_slot_inputs(%L, %L, now(), now() + interval '1 day')$$,
    (select a ->> 'b1' from fx), (select a ->> 'service' from fx)),
  '42501', null,
  'los miembros no llaman get_slot_inputs (solo el Worker)');

select tests.clear_authentication();
set local role service_role;

create temp table si on commit drop as
select
  public.get_slot_inputs((select (a ->> 'b1')::uuid from fx), (select (a ->> 'service')::uuid from fx),
                         now() - interval '1 day', now() + interval '7 days') as b1,
  public.get_slot_inputs((select (a ->> 'b2')::uuid from fx), (select (a ->> 'service')::uuid from fx),
                         now() - interval '1 day', now() + interval '7 days') as b2;

select ok(
  (select b1 -> 'service' ->> 'duration_minutes' = '30' and b1 ->> 'timezone' = 'America/Bogota'
          and b1 -> 'settings' ? 'slot_step_minutes' from si),
  'devuelve servicio, zona y configuración');

select is(
  (select array(select e ->> 'id' from jsonb_array_elements(b1 -> 'events') e where e ->> 'id' = (select a ->> 'event_b2' from fx)) from si),
  '{}'::text[],
  'una sede sin horario propio no recibe eventos de otra sede');

select ok(
  (select exists (select 1 from jsonb_array_elements(b1 -> 'events') e where e ->> 'id' = (select a ->> 'event_company' from fx))
     and jsonb_array_length(b1 -> 'bookings') = 1
     and not (b1 -> 'bookings' -> 0 ? 'customer_name')
   from si),
  'sede sin horario propio: eventos de la empresa y bloques ocupados sin datos personales');

reset role;
update public.branches set own_availability = true where id = (select (a ->> 'b2')::uuid from fx);
set local role service_role;

select is(
  (select array(select e ->> 'id' from jsonb_array_elements(
     public.get_slot_inputs((select (a ->> 'b2')::uuid from fx), (select (a ->> 'service')::uuid from fx),
                            now() - interval '1 day', now() + interval '7 days') -> 'events') e)),
  array[(select a ->> 'event_b2' from fx)],
  'sede con horario propio: solo sus eventos');

select ok(
  public.get_slot_inputs((select (a ->> 'b1')::uuid from fx), (select (a ->> 'product')::uuid from fx),
                         now(), now() + interval '1 day') is null,
  'un producto (o un servicio que la sede no ofrece) devuelve null');

select * from finish();
rollback;
