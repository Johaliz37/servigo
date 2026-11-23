-- Aislamiento entre empresas: el owner de A no ve, no modifica, no borra ni crea filas de B,
-- en TODAS las tablas de tenant (la lista sale del esquema, así que una tabla nueva queda cubierta).
begin;
select plan(87);

create temp table fx on commit drop as
select tests.create_tenant('empresa-a') as a, tests.create_tenant('empresa-b') as b;
grant select on fx to authenticated;

select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));

-- El fixture cubre todas las tablas y el owner ve lo suyo (19).
select isnt_empty(
  format('select 1 from public.%I where company_id = %L', t, (select a ->> 'company' from fx)),
  format('owner A ve sus filas de %s', t))
from tests.tenant_tables() t;

-- No ve filas de B (19 + companies).
select is_empty(
  format('select 1 from public.%I where company_id = %L', t, (select b ->> 'company' from fx)),
  format('owner A no ve filas de B en %s', t))
from tests.tenant_tables() t;

select is_empty(
  format('select 1 from public.companies where id = %L', (select b ->> 'company' from fx)),
  'owner A no ve la empresa B');

-- No modifica filas de B (19 + companies).
select is(
  tests.affected_rows(format('update public.%I set company_id = company_id where company_id = %L',
                             t, (select b ->> 'company' from fx))),
  0,
  format('owner A no modifica filas de B en %s', t))
from tests.tenant_tables() t;

select is(
  tests.affected_rows(format('update public.companies set name = ''hack'' where id = %L', (select b ->> 'company' from fx))),
  0,
  'owner A no modifica la empresa B');

-- No borra filas de B (19 + companies).
select is(
  tests.affected_rows(format('delete from public.%I where company_id = %L', t, (select b ->> 'company' from fx))),
  0,
  format('owner A no borra filas de B en %s', t))
from tests.tenant_tables() t;

select is(
  tests.affected_rows(format('delete from public.companies where id = %L', (select b ->> 'company' from fx))),
  0,
  'owner A no borra la empresa B');

-- No crea filas con company_id de B.
select throws_ok(
  format($$insert into public.catalog_items (company_id, kind, name, price, duration_minutes)
           values (%L, 'service', 'x', 1, 30)$$, (select b ->> 'company' from fx)),
  '42501', null, 'owner A no crea ítems en B');

select throws_ok(
  format($$insert into public.branches (company_id, slug, name) values (%L, 'intrusa', 'x')$$,
         (select b ->> 'company' from fx)),
  '42501', null, 'owner A no crea sedes en B');

select throws_ok(
  format($$insert into public.customers (company_id, name, phone) values (%L, 'x', '+573009999999')$$,
         (select b ->> 'company' from fx)),
  '42501', null, 'owner A no crea clientes en B');

select throws_ok(
  format($$insert into public.availability_events (company_id, kind, starts_at, ends_at)
           values (%L, 'open', now(), now() + interval '1 hour')$$, (select b ->> 'company' from fx)),
  '42501', null, 'owner A no crea disponibilidad en B');

select throws_ok(
  format($$insert into public.company_members (company_id, user_id, role) values (%L, %L, 'owner')$$,
         (select b ->> 'company' from fx), (select a ->> 'owner' from fx)),
  '42501', null, 'owner A no se agrega como miembro de B');

-- Storage: solo en la carpeta de su empresa.
select lives_ok(
  format($$insert into storage.objects (bucket_id, name) values ('media', %L)$$,
         (select a ->> 'company' from fx) || '/test/ok.webp'),
  'owner A sube a su carpeta');

select throws_ok(
  format($$insert into storage.objects (bucket_id, name) values ('media', %L)$$,
         (select b ->> 'company' from fx) || '/test/hack.webp'),
  '42501', null, 'owner A no sube a la carpeta de B');

select throws_ok(
  format($$select public.company_storage_usage(%L)$$, (select b ->> 'company' from fx)),
  '42501', null, 'owner A no consulta el uso de almacenamiento de B');

select tests.clear_authentication();
select * from finish();
rollback;
