-- Triggers transversales: updated_at, company_id inmutable, consistencia entre tenants
-- y reglas de negocio que un CHECK no puede expresar.

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- company_id no puede cambiar (mover filas entre empresas rompería el aislamiento)
-- ---------------------------------------------------------------------------

create function public.lock_company_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'company_id no se puede modificar en %', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- enforce_company_consistency(col, tabla_padre [, col, tabla_padre ...])
-- Verifica que cada referencia apunte a una fila de la MISMA empresa. Para columnas
-- uuid[] (branch_ids, service_ids) exige además que todos los ids existan.
-- security definer: debe ver el padre aunque RLS lo oculte al usuario; si no, una
-- referencia a otra empresa pasaría (las FK no aplican RLS).
-- ---------------------------------------------------------------------------

create function public.enforce_company_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_col text;
  v_parent text;
  v_ids uuid[];
  v_company uuid;
  v_count int;
begin
  for i in 0..(tg_nargs / 2 - 1) loop
    v_col := tg_argv[i * 2];
    v_parent := tg_argv[i * 2 + 1];

    if jsonb_typeof(v_row -> v_col) = 'array' then
      select array_agg(distinct t.x::uuid) into v_ids
      from jsonb_array_elements_text(v_row -> v_col) as t (x);

      if v_ids is not null then
        execute format('select count(*) from public.%I where id = any($1) and company_id = $2', v_parent)
          into v_count using v_ids, new.company_id;
        if v_count <> cardinality(v_ids) then
          raise exception '%.%: hay ids que no pertenecen a la empresa', tg_table_name, v_col
            using errcode = '23503';
        end if;
      end if;

    elsif v_row ->> v_col is not null then
      execute format('select company_id from public.%I where id = $1', v_parent)
        into v_company using (v_row ->> v_col)::uuid;
      -- Si el padre no existe, la FK lo rechazará al final de la sentencia.
      if v_company is not null and v_company <> new.company_id then
        raise exception '%.% apunta a otra empresa', tg_table_name, v_col using errcode = '23503';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- enforce_item_kind(col, kind [, col, kind ...]): la referencia a catalog_items es del tipo esperado.
-- ---------------------------------------------------------------------------

create function public.enforce_item_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_kind text;
begin
  for i in 0..(tg_nargs / 2 - 1) loop
    if v_row ->> tg_argv[i * 2] is not null then
      select c.kind::text into v_kind from public.catalog_items c where c.id = (v_row ->> tg_argv[i * 2])::uuid;
      if v_kind is not null and v_kind <> tg_argv[i * 2 + 1] then
        raise exception '%.% debe ser un ítem de tipo %', tg_table_name, tg_argv[i * 2], tg_argv[i * 2 + 1]
          using errcode = '23514';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

-- Máximo 8 fotos por ítem.
create function public.limit_item_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.catalog_item_photos p where p.item_id = new.item_id) >= 8 then
    raise exception 'Un ítem admite como máximo 8 fotos' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Solo platform_admin cambia slug o estado de una empresa (los miembros editan el resto).
-- Sin JWT (seed, service_role, SQL directo) se permite.
create function public.companies_guard_platform_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.slug is distinct from old.slug or new.status is distinct from old.status)
     and coalesce(auth.role(), '') = 'authenticated'
     and not public.is_platform_admin() then
    raise exception 'Solo el superadmin puede cambiar slug o estado de la empresa' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aplicación
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  -- updated_at en todas las tablas que lo tienen.
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t);
  end loop;

  -- company_id inmutable en todas las tablas de tenant.
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'company_id' and tb.table_type = 'BASE TABLE'
  loop
    execute format(
      'create trigger lock_company_id before update on public.%I for each row execute function public.lock_company_id()',
      t);
  end loop;
end;
$$;

create trigger companies_guard_platform_fields
  before update on public.companies
  for each row execute function public.companies_guard_platform_fields();

-- Consistencia de company_id con cada tabla padre.
create trigger enforce_company_consistency before insert or update on public.company_members
  for each row execute function public.enforce_company_consistency('branch_ids', 'branches');
create trigger enforce_company_consistency before insert or update on public.company_invitations
  for each row execute function public.enforce_company_consistency('branch_ids', 'branches');
create trigger enforce_company_consistency before insert or update on public.about_sections
  for each row execute function public.enforce_company_consistency('branch_id', 'branches');
create trigger enforce_company_consistency before insert or update on public.sponsors
  for each row execute function public.enforce_company_consistency('branch_id', 'branches');
create trigger enforce_company_consistency before insert or update on public.social_links
  for each row execute function public.enforce_company_consistency('branch_id', 'branches');
create trigger enforce_company_consistency before insert or update on public.catalog_item_details
  for each row execute function public.enforce_company_consistency('item_id', 'catalog_items');
create trigger enforce_company_consistency before insert or update on public.catalog_item_photos
  for each row execute function public.enforce_company_consistency('item_id', 'catalog_items');
create trigger enforce_company_consistency before insert or update on public.discounts
  for each row execute function public.enforce_company_consistency('item_id', 'catalog_items', 'branch_id', 'branches');
create trigger enforce_company_consistency before insert or update on public.service_products
  for each row execute function public.enforce_company_consistency(
    'service_id', 'catalog_items', 'product_id', 'catalog_items');
create trigger enforce_company_consistency before insert or update on public.branch_catalog_items
  for each row execute function public.enforce_company_consistency('branch_id', 'branches', 'item_id', 'catalog_items');
create trigger enforce_company_consistency before insert or update on public.booking_fields
  for each row execute function public.enforce_company_consistency('service_id', 'catalog_items');
create trigger enforce_company_consistency before insert or update on public.availability_events
  for each row execute function public.enforce_company_consistency(
    'branch_id', 'branches', 'recurrence_parent_id', 'availability_events', 'service_ids', 'catalog_items');
create trigger enforce_company_consistency before insert or update on public.bookings
  for each row execute function public.enforce_company_consistency(
    'branch_id', 'branches', 'service_id', 'catalog_items', 'customer_id', 'customers');
create trigger enforce_company_consistency before insert or update on public.booking_items
  for each row execute function public.enforce_company_consistency('booking_id', 'bookings', 'product_id', 'catalog_items');
create trigger enforce_company_consistency before insert or update on public.booking_answers
  for each row execute function public.enforce_company_consistency('booking_id', 'bookings', 'field_id', 'booking_fields');
create trigger enforce_company_consistency before insert or update on public.booking_events
  for each row execute function public.enforce_company_consistency('booking_id', 'bookings');

-- Tipo de ítem esperado.
create trigger enforce_item_kind before insert or update on public.service_products
  for each row execute function public.enforce_item_kind('service_id', 'service', 'product_id', 'product');
create trigger enforce_item_kind before insert or update on public.booking_fields
  for each row execute function public.enforce_item_kind('service_id', 'service');
create trigger enforce_item_kind before insert or update on public.bookings
  for each row execute function public.enforce_item_kind('service_id', 'service');
create trigger enforce_item_kind before insert or update on public.booking_items
  for each row execute function public.enforce_item_kind('product_id', 'product');

create trigger limit_item_photos before insert on public.catalog_item_photos
  for each row execute function public.limit_item_photos();
