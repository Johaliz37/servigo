-- Fase 05: reglas de sedes y contenido que un CHECK no puede expresar.

-- ---------------------------------------------------------------------------
-- Interruptor de la sección de patrocinadores por sede (fase 05 §6).
-- ---------------------------------------------------------------------------
alter table public.branches add column show_sponsors boolean not null default true;

-- ---------------------------------------------------------------------------
-- Toda empresa conserva al menos una sede activa. AFTER: con la empresa ya borrada
-- (cascada) no se exige nada.
-- ---------------------------------------------------------------------------
create function public.branches_keep_one_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not old.is_active then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.is_active then
    return null;
  end if;
  if not exists (select 1 from public.companies c where c.id = old.company_id) then
    return null;
  end if;
  if not exists (
    select 1 from public.branches b where b.company_id = old.company_id and b.is_active
  ) then
    raise exception 'La empresa debe tener al menos una sede activa' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger branches_keep_one_active
  after update of is_active or delete on public.branches
  for each row execute function public.branches_keep_one_active();

-- ---------------------------------------------------------------------------
-- Una sede con reservas no se borra: se inactiva (el FK `on delete restrict` daría un
-- mensaje genérico).
-- ---------------------------------------------------------------------------
create function public.branches_block_delete_with_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Borrar la empresa entera (cascada) sí se permite: en ese momento ya no existe.
  if exists (select 1 from public.companies c where c.id = old.company_id)
     and exists (select 1 from public.bookings b where b.branch_id = old.id) then
    raise exception 'La sede "%" tiene reservas: inactívala en lugar de borrarla', old.name
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger branches_block_delete_with_bookings
  before delete on public.branches
  for each row execute function public.branches_block_delete_with_bookings();

-- ---------------------------------------------------------------------------
-- Al encender "Catálogo propio" por primera vez se copian los ítems activos de la
-- empresa, para partir de algo (fase 05 §4). Corre con los permisos del usuario (RLS).
-- ---------------------------------------------------------------------------
create function public.branches_seed_own_catalog()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.own_catalog and not old.own_catalog
     and not exists (select 1 from public.branch_catalog_items bci where bci.branch_id = new.id) then
    insert into public.branch_catalog_items (company_id, branch_id, item_id)
    select new.company_id, new.id, ci.id
    from public.catalog_items ci
    where ci.company_id = new.company_id and ci.is_active;
  end if;
  return null;
end;
$$;

create trigger branches_seed_own_catalog
  after update of own_catalog on public.branches
  for each row execute function public.branches_seed_own_catalog();

revoke execute on function
  public.branches_keep_one_active(),
  public.branches_block_delete_with_bookings(),
  public.branches_seed_own_catalog()
from authenticated;

-- ---------------------------------------------------------------------------
-- reorder_rows(tabla, ids): sort_order = posición en el arreglo. Con los permisos del
-- usuario: RLS decide qué filas puede mover; si alguna no se pudo, no se mueve ninguna.
-- ---------------------------------------------------------------------------
create function public.reorder_rows(p_table text, p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_table not in ('branches', 'sponsors', 'social_links') then
    raise exception 'Tabla no ordenable: %', p_table using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  execute format(
    'update public.%I t set sort_order = o.pos
       from unnest($1) with ordinality as o (id, pos)
      where t.id = o.id', p_table)
    using p_ids;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(p_ids) then
    raise exception 'No tienes permiso para ordenar estos elementos' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.reorder_rows(text, uuid[]) to authenticated, service_role;
