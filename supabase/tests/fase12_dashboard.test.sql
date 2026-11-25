-- Fase 12: cada RPC del dashboard coincide con el cálculo hecho a mano sobre datos conocidos,
-- y staff solo agrega sus sedes (RLS) aunque pida otra o toda la empresa.
-- Periodo: semana del lunes 7 ene. 2030 (Bogotá). Reservas (sede 1 salvo la 6):
--   1 lun 10:00 confirmed 100 (A, nuevo)      4 mié 15:00 no_show 120 (A)
--   2 lun 11:00 completed 150 (B, recurrente) 5 jue 09:00 pending 60 (D, nuevo)
--   3 mar 10:00 cancelled 90 (C)              6 lun 10:00 confirmed 200 (E, nuevo, sede 2)
-- Periodo anterior: B completed 80 el lunes 31 dic. 2029.
begin;
select plan(24);

create temp table fx on commit drop as select tests.create_tenant('dash-co') as a;
alter table fx add column staff uuid, add column t0 timestamptz;
update fx set staff = tests.create_user('dash-staff@test.local'),
              t0 = timestamptz '2030-01-07 00:00 America/Bogota';
insert into public.company_members (company_id, user_id, role, branch_ids)
select (a ->> 'company')::uuid, staff, 'staff', array[(a ->> 'b1')::uuid] from fx;
update public.companies set timezone = 'America/Bogota' where id = (select (a ->> 'company')::uuid from fx);

create function pg_temp.fx(p_key text) returns uuid language sql as $$ select (a ->> p_key)::uuid from fx $$;
create function pg_temp.t(p_hours numeric) returns timestamptz language sql as $$
  select t0 + make_interval(secs => p_hours * 3600) from fx $$;
grant select on fx to authenticated;
grant execute on function pg_temp.fx(text), pg_temp.t(numeric) to authenticated;

create temp table cust on commit drop as
select k, (select id from public.customers where false) as id from unnest(array['A', 'B', 'C', 'D', 'E']) k;
update cust set id = gen_random_uuid();
insert into public.customers (id, company_id, name, phone)
select id, pg_temp.fx('company'), 'Cliente ' || k, '+57300100000' || (ascii(k) - 64) from cust;

create function pg_temp.bk(p_branch text, p_hours numeric, p_status public.booking_status, p_total numeric, p_cust text)
returns uuid language sql as $$
  insert into public.bookings (company_id, branch_id, service_id, customer_id, status, starts_at, ends_at,
    block_starts_at, block_ends_at, customer_name, customer_phone, service_name, service_price, total, currency,
    cancelled_at)
  select pg_temp.fx('company'), pg_temp.fx(p_branch), pg_temp.fx('service'), c.id, p_status,
         pg_temp.t(p_hours), pg_temp.t(p_hours) + interval '30 minutes', pg_temp.t(p_hours),
         pg_temp.t(p_hours) + interval '30 minutes', 'Cliente ' || p_cust, '+573001000000', 'Servicio',
         p_total, p_total, 'COP', case when p_status = 'cancelled' then now() end
  from cust c where c.k = p_cust
  returning id $$;

select pg_temp.bk('b1', 10, 'confirmed', 100, 'A');
create temp table b2id on commit drop as select pg_temp.bk('b1', 11, 'completed', 150, 'B') as id;
select pg_temp.bk('b1', 24 + 10, 'cancelled', 90, 'C');
select pg_temp.bk('b1', 48 + 15, 'no_show', 120, 'A');
select pg_temp.bk('b1', 72 + 9, 'pending', 60, 'D');
select pg_temp.bk('b2', 10, 'confirmed', 200, 'E');
select pg_temp.bk('b1', -168 + 10, 'completed', 80, 'B');
insert into public.booking_items (company_id, booking_id, product_id, name, unit_price, quantity, line_total)
select pg_temp.fx('company'), id, pg_temp.fx('product'), 'Producto', 10, 2, 20 from b2id;

create function pg_temp.kpis(p_branch uuid default null) returns jsonb language sql as $$
  select public.dashboard_kpis(pg_temp.fx('company'), p_branch, pg_temp.t(0), pg_temp.t(168)) $$;
grant execute on function pg_temp.kpis(uuid), pg_temp.bk(text, numeric, public.booking_status, numeric, text) to authenticated;

-- KPIs (owner) -------------------------------------------------------------------
select tests.authenticate_as(pg_temp.fx('owner'));
select is((pg_temp.kpis() -> 'current' ->> 'bookings_total')::int, 6, 'reservas del periodo (todas)');
select is(pg_temp.kpis() -> 'current' -> 'by_status',
  '{"pending": 1, "confirmed": 2, "completed": 1, "cancelled": 1, "no_show": 1}'::jsonb, 'por estado');
select is((pg_temp.kpis() -> 'current' ->> 'revenue_expected')::numeric, 450::numeric,
  'ingresos esperados: confirmed + completed = 100 + 150 + 200');
select is((pg_temp.kpis() -> 'current' ->> 'revenue_completed')::numeric, 150::numeric, 'ingresos completados');
select is((pg_temp.kpis() -> 'current' ->> 'avg_ticket')::numeric, 150::numeric, 'ticket promedio 450 / 3');
select is((pg_temp.kpis() -> 'current' ->> 'new_customers')::int, 3, 'clientes nuevos: A, D, E');
select is((pg_temp.kpis() -> 'current' ->> 'returning_customers')::int, 1, 'recurrentes: B (vino el periodo anterior)');
select is((pg_temp.kpis() -> 'current' ->> 'cancellation_rate')::numeric, 0.1667, 'tasa de cancelación 1/6');
select is((pg_temp.kpis() -> 'current' ->> 'no_show_rate')::numeric, 0.1667, 'tasa de no asistencia 1/6');
select results_eq(
  $$select (pg_temp.kpis() -> 'previous' ->> 'bookings_total')::int, (pg_temp.kpis() -> 'previous' ->> 'revenue_expected')::numeric$$,
  $$values (1, 80::numeric)$$, 'periodo anterior de la misma duración');
select is((pg_temp.kpis(pg_temp.fx('b1')) -> 'current' ->> 'revenue_expected')::numeric, 250::numeric,
  'filtro por sede: solo sede 1');
select throws_ok(
  $$select public.dashboard_kpis(pg_temp.fx('company'), null, pg_temp.t(0), pg_temp.t(24 * 400))$$,
  '22023', null, 'rango de más de 366 días → error');

-- Serie, top, mapa de calor, sedes ------------------------------------------------------
select is(
  (select jsonb_array_length(public.dashboard_timeseries(pg_temp.fx('company'), null, pg_temp.t(0), pg_temp.t(168), 'day'))),
  7, 'serie diaria: 7 buckets, incluidos los vacíos');
select is(
  public.dashboard_timeseries(pg_temp.fx('company'), null, pg_temp.t(0), pg_temp.t(168), 'day') -> 0,
  '{"bucket": "2030-01-07", "bookings": 3, "revenue": 450}'::jsonb, 'lunes: 3 reservas no canceladas, 450');
select is(
  public.dashboard_timeseries(pg_temp.fx('company'), null, pg_temp.t(0), pg_temp.t(168), 'week'),
  '[{"bucket": "2030-01-07", "bookings": 5, "revenue": 450}]'::jsonb, 'semanal: una semana que empieza el lunes');
select is(
  public.dashboard_top_services(pg_temp.fx('company'), null, pg_temp.t(0), pg_temp.t(168)),
  jsonb_build_array(jsonb_build_object('id', pg_temp.fx('service'), 'name', 'Servicio', 'count', 5, 'revenue', 450)),
  'top servicios: 5 reservas no canceladas, 450 de ingresos');
select is(
  public.dashboard_top_products(pg_temp.fx('company'), null, pg_temp.t(0), pg_temp.t(168)),
  jsonb_build_array(jsonb_build_object('id', pg_temp.fx('product'), 'name', 'Producto', 'quantity', 2, 'revenue', 20)),
  'top productos: cantidad e ingresos');
select is(
  public.dashboard_heatmap(pg_temp.fx('company'), null, pg_temp.t(0), pg_temp.t(168)),
  '[{"dow": 1, "hour": 10, "count": 2}, {"dow": 1, "hour": 11, "count": 1}, {"dow": 3, "hour": 15, "count": 1}, {"dow": 4, "hour": 9, "count": 1}]'::jsonb,
  'mapa de calor en hora de Bogotá (la cancelada no cuenta)');
select results_eq(
  $$select x ->> 'name', (x ->> 'bookings')::int, (x ->> 'revenue')::numeric
    from jsonb_array_elements(public.dashboard_by_branch(pg_temp.fx('company'), pg_temp.t(0), pg_temp.t(168))) x$$,
  $$values ('Sede 1'::text, 4, 250::numeric), ('Sede 2'::text, 1, 200::numeric)$$,
  'comparación entre sedes (owner)');
select tests.clear_authentication();

-- Staff (solo sede 1) -------------------------------------------------------------------
select tests.authenticate_as((select staff from fx));
select is((pg_temp.kpis() -> 'current' ->> 'bookings_total')::int, 5, 'staff sin sede: solo agrega su sede (RLS)');
select is((pg_temp.kpis(pg_temp.fx('b2')) -> 'current' ->> 'bookings_total')::int, 0,
  'staff que pide la sede 2 por la RPC no obtiene nada');
select throws_ok(
  $$select public.dashboard_by_branch(pg_temp.fx('company'), pg_temp.t(0), pg_temp.t(168))$$,
  '42501', null, 'staff no compara sedes');
select tests.clear_authentication();

update public.companies set booking_settings = booking_settings || '{"staff_can_see_revenue": false}'
where id = pg_temp.fx('company');
select tests.authenticate_as((select staff from fx));
select ok(pg_temp.kpis() -> 'current' -> 'revenue_expected' = 'null'::jsonb
          and (pg_temp.kpis() ->> 'can_see_revenue')::boolean = false,
  'con staff_can_see_revenue = false, staff no recibe ingresos');
select tests.clear_authentication();
select tests.authenticate_as(pg_temp.fx('owner'));
select is((pg_temp.kpis() -> 'current' ->> 'revenue_expected')::numeric, 450::numeric, 'el owner sigue viéndolos');
select tests.clear_authentication();

select * from finish();
rollback;
