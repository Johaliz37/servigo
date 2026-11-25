begin;
select plan(5);

-- Toda tabla de public es accesible para `authenticated` (RLS decide las filas) y nunca para `anon`.
-- Excepción (D29): las reservas y su detalle solo se escriben por RPC.
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname not in ('bookings', 'booking_items', 'booking_answers', 'booking_events')
      and not (has_table_privilege('authenticated', c.oid, 'select')
           and has_table_privilege('authenticated', c.oid, 'insert')
           and has_table_privilege('authenticated', c.oid, 'update')
           and has_table_privilege('authenticated', c.oid, 'delete'))),
  0,
  'authenticated tiene select/insert/update/delete en todas las tablas de public (salvo reservas)'
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

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('bookings', 'booking_items', 'booking_answers', 'booking_events')
      and has_table_privilege('authenticated', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'insert')
      and not has_table_privilege('authenticated', c.oid, 'update')),
  4,
  'authenticated lee las reservas pero no las inserta ni actualiza directo (D29)'
);

select ok(
  has_column_privilege('authenticated', 'public.bookings', 'internal_notes', 'update')
  and not has_column_privilege('authenticated', 'public.bookings', 'status', 'update'),
  'authenticated solo actualiza internal_notes de bookings'
);

select * from finish();
rollback;
