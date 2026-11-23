-- Staff limitado a sedes (branch_ids) y límites del rol admin.
begin;
select plan(18);

create temp table fx on commit drop as select tests.create_tenant('staff-co') as a;
alter table fx add column staff uuid, add column staff_all uuid, add column admin uuid;
update fx set staff = tests.create_user('staff1@test.local'),
              staff_all = tests.create_user('staff-all@test.local'),
              admin = tests.create_user('admin1@test.local');

insert into public.company_members (company_id, user_id, role, branch_ids)
select (a ->> 'company')::uuid, staff, 'staff'::public.member_role, array[(a ->> 'b1')::uuid] from fx
union all
select (a ->> 'company')::uuid, staff_all, 'staff', null from fx
union all
select (a ->> 'company')::uuid, admin, 'admin', null from fx;

grant select on fx to authenticated;

-- Staff con branch_ids = {sede 1} ---------------------------------------------
select tests.authenticate_as((select staff from fx));

select results_eq(
  'select id from public.bookings',
  format('select %L::uuid', (select a ->> 'booking1' from fx)),
  'staff solo ve las reservas de su sede');

select isnt_empty('select 1 from public.booking_items', 'staff ve el detalle de reservas de su sede');

select is(
  tests.affected_rows(format('update public.bookings set internal_notes = ''x'' where id = %L', (select a ->> 'booking2' from fx))),
  0, 'staff no modifica reservas de otra sede');

select is(
  tests.affected_rows(format('update public.bookings set internal_notes = ''ok'' where id = %L', (select a ->> 'booking1' from fx))),
  1, 'staff modifica reservas de su sede');

select is(
  tests.affected_rows(format('delete from public.bookings where id = %L', (select a ->> 'booking1' from fx))),
  0, 'staff no borra reservas (solo owner)');

select set_eq(
  'select id from public.availability_events',
  format('select %L::uuid', (select a ->> 'event_company' from fx)),
  'staff ve la disponibilidad de empresa pero no la de otra sede');

select lives_ok(
  format($$insert into public.availability_events (company_id, branch_id, kind, starts_at, ends_at)
           values (%L, %L, 'closed', now(), now() + interval '1 hour')$$,
         (select a ->> 'company' from fx), (select a ->> 'b1' from fx)),
  'staff crea no disponibilidad en su sede');

select throws_ok(
  format($$insert into public.availability_events (company_id, branch_id, kind, starts_at, ends_at)
           values (%L, %L, 'closed', now(), now() + interval '1 hour')$$,
         (select a ->> 'company' from fx), (select a ->> 'b2' from fx)),
  '42501', null, 'staff no crea disponibilidad en otra sede');

select throws_ok(
  format($$insert into public.availability_events (company_id, kind, starts_at, ends_at)
           values (%L, 'closed', now(), now() + interval '1 hour')$$, (select a ->> 'company' from fx)),
  '42501', null, 'staff no crea disponibilidad a nivel empresa');

select isnt_empty('select 1 from public.catalog_items', 'staff lee el catálogo');

select throws_ok(
  format($$insert into public.catalog_items (company_id, kind, name, price, duration_minutes)
           values (%L, 'service', 'x', 1, 30)$$, (select a ->> 'company' from fx)),
  '42501', null, 'staff no crea ítems de catálogo');

select is(
  tests.affected_rows(format('update public.catalog_items set price = 0 where company_id = %L', (select a ->> 'company' from fx))),
  0, 'staff no modifica el catálogo');

select throws_ok(
  format($$insert into public.company_members (company_id, user_id, role) values (%L, %L, 'staff')$$,
         (select a ->> 'company' from fx), (select staff_all from fx)),
  '42501', null, 'staff no gestiona miembros');

select is_empty('select 1 from public.company_invitations', 'staff no ve invitaciones (contienen el token)');

-- Staff sin restricción de sedes ----------------------------------------------
select tests.authenticate_as((select staff_all from fx));

select is((select count(*)::int from public.bookings), 2, 'staff con branch_ids null ve todas las sedes');

-- Admin -----------------------------------------------------------------------
select tests.authenticate_as((select admin from fx));

select lives_ok(
  format($$update public.company_members set branch_ids = null where user_id = %L$$, (select staff from fx)),
  'admin gestiona staff');

select throws_ok(
  format($$insert into public.company_invitations (company_id, email, role) values (%L, 'jefe@x.test', 'owner')$$,
         (select a ->> 'company' from fx)),
  '42501', null, 'admin no invita owners');

select is(
  tests.affected_rows(format('delete from public.company_members where user_id = %L', (select a ->> 'owner' from fx))),
  0, 'admin no elimina al owner');

select tests.clear_authentication();
select * from finish();
rollback;
