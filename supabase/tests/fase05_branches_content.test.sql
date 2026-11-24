-- Fase 05: reglas de sedes (última activa, borrar con reservas, catálogo propio) y reorder_rows.
begin;
select plan(13);

create temp table fx on commit drop as select tests.create_tenant('sedes-co') as a;
alter table fx add column other jsonb, add column staff uuid, add column b3 uuid;
update fx set other = tests.create_tenant('otra-co'), staff = tests.create_user('staff-sedes@test.local');
insert into public.company_members (company_id, user_id, role)
select (a ->> 'company')::uuid, staff, 'staff' from fx;
-- Sede sin reservas para probar el borrado.
with i as (
  insert into public.branches (company_id, slug, name)
  select (a ->> 'company')::uuid, 'sede-3', 'Sede 3' from fx
  returning id
)
update fx set b3 = (select id from i);
grant select on fx to authenticated;

select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));

-- Última sede activa ----------------------------------------------------------
select lives_ok(
  format('update public.branches set is_active = false where id in (%L, %L)',
    (select a ->> 'b2' from fx), (select b3 from fx)),
  'se pueden inactivar sedes mientras quede una activa');

select throws_ok(
  format('update public.branches set is_active = false where id = %L', (select a ->> 'b1' from fx)),
  'P0001', 'La empresa debe tener al menos una sede activa',
  'no se puede inactivar la última sede activa');

select throws_ok(
  format('delete from public.branches where id = %L', (select a ->> 'b1' from fx)),
  'P0001', null,
  'no se puede borrar la sede que tiene reservas');

-- Borrar ----------------------------------------------------------------------
select is(
  tests.affected_rows(format('delete from public.branches where id = %L', (select b3 from fx))),
  1, 'una sede sin reservas (e inactiva) se puede borrar');

select throws_ok(
  format('delete from public.branches where id = %L', (select a ->> 'b2' from fx)),
  'P0001', format('La sede "%s" tiene reservas: inactívala en lugar de borrarla', 'Sede 2'),
  'mensaje claro al borrar una sede con reservas');

-- Catálogo propio ---------------------------------------------------------------
select is(
  (select count(*)::int from public.branch_catalog_items where branch_id = (select (a ->> 'b2')::uuid from fx)),
  0, 'sede 2 empieza sin catálogo propio');

update public.branches set own_catalog = true where id = (select (a ->> 'b2')::uuid from fx);

select is(
  (select count(*)::int from public.branch_catalog_items where branch_id = (select (a ->> 'b2')::uuid from fx)),
  (select count(*)::int from public.catalog_items where company_id = (select (a ->> 'company')::uuid from fx) and is_active),
  'al encender catálogo propio se copian los ítems activos');

update public.branches set own_catalog = false where id = (select (a ->> 'b2')::uuid from fx);
delete from public.branch_catalog_items
  where branch_id = (select (a ->> 'b2')::uuid from fx)
    and item_id = (select (a ->> 'service')::uuid from fx);
update public.branches set own_catalog = true where id = (select (a ->> 'b2')::uuid from fx);

select is(
  (select count(*)::int from public.branch_catalog_items where branch_id = (select (a ->> 'b2')::uuid from fx)),
  1, 'si la sede ya tiene catálogo propio, volver a encenderlo no lo pisa');

-- reorder_rows ------------------------------------------------------------------
select lives_ok(
  format('select public.reorder_rows(''branches'', array[%L, %L]::uuid[])',
    (select a ->> 'b2' from fx), (select a ->> 'b1' from fx)),
  'el owner reordena sus sedes');

select results_eq(
  format('select id from public.branches where company_id = %L order by sort_order',
    (select a ->> 'company' from fx)),
  format('values (%L::uuid), (%L::uuid)', (select a ->> 'b2' from fx), (select a ->> 'b1' from fx)),
  'sort_order sigue el orden del arreglo');

select throws_ok(
  format('select public.reorder_rows(''branches'', array[%L, %L]::uuid[])',
    (select a ->> 'b1' from fx), (select other ->> 'b1' from fx)),
  '42501', null,
  'no se pueden mover sedes de otra empresa');

select throws_ok(
  'select public.reorder_rows(''companies'', array[gen_random_uuid()])',
  '22023', null,
  'solo tablas ordenables');

select tests.authenticate_as((select staff from fx));
select throws_ok(
  format('select public.reorder_rows(''branches'', array[%L]::uuid[])', (select a ->> 'b1' from fx)),
  '42501', null,
  'staff no puede reordenar sedes');

select * from finish();
rollback;
