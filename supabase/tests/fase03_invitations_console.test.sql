-- Fase 03: alta de empresas, invitaciones, miembros y regla del último owner.
begin;
select plan(30);

create temp table fx on commit drop as select tests.create_tenant('inv-co') as a;
alter table fx add column superadmin uuid, add column admin uuid, add column staff uuid,
  add column invitee uuid, add column stranger uuid, add column created jsonb;
update fx set superadmin = tests.create_user('super@test.local'),
              admin = tests.create_user('admin@inv-co.test'),
              staff = tests.create_user('staff@inv-co.test'),
              invitee = tests.create_user('owner@nueva.test'),
              stranger = tests.create_user('otro@test.local');
insert into public.platform_admins (user_id) select superadmin from fx;
insert into public.company_members (company_id, user_id, role)
select (a ->> 'company')::uuid, admin, 'admin'::public.member_role from fx
union all
select (a ->> 'company')::uuid, staff, 'staff' from fx;
grant select, update on fx to authenticated, anon;

-- check_slug --------------------------------------------------------------------
select tests.authenticate_as((select superadmin from fx));
select is(public.check_slug('nueva'), 'available', 'check_slug: disponible');
select is(public.check_slug('inv-co'), 'taken', 'check_slug: en uso');
select is(public.check_slug('Console'), 'invalid', 'check_slug: mayúsculas no son válidas');
select is(public.check_slug('console'), 'reserved', 'check_slug: reservado');
select is(public.check_slug('a--b'), 'invalid', 'check_slug: doble guion no es válido');

select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));
select throws_ok($$ select public.check_slug('nueva') $$, '42501', null, 'check_slug: solo superadmin');

-- create_company ----------------------------------------------------------------
select throws_ok(
  $$ select public.create_company('Nueva', 'nueva', 'owner@nueva.test') $$,
  '42501', null, 'create_company: un owner no puede crear empresas');

select tests.authenticate_as((select superadmin from fx));
select throws_ok(
  $$ select public.create_company('X', 'servigo', 'a@b.co') $$,
  'P0001', 'El slug "servigo" está reservado', 'create_company: rechaza reservados');
select throws_ok(
  $$ select public.create_company('X', 'inv-co', 'a@b.co') $$,
  'P0001', 'El slug "inv-co" ya está en uso', 'create_company: rechaza slugs en uso');
select throws_ok(
  $$ select public.create_company('X', 'otra', 'no-es-correo') $$,
  'P0001', 'El correo del owner no es válido', 'create_company: valida el correo');

update fx set created = public.create_company('Nueva Empresa', 'nueva', 'Owner@Nueva.test', 'America/Bogota', 'cop');

select tests.clear_authentication();
select is(
  (select concat_ws('|', c.name, c.currency, c.status) from public.companies c where c.slug = 'nueva'),
  'Nueva Empresa|COP|active',
  'create_company crea la empresa');
select is(
  (select count(*)::int from public.branches b where b.company_id = (select (created ->> 'company_id')::uuid from fx)),
  1, 'create_company crea la sede principal');
select is(
  (select concat_ws('|', i.email, i.role) from public.company_invitations i
    where i.id = (select (created ->> 'invitation_id')::uuid from fx)),
  'owner@nueva.test|owner',
  'create_company invita al owner (correo en minúsculas)');

-- console_companies -------------------------------------------------------------
select tests.authenticate_as((select superadmin from fx));
select is(
  (select branches_count from public.console_companies() where slug = 'inv-co'),
  2, 'console_companies cuenta sedes');
select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));
select throws_ok($$ select * from public.console_companies() $$, '42501', null, 'console_companies: solo superadmin');

-- get_invitation / accept_invitation -------------------------------------------
select tests.authenticate_as_anon();
select is(
  public.get_invitation((select (created ->> 'invitation_token')::uuid from fx)) ->> 'company_name',
  'Nueva Empresa', 'anon ve la invitación si conoce el token');
select is(public.get_invitation(gen_random_uuid()), null, 'token inexistente → null');
select throws_ok(
  format('select public.accept_invitation(%L)', (select created ->> 'invitation_token' from fx)),
  '42501', null, 'anon no puede aceptar invitaciones');

select tests.authenticate_as((select stranger from fx));
select throws_ok(
  format('select public.accept_invitation(%L)', (select created ->> 'invitation_token' from fx)),
  'P0001', 'Esta invitación es para owner@nueva.test; entra con ese correo',
  'la invitación solo la acepta su destinatario');

select tests.authenticate_as((select invitee from fx));
select is(
  public.accept_invitation((select (created ->> 'invitation_token')::uuid from fx)) ->> 'role',
  'owner', 'el destinatario acepta la invitación');
select ok(
  public.has_company_role((select (created ->> 'company_id')::uuid from fx), '{owner}'),
  'tras aceptar es owner de la empresa');
select throws_ok(
  format('select public.accept_invitation(%L)', (select created ->> 'invitation_token' from fx)),
  'P0001', 'Esta invitación ya fue aceptada', 'una invitación no se usa dos veces');

select tests.clear_authentication();
update public.company_invitations set expires_at = now() - interval '1 minute'
where company_id = (select (a ->> 'company')::uuid from fx);
select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));
select throws_ok(
  format('select public.accept_invitation(%L)',
    (select token from public.company_invitations where company_id = (select (a ->> 'company')::uuid from fx) limit 1)),
  'P0001', null, 'una invitación vencida no se acepta');

-- list_company_members ----------------------------------------------------------
select is(
  array(select email from public.list_company_members((select (a ->> 'company')::uuid from fx))),
  array['inv-co-owner@test.local', 'admin@inv-co.test', 'staff@inv-co.test'],
  'list_company_members devuelve emails ordenados por rol');
select tests.authenticate_as((select staff from fx));
select throws_ok(
  format('select * from public.list_company_members(%L)', (select a ->> 'company' from fx)),
  '42501', null, 'staff no lista miembros');
select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));
select throws_ok(
  format('select * from public.list_company_members(%L)', (select created ->> 'company_id' from fx)),
  '42501', null, 'un owner no lista miembros de otra empresa');

-- Último owner ------------------------------------------------------------------
select throws_ok(
  format($$ update public.company_members set role = 'admin' where user_id = %L $$, (select a ->> 'owner' from fx)),
  'P0001', 'La empresa debe conservar al menos un owner', 'el último owner no se degrada');
select throws_ok(
  format($$ delete from public.company_members where user_id = %L $$, (select a ->> 'owner' from fx)),
  'P0001', 'La empresa debe conservar al menos un owner', 'el último owner no se elimina');

-- Con un segundo owner sí se puede.
select tests.clear_authentication();
insert into public.company_members (company_id, user_id, role)
select (a ->> 'company')::uuid, stranger, 'owner' from fx;
select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));
select lives_ok(
  format($$ update public.company_members set role = 'admin' where user_id = %L $$, (select a ->> 'owner' from fx)),
  'con otro owner, un owner puede pasar a admin');

-- Borrar la empresa no choca con la regla (cascada).
select tests.clear_authentication();
select lives_ok(
  format('delete from public.companies where id = %L', (select a ->> 'company' from fx)),
  'eliminar la empresa borra sus miembros sin violar la regla');

select * from finish();
rollback;
