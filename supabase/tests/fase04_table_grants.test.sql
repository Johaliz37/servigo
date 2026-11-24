begin;
select plan(3);

-- Toda tabla de public es accesible para `authenticated` (RLS decide las filas) y nunca para `anon`.
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not (has_table_privilege('authenticated', c.oid, 'select')
           and has_table_privilege('authenticated', c.oid, 'insert')
           and has_table_privilege('authenticated', c.oid, 'update')
           and has_table_privilege('authenticated', c.oid, 'delete'))),
  0,
  'authenticated tiene select/insert/update/delete en todas las tablas de public'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not (has_table_privilege('service_role', c.oid, 'select')
           and has_table_privilege('service_role', c.oid, 'insert')
           and has_table_privilege('service_role', c.oid, 'update')
           and has_table_privilege('service_role', c.oid, 'delete'))),
  0,
  'service_role tiene acceso completo a las tablas de public'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and has_table_privilege('anon', c.oid, 'select')),
  0,
  'anon no puede leer ninguna tabla de public'
);

select * from finish();
rollback;
