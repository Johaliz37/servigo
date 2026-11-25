-- Fase 06: precios (gemelos SQL de src/shared/pricing.ts), catálogo efectivo por sede,
-- guardado transaccional de ítems y reglas de borrado.

-- ---------------------------------------------------------------------------
-- Precios. DEBEN coincidir con src/shared/pricing.ts (ver fase06_pricing.test.sql y
-- pricing.parity.test.ts, que verifican los mismos casos en ambos lados).
-- ---------------------------------------------------------------------------

-- Decimales con que se cobra: 0 en monedas sin centavos de uso común, 2 en el resto.
create function public.currency_digits(p_currency text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when upper(p_currency) in ('COP', 'CLP', 'PYG', 'JPY', 'KRW') then 0 else 2 end;
$$;

-- Ahorro de un descuento sobre una base ya redondeada; nunca supera la base.
create function public.discount_amount(
  p_base numeric,
  p_type public.discount_type,
  p_value numeric,
  p_digits int
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select least(
    case when p_type = 'percent' then round(p_base * p_value / 100, p_digits) else round(p_value, p_digits) end,
    p_base
  );
$$;

-- Descuento vigente con mayor ahorro (empate: vence antes; luego id). Recibe las filas para
-- poder probarse sin datos: effective_catalog le pasa los descuentos del ítem.
create function public.pick_discount(
  p_discounts public.discounts[],
  p_base numeric,
  p_digits int,
  p_branch uuid,
  p_at timestamptz
)
returns table (discount_id uuid, amount numeric)
language sql
immutable
set search_path = ''
as $$
  select d.id, public.discount_amount(p_base, d.type, d.value, p_digits)
  from unnest(p_discounts) d
  where d.is_active
    and (d.starts_at is null or d.starts_at <= p_at)
    and p_at <= d.ends_at
    and (d.branch_id is null or d.branch_id = p_branch)
  order by 2 desc, d.ends_at, d.id
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- effective_catalog(sede, at): ítems activos que se ofrecen en la sede, con su precio.
-- Sede sin catálogo propio → todo el catálogo activo de la empresa. Con catálogo propio →
-- solo lo marcado en branch_catalog_items, con su precio de sede si lo tiene.
-- Datos públicos (lo que verá el sitio): security definer, pero solo de empresas y sedes
-- activas. Las RPC públicas de la fase 09 y create_booking (fase 10) lo usan.
-- ---------------------------------------------------------------------------
create function public.effective_catalog(p_branch uuid, p_at timestamptz default now())
returns table (
  item_id uuid,
  kind public.catalog_kind,
  name text,
  reference text,
  short_description text,
  description text,
  duration_minutes int,
  buffer_before_minutes int,
  buffer_after_minutes int,
  capacity int,
  allow_in_booking boolean,
  stock int,
  is_featured boolean,
  sort_order int,
  cover_path text,
  cover_alt text,
  currency text,
  base_price numeric,
  discount_id uuid,
  discount_label text,
  discount_type public.discount_type,
  discount_value numeric,
  discount_ends_at timestamptz,
  discount_amount numeric,
  final_price numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ci.id, ci.kind, ci.name, ci.reference, ci.short_description, ci.description,
    ci.duration_minutes, ci.buffer_before_minutes, ci.buffer_after_minutes, ci.capacity,
    ci.allow_in_booking, ci.stock, ci.is_featured, ci.sort_order,
    cover.path, cover.alt,
    c.currency::text,
    p.base,
    d.id, nullif(d.label, ''), d.type, d.value, d.ends_at,
    coalesce(pd.amount, 0),
    p.base - coalesce(pd.amount, 0)
  from public.branches b
  join public.companies c on c.id = b.company_id and c.status = 'active'
  join public.catalog_items ci on ci.company_id = b.company_id and ci.is_active
  left join public.branch_catalog_items bci
    on b.own_catalog and bci.branch_id = b.id and bci.item_id = ci.id
  cross join lateral (
    select round(coalesce(bci.price_override, ci.price), public.currency_digits(c.currency)) as base
  ) p
  left join lateral public.pick_discount(
    array(select x from public.discounts x where x.item_id = ci.id),
    p.base, public.currency_digits(c.currency), b.id, p_at
  ) pd on true
  left join public.discounts d on d.id = pd.discount_id
  left join lateral (
    select ph.path, ph.alt
    from public.catalog_item_photos ph
    where ph.item_id = ci.id
    order by ph.is_cover desc, ph.sort_order, ph.created_at
    limit 1
  ) cover on true
  where b.id = p_branch
    and b.is_active
    and (not b.own_catalog or bci.is_active is true)
  order by ci.kind, ci.sort_order, ci.name;
$$;

-- Productos que se pueden añadir al reservar el servicio en la sede: asociados al servicio,
-- con allow_in_booking, disponibles en la sede y con stock (si lo controlan).
create function public.effective_addons(p_service uuid, p_branch uuid, p_at timestamptz default now())
returns table (
  item_id uuid,
  name text,
  reference text,
  short_description text,
  stock int,
  cover_path text,
  cover_alt text,
  currency text,
  base_price numeric,
  discount_id uuid,
  discount_label text,
  discount_type public.discount_type,
  discount_value numeric,
  discount_ends_at timestamptz,
  discount_amount numeric,
  final_price numeric,
  max_quantity int
)
language sql
stable
security definer
set search_path = ''
as $$
  with cat as (select * from public.effective_catalog(p_branch, p_at))
  select
    e.item_id, e.name, e.reference, e.short_description, e.stock, e.cover_path, e.cover_alt, e.currency,
    e.base_price, e.discount_id, e.discount_label, e.discount_type, e.discount_value, e.discount_ends_at,
    e.discount_amount, e.final_price,
    case when e.stock is null then sp.max_quantity else least(sp.max_quantity, e.stock) end
  from public.service_products sp
  join cat e on e.item_id = sp.product_id and e.kind = 'product'
  where sp.service_id = p_service
    and e.allow_in_booking
    and (e.stock is null or e.stock > 0)
    and exists (select 1 from cat s where s.item_id = p_service and s.kind = 'service')
  order by sp.sort_order, e.name;
$$;

-- ---------------------------------------------------------------------------
-- upsert_catalog_item(payload): crea o actualiza un ítem y, en la misma transacción,
-- reemplaza las colecciones presentes en el payload (details, photos, discounts, products,
-- branches). Con los permisos del usuario (RLS: solo owner/admin escriben).
--
-- payload = { id?, company_id (al crear), kind (al crear), name, reference, short_description,
--   description, price, duration_minutes, buffer_before_minutes, buffer_after_minutes,
--   capacity, allow_in_booking, stock, is_active, is_featured,
--   details?: [{label, value}], photos?: [{path, thumb_path, alt, is_cover}],
--   discounts?: [{id?, label, type, value, starts_at, ends_at, branch_id, is_active}],
--   products?: [{product_id, max_quantity}]  (solo servicios),
--   branches?: [{branch_id, is_active, price_override}]  (sedes con catálogo propio) }
-- El orden de cada lista es su sort_order.
-- ---------------------------------------------------------------------------
create function public.upsert_catalog_item(p_payload jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  r public.catalog_items := jsonb_populate_record(null::public.catalog_items, p_payload);
  v_id uuid := r.id;
  v_company uuid;
  v_kind public.catalog_kind;
begin
  if v_id is null then
    if r.company_id is null or r.kind is null then
      raise exception 'Faltan la empresa o el tipo del ítem' using errcode = '22023';
    end if;
    if not public.has_company_role(r.company_id, '{owner,admin}') then
      raise exception 'No tienes permiso para editar el catálogo' using errcode = '42501';
    end if;
    insert into public.catalog_items (
      company_id, kind, name, reference, short_description, description, price,
      duration_minutes, buffer_before_minutes, buffer_after_minutes, capacity,
      allow_in_booking, stock, is_active, is_featured, sort_order
    )
    values (
      r.company_id, r.kind, r.name, nullif(btrim(r.reference), ''), r.short_description, r.description, r.price,
      r.duration_minutes, coalesce(r.buffer_before_minutes, 0), coalesce(r.buffer_after_minutes, 0),
      coalesce(r.capacity, 1), coalesce(r.allow_in_booking, false), r.stock,
      coalesce(r.is_active, true), coalesce(r.is_featured, false),
      coalesce((
        select max(ci.sort_order) + 1 from public.catalog_items ci
        where ci.company_id = r.company_id and ci.kind = r.kind
      ), 0)
    )
    returning id, company_id, kind into v_id, v_company, v_kind;
  else
    update public.catalog_items ci set
      name = r.name,
      reference = nullif(btrim(r.reference), ''),
      short_description = r.short_description,
      description = r.description,
      price = r.price,
      duration_minutes = r.duration_minutes,
      buffer_before_minutes = coalesce(r.buffer_before_minutes, 0),
      buffer_after_minutes = coalesce(r.buffer_after_minutes, 0),
      capacity = coalesce(r.capacity, 1),
      allow_in_booking = coalesce(r.allow_in_booking, false),
      stock = r.stock,
      is_active = coalesce(r.is_active, true),
      is_featured = coalesce(r.is_featured, false)
    where ci.id = v_id
    returning ci.company_id, ci.kind into v_company, v_kind;
    if not found then
      raise exception 'No tienes permiso para editar este ítem' using errcode = '42501';
    end if;
  end if;

  if p_payload ? 'details' then
    delete from public.catalog_item_details where item_id = v_id;
    insert into public.catalog_item_details (company_id, item_id, label, value, sort_order)
    select v_company, v_id, btrim(e ->> 'label'), nullif(btrim(e ->> 'value'), ''), o::int
    from jsonb_array_elements(p_payload -> 'details') with ordinality as t (e, o);
  end if;

  if p_payload ? 'photos' then
    delete from public.catalog_item_photos where item_id = v_id;
    insert into public.catalog_item_photos (company_id, item_id, path, thumb_path, alt, is_cover, sort_order)
    select v_company, v_id, e ->> 'path', e ->> 'thumb_path', nullif(btrim(e ->> 'alt'), ''),
           coalesce((e ->> 'is_cover')::boolean, false), o::int
    from jsonb_array_elements(p_payload -> 'photos') with ordinality as t (e, o);
  end if;

  if p_payload ? 'discounts' then
    delete from public.discounts where item_id = v_id;
    insert into public.discounts (id, company_id, item_id, label, type, value, starts_at, ends_at, branch_id, is_active)
    select coalesce(d.id, gen_random_uuid()), v_company, v_id, coalesce(btrim(d.label), ''), d.type, d.value,
           d.starts_at, d.ends_at, d.branch_id, coalesce(d.is_active, true)
    from jsonb_populate_recordset(null::public.discounts, p_payload -> 'discounts') d;
  end if;

  if p_payload ? 'products' and v_kind = 'service' then
    delete from public.service_products where service_id = v_id;
    insert into public.service_products (company_id, service_id, product_id, max_quantity, sort_order)
    select v_company, v_id, (e ->> 'product_id')::uuid, coalesce((e ->> 'max_quantity')::int, 10), o::int
    from jsonb_array_elements(p_payload -> 'products') with ordinality as t (e, o);
  end if;

  if p_payload ? 'branches' then
    insert into public.branch_catalog_items (company_id, branch_id, item_id, is_active, price_override)
    select v_company, (e ->> 'branch_id')::uuid, v_id, coalesce((e ->> 'is_active')::boolean, true),
           (e ->> 'price_override')::numeric
    from jsonb_array_elements(p_payload -> 'branches') as t (e)
    on conflict (branch_id, item_id) do update
      set is_active = excluded.is_active, price_override = excluded.price_override;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Un ítem con reservas no se borra: se inactiva (los servicios tienen FK restrict con un
-- mensaje genérico; los productos quedarían sin enlace en booking_items).
-- ---------------------------------------------------------------------------
create function public.catalog_items_block_delete_with_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Borrar la empresa entera (cascada) sí se permite: en ese momento ya no existe.
  if exists (select 1 from public.companies c where c.id = old.company_id)
     and (
       exists (select 1 from public.bookings b where b.service_id = old.id)
       or exists (select 1 from public.booking_items bi where bi.product_id = old.id)
     ) then
    raise exception '"%" tiene reservas: inactívalo en lugar de borrarlo', old.name using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger catalog_items_block_delete_with_bookings
  before delete on public.catalog_items
  for each row execute function public.catalog_items_block_delete_with_bookings();

revoke execute on function public.catalog_items_block_delete_with_bookings() from authenticated;

-- ---------------------------------------------------------------------------
-- reorder_rows: ahora también ordena el catálogo.
-- ---------------------------------------------------------------------------
create or replace function public.reorder_rows(p_table text, p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_table not in ('branches', 'sponsors', 'social_links', 'catalog_items') then
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

grant execute on function
  public.currency_digits(text),
  public.discount_amount(numeric, public.discount_type, numeric, int),
  public.pick_discount(public.discounts[], numeric, int, uuid, timestamptz),
  public.effective_catalog(uuid, timestamptz),
  public.effective_addons(uuid, uuid, timestamptz),
  public.upsert_catalog_item(jsonb)
to authenticated, service_role;
