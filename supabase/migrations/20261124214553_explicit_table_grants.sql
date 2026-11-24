-- Permisos de tabla explícitos (fase 04, primer despliegue).
-- Hasta ahora el esquema dependía de los privilegios por defecto que Supabase concede a
-- `authenticated`/`service_role` al crear tablas. Un proyecto creado sin "exponer tablas nuevas
-- automáticamente" no los tiene, y toda consulta directa del panel fallaba con 42501.
-- El acceso real a cada fila lo siguen decidiendo las políticas RLS (fase 02); `anon` sigue sin
-- acceso a tablas (solo RPC).
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Tablas futuras creadas por las migraciones (rol postgres).
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;
