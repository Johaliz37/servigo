-- El rol anon (sitio público sin sesión) solo usa RPC; nunca tablas.
begin;
select plan(11);

select tests.create_tenant('anon-co');

-- Privilegios (catálogo del sistema) ------------------------------------------
select is(
  (select count(*)::int from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
     and has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')),
  0, 'anon no tiene ningún privilegio sobre tablas de public');

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0, 'todas las tablas de public tienen RLS activo');

select is(
  array(select p.proname::text from pg_proc p
        where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
        order by 1),
  array['get_booking_form', 'get_company_by_slug', 'get_invitation', 'get_public_about', 'get_public_branch', 'get_public_item',
        'get_public_site', 'get_public_sitemap', 'ping']::text[],
  'anon solo ejecuta las RPC públicas');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  0, 'toda función security definer fija search_path');

-- Como anon --------------------------------------------------------------------
select tests.authenticate_as_anon();

select throws_ok('select 1 from public.companies', '42501', null, 'anon no lee companies');
select throws_ok('select 1 from public.bookings', '42501', null, 'anon no lee bookings');
select lives_ok('select public.ping()', 'anon ejecuta ping');
select is(public.get_company_by_slug('ANON-CO') ->> 'slug', 'anon-co', 'get_company_by_slug ignora mayúsculas');
select is(public.get_company_by_slug('no-existe'), null, 'get_company_by_slug devuelve null si no existe');
select throws_ok(
  $$select public.has_company_role('00000000-0000-0000-0000-000000000000')$$,
  '42501', null, 'anon no ejecuta helpers de RLS');
select throws_ok(
  $$select public.company_storage_usage('00000000-0000-0000-0000-000000000000')$$,
  '42501', null, 'anon no consulta uso de almacenamiento');

select tests.clear_authentication();
select * from finish();
rollback;
