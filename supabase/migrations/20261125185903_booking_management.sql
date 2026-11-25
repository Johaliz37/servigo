-- Fase 11: gestión de reservas desde el panel (D29).
--   · Las reservas solo cambian por RPC: el panel ya no escribe directo en bookings,
--     booking_items, booking_answers ni booking_events (salvo las notas internas). Así la
--     máquina de estados, el cupo y el historial (con el usuario que hizo cada cambio) no se
--     pueden saltar con una petición hecha a mano.
--   · change_booking_status, reschedule_booking, update_booking_admin, create_booking_admin
--     (security definer, comprueban can_access_branch: staff solo sus sedes).
--   · admin_slot_inputs: entrada del motor de cupos para el panel (excluye la propia reserva).
--   · customer_stats: clientes con nº de reservas, última visita y total gastado.
--   · Realtime: bookings en la publicación supabase_realtime (RLS decide quién recibe qué).
-- Errores propios (además de SV001–SV005 de la fase 10): SV006 transición no permitida.

-- ---------------------------------------------------------------------------
-- Búsqueda en la bandeja (código, nombre, teléfono) y pestañas.
-- ---------------------------------------------------------------------------
create index bookings_customer_name_trgm_idx on public.bookings using gin (customer_name extensions.gin_trgm_ops);
create index bookings_customer_phone_trgm_idx on public.bookings using gin (customer_phone extensions.gin_trgm_ops);
create index bookings_company_status_starts_idx on public.bookings (company_id, status, starts_at);

-- ---------------------------------------------------------------------------
-- Privilegios: lectura directa (RLS), escritura solo por RPC.
-- ---------------------------------------------------------------------------
revoke insert, update on public.bookings from authenticated;
grant update (internal_notes) on public.bookings to authenticated;
revoke insert, update, delete on public.booking_items, public.booking_answers, public.booking_events from authenticated;

-- ---------------------------------------------------------------------------
-- Tope de capacidad que el panel puede pedir: la mayor de la sede para ese servicio
-- (capacidad del servicio o algún capacity_override). El navegador calcula la capacidad real
-- de la ventana con el motor (D26); la BD no la acepta por encima de lo configurado.
-- ---------------------------------------------------------------------------
create function public.booking_capacity_cap(p_company uuid, p_branch uuid, p_service uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((select capacity from public.catalog_items where id = p_service and company_id = p_company), 1),
    coalesce((
      select max(ev.capacity_override)
      from public.availability_events ev
      where ev.company_id = p_company
        and (ev.branch_id is null or ev.branch_id = p_branch)
        and (ev.service_ids is null or p_service = any (ev.service_ids))
        and ev.kind = 'open'
    ), 1)
  );
$$;

-- ---------------------------------------------------------------------------
-- get_slot_inputs con exclusión opcional de una reserva (reprogramar no cuenta la propia).
-- ---------------------------------------------------------------------------
drop function public.get_slot_inputs(uuid, uuid, timestamptz, timestamptz);

create function public.get_slot_inputs(
  p_branch uuid,
  p_service uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_exclude uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches;
  v_company public.companies;
  v_service record;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '40 days' then
    raise exception 'Rango no válido (máximo 40 días)' using errcode = '22023';
  end if;

  select * into v_branch from public.branches where id = p_branch and is_active;
  if not found then return null; end if;
  select * into v_company from public.companies where id = v_branch.company_id and status = 'active';
  if not found then return null; end if;

  select e.item_id, e.duration_minutes, e.buffer_before_minutes, e.buffer_after_minutes, e.capacity
  into v_service
  from public.effective_catalog(p_branch) e
  where e.item_id = p_service and e.kind = 'service';
  if not found then return null; end if;

  return jsonb_build_object(
    'company_id', v_company.id,
    'branch_id', v_branch.id,
    'timezone', coalesce(v_branch.timezone, v_company.timezone),
    'settings', v_company.booking_settings,
    'service', jsonb_build_object(
      'id', v_service.item_id,
      'duration_minutes', v_service.duration_minutes,
      'buffer_before_minutes', v_service.buffer_before_minutes,
      'buffer_after_minutes', v_service.buffer_after_minutes,
      'capacity', v_service.capacity
    ),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ev.id, 'kind', ev.kind, 'starts_at', ev.starts_at, 'ends_at', ev.ends_at,
        'all_day', ev.all_day, 'timezone', ev.timezone, 'rrule', ev.rrule, 'exdates', ev.exdates,
        'recurrence_parent_id', ev.recurrence_parent_id,
        'recurrence_original_start', ev.recurrence_original_start,
        'service_ids', ev.service_ids, 'capacity_override', ev.capacity_override
      ) order by ev.starts_at, ev.id)
      from public.availability_events ev
      where ev.company_id = v_company.id
        and (case when v_branch.own_availability then ev.branch_id = v_branch.id else ev.branch_id is null end)
        and (ev.service_ids is null or p_service = any (ev.service_ids))
        and (ev.rrule is not null
             or (ev.starts_at < p_to + interval '1 day' and ev.ends_at > p_from - interval '1 day'))
    ), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'block_starts_at', bk.block_starts_at, 'block_ends_at', bk.block_ends_at,
        'service_id', bk.service_id, 'status', bk.status
      ) order by bk.block_starts_at)
      from public.bookings bk
      where bk.branch_id = v_branch.id
        and bk.service_id = p_service
        and bk.status in ('pending', 'confirmed')
        and bk.id is distinct from p_exclude
        and bk.block_starts_at < p_to + interval '1 day'
        and bk.block_ends_at > p_from - interval '1 day'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_slot_inputs(uuid, uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.get_slot_inputs(uuid, uuid, timestamptz, timestamptz, uuid) to service_role;

-- Para el panel: lo mismo, solo si el usuario tiene acceso a la sede.
create function public.admin_slot_inputs(
  p_branch uuid,
  p_service uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_exclude uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.branches where id = p_branch;
  if v_company is null or not public.can_access_branch(v_company, p_branch) then
    raise exception 'No tienes acceso a esta sede' using errcode = '42501';
  end if;
  return public.get_slot_inputs(p_branch, p_service, p_from, p_to, p_exclude);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_booking_core: la lógica de create_booking (fase 10), parametrizada por origen.
--   p_source 'web'   → estado según auto_confirm; capacidad la del Worker.
--   p_source 'admin' → estado del payload (pending | confirmed, por defecto confirmed),
--                      created_by = p_actor; con p_force no se revisan hora ni cupo.
-- ---------------------------------------------------------------------------
create function public.create_booking_core(p_payload jsonb, p_source text, p_actor uuid, p_force boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
  v_branch public.branches;
  v_service record;
  v_customer_id uuid;
  v_starts timestamptz := (p_payload ->> 'starts_at')::timestamptz;
  v_capacity int := coalesce((p_payload ->> 'capacity')::int, 0);
  v_block_start timestamptz;
  v_block_end timestamptz;
  v_ends timestamptz;
  v_used int;
  v_status public.booking_status;
  v_digits int;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_addon record;
  v_qty int;
  v_products_total numeric := 0;
  v_items_discount numeric := 0;
  v_items_total numeric := 0;
  v_answers jsonb;
  v_name text := btrim(p_payload #>> '{customer,name}');
  v_phone text := btrim(p_payload #>> '{customer,phone}');
  v_email text := nullif(btrim(coalesce(p_payload #>> '{customer,email}', '')), '');
  v_notes text := nullif(btrim(coalesce(p_payload #>> '{customer,notes}', '')), '');
  v_booking_id uuid;
  v_code text;
  v_total numeric;
begin
  -- Empresa, sede y servicio activos ---------------------------------------------
  select * into v_company from public.companies
  where id = (p_payload ->> 'company_id')::uuid and status = 'active';
  if not found then raise exception 'La empresa no está disponible' using errcode = 'SV004'; end if;

  select * into v_branch from public.branches
  where id = (p_payload ->> 'branch_id')::uuid and company_id = v_company.id and is_active;
  if not found then raise exception 'La sede no está disponible' using errcode = 'SV004'; end if;

  -- Una reserva a la vez por sede y servicio: la revalidación de cupo es atómica.
  perform pg_advisory_xact_lock(hashtext(v_branch.id::text || ':' || (p_payload ->> 'service_id')));

  select * into v_service from public.effective_catalog(v_branch.id, now()) e
  where e.item_id = (p_payload ->> 'service_id')::uuid and e.kind = 'service';
  if not found then raise exception 'El servicio no está disponible' using errcode = 'SV004'; end if;

  -- Datos del cliente ----------------------------------------------------------------
  if v_name is null or length(v_name) not between 1 and 160 then
    raise exception 'Escribe el nombre' using errcode = 'SV003';
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Teléfono no válido' using errcode = 'SV003';
  end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Correo no válido' using errcode = 'SV003';
  end if;
  if v_email is null and p_source = 'web'
     and coalesce((v_company.booking_settings ->> 'require_email')::boolean, false) then
    raise exception 'El correo es obligatorio' using errcode = 'SV003';
  end if;
  if v_notes is not null and length(v_notes) > 1000 then
    raise exception 'Las notas son demasiado largas' using errcode = 'SV003';
  end if;

  -- Horario y capacidad ----------------------------------------------------------------
  if v_starts is null then
    raise exception 'Ese horario ya no está disponible' using errcode = 'SV001';
  end if;
  v_ends := v_starts + make_interval(mins => v_service.duration_minutes);
  v_block_start := v_starts - make_interval(mins => v_service.buffer_before_minutes);
  v_block_end := v_ends + make_interval(mins => v_service.buffer_after_minutes);

  if not p_force then
    if v_starts <= now() then
      raise exception 'Ese horario ya no está disponible' using errcode = 'SV001';
    end if;
    -- La del Worker es la del motor (confiable); la del panel viene del navegador y se acota.
    if p_source = 'admin' then
      v_capacity := least(v_capacity, public.booking_capacity_cap(v_company.id, v_branch.id, v_service.item_id));
    end if;
    if v_capacity < 1 then
      raise exception 'Capacidad no válida' using errcode = 'SV001';
    end if;
    select count(*) into v_used
    from public.bookings bk
    where bk.branch_id = v_branch.id
      and bk.service_id = v_service.item_id
      and bk.status in ('pending', 'confirmed')
      and tstzrange(bk.block_starts_at, bk.block_ends_at) && tstzrange(v_block_start, v_block_end);
    if v_used >= v_capacity then
      raise exception 'SLOT_TAKEN' using errcode = 'SV001';
    end if;
  end if;

  -- Productos: permitidos, con cantidad y stock (D24: precio de effective_addons) ----------
  v_digits := public.currency_digits(v_company.currency);
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    v_qty := (v_item ->> 'quantity')::int;
    if v_qty is null or v_qty < 1 then
      raise exception 'Cantidad no válida' using errcode = 'SV002';
    end if;
    select * into v_addon from public.effective_addons(v_service.item_id, v_branch.id, now()) a
    where a.item_id = (v_item ->> 'product_id')::uuid;
    if not found then
      raise exception 'Un producto no está disponible para este servicio' using errcode = 'SV002';
    end if;
    if v_qty > v_addon.max_quantity then
      raise exception 'Cantidad no disponible de «%»', v_addon.name using errcode = 'SV002';
    end if;
    if v_items @> jsonb_build_array(jsonb_build_object('product_id', v_addon.item_id)) then
      raise exception 'Producto repetido' using errcode = 'SV002';
    end if;
    -- Descontar stock (si lo controla) sin dejarlo negativo.
    update public.catalog_items set stock = stock - v_qty
    where id = v_addon.item_id and stock is not null;
    if found and (select stock from public.catalog_items where id = v_addon.item_id) < 0 then
      raise exception 'No hay stock suficiente de «%»', v_addon.name using errcode = 'SV002';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_addon.item_id, 'name', v_addon.name, 'unit_price', v_addon.base_price,
      'discount', round(v_addon.discount_amount * v_qty, v_digits), 'quantity', v_qty,
      'line_total', round(v_addon.final_price * v_qty, v_digits)));
    v_products_total := v_products_total + round(v_addon.base_price * v_qty, v_digits);
    v_items_discount := v_items_discount + round(v_addon.discount_amount * v_qty, v_digits);
    v_items_total := v_items_total + round(v_addon.final_price * v_qty, v_digits);
  end loop;

  v_answers := public.validate_booking_answers(v_company.id, v_service.item_id, p_payload -> 'answers');

  -- Cliente (por teléfono dentro de la empresa) ------------------------------------------
  insert into public.customers (company_id, name, phone, email)
  values (v_company.id, v_name, v_phone, v_email)
  on conflict (company_id, phone) do update
    set name = excluded.name, email = coalesce(excluded.email, public.customers.email)
  returning id into v_customer_id;

  if p_source = 'admin' then
    v_status := coalesce(nullif(p_payload ->> 'status', ''), 'confirmed')::public.booking_status;
    if v_status not in ('pending', 'confirmed') then
      raise exception 'Estado inicial no válido' using errcode = 'SV006';
    end if;
  else
    v_status := (case when coalesce((v_company.booking_settings ->> 'auto_confirm')::boolean, false)
                      then 'confirmed' else 'pending' end)::public.booking_status;
  end if;
  -- = bookingTotals: total = subtotal − descuentos, todo ya redondeado a la moneda.
  v_total := v_service.final_price + v_items_total;

  -- Reserva con código único (reintento ante colisión) ---------------------------------
  for i in 1..5 loop
    begin
      insert into public.bookings (
        company_id, branch_id, service_id, customer_id, code, status,
        starts_at, ends_at, block_starts_at, block_ends_at,
        customer_name, customer_phone, customer_email, customer_notes,
        service_name, service_price, service_discount, products_total, discount_total, total, currency, source,
        created_by
      )
      values (
        v_company.id, v_branch.id, v_service.item_id, v_customer_id, public.generate_booking_code(), v_status,
        v_starts, v_ends, v_block_start, v_block_end,
        v_name, v_phone, v_email, v_notes,
        v_service.name, v_service.base_price, v_service.discount_amount, v_products_total,
        v_service.discount_amount + v_items_discount, v_total, v_company.currency, p_source,
        p_actor
      )
      returning id, code into v_booking_id, v_code;
      exit;
    exception when unique_violation then
      if i = 5 then raise; end if;
    end;
  end loop;

  insert into public.booking_items (company_id, booking_id, product_id, name, unit_price, discount, quantity, line_total)
  select v_company.id, v_booking_id, (x ->> 'product_id')::uuid, x ->> 'name', (x ->> 'unit_price')::numeric,
         (x ->> 'discount')::numeric, (x ->> 'quantity')::int, (x ->> 'line_total')::numeric
  from jsonb_array_elements(v_items) x;

  insert into public.booking_answers (company_id, booking_id, field_id, label, type, value)
  select v_company.id, v_booking_id, (x ->> 'field_id')::uuid, x ->> 'label', (x ->> 'type')::public.field_type, x -> 'value'
  from jsonb_array_elements(v_answers) x;

  insert into public.booking_events (company_id, booking_id, actor, action, payload)
  values (v_company.id, v_booking_id, p_actor, 'created',
          jsonb_build_object('source', p_source, 'status', v_status)
            || case when p_force then '{"forced": true}'::jsonb else '{}'::jsonb end);

  return jsonb_build_object(
    'id', v_booking_id, 'code', v_code, 'status', v_status, 'starts_at', v_starts, 'total', v_total,
    'phone', v_phone
  );
end;
$$;

-- create_booking (fase 10, Worker): misma firma y comportamiento, ahora sobre el núcleo.
create or replace function public.create_booking(p_payload jsonb)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select public.create_booking_core(p_payload, 'web', null, false);
$$;

-- ---------------------------------------------------------------------------
-- create_booking_admin(payload): reserva manual del panel (sin Turnstile). Mismo payload que
-- create_booking más `status` (pending | confirmed) y `force` (solo owner/admin: fuera de
-- disponibilidad o en el pasado).
-- ---------------------------------------------------------------------------
create function public.create_booking_admin(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company uuid := (p_payload ->> 'company_id')::uuid;
  v_branch uuid := (p_payload ->> 'branch_id')::uuid;
  v_force boolean := coalesce((p_payload ->> 'force')::boolean, false);
begin
  if v_company is null or v_branch is null
     or not exists (select 1 from public.branches where id = v_branch and company_id = v_company)
     or not public.can_access_branch(v_company, v_branch) then
    raise exception 'No tienes acceso a esta sede' using errcode = '42501';
  end if;
  if v_force and not public.has_company_role(v_company, '{owner,admin}') then
    raise exception 'Solo propietarios y administradores pueden forzar un horario' using errcode = '42501';
  end if;
  return public.create_booking_core(p_payload, 'admin', (select auth.uid()), v_force);
end;
$$;

-- ---------------------------------------------------------------------------
-- Máquina de estados (fase 11):
--   pending → confirmed | cancelled;  confirmed → completed | no_show | cancelled.
--   completed y no_show solo si la hora ya pasó.
-- ---------------------------------------------------------------------------
create function public.booking_transition_allowed(
  p_from public.booking_status,
  p_to public.booking_status,
  p_starts_at timestamptz,
  p_now timestamptz default now()
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from = 'pending' then p_to in ('confirmed', 'cancelled')
    when p_from = 'confirmed' then p_to = 'cancelled' or (p_to in ('completed', 'no_show') and p_starts_at <= p_now)
    else false
  end;
$$;

-- Bloquea la reserva y comprueba el acceso a su sede. 42501 si no existe o no es accesible
-- (no revela si existe en otra sede o empresa).
create function public.lock_booking_for_admin(p_booking uuid)
returns public.bookings
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking for update;
  if not found or not public.can_access_branch(v_booking.company_id, v_booking.branch_id) then
    raise exception 'No tienes acceso a esta reserva' using errcode = '42501';
  end if;
  return v_booking;
end;
$$;

create function public.change_booking_status(
  p_booking uuid,
  p_to public.booking_status,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings := public.lock_booking_for_admin(p_booking);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.booking_transition_allowed(v_booking.status, p_to, v_booking.starts_at) then
    raise exception 'No se puede pasar de «%» a «%»', v_booking.status, p_to using errcode = 'SV006';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'El motivo es demasiado largo' using errcode = 'SV003';
  end if;

  update public.bookings
  set status = p_to,
      cancelled_at = case when p_to = 'cancelled' then now() end,
      cancel_reason = case when p_to = 'cancelled' then coalesce(v_reason, 'Cancelada por la empresa') end
  where id = v_booking.id;

  -- Cancelar devuelve el stock de los productos.
  if p_to = 'cancelled' then
    update public.catalog_items ci set stock = ci.stock + i.quantity
    from public.booking_items i
    where i.booking_id = v_booking.id and i.product_id = ci.id and ci.stock is not null;
  end if;

  insert into public.booking_events (company_id, booking_id, actor, action, payload)
  values (v_booking.company_id, v_booking.id, (select auth.uid()), 'status_changed',
          jsonb_build_object('from', v_booking.status, 'to', p_to, 'by', 'member')
            || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end);

  return jsonb_build_object('id', v_booking.id, 'code', v_booking.code, 'status', p_to,
                            'branch_id', v_booking.branch_id, 'service_id', v_booking.service_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- reschedule_booking(id, inicio, capacidad, forzar): misma duración y buffers de la reserva.
-- Sin forzar: inicio futuro y cupo libre (sin contar la propia) bajo el lock de create_booking.
-- Forzar: solo owner/admin.
-- ---------------------------------------------------------------------------
create function public.reschedule_booking(
  p_booking uuid,
  p_starts_at timestamptz,
  p_capacity int default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_ends timestamptz;
  v_block_start timestamptz;
  v_block_end timestamptz;
  v_capacity int;
  v_used int;
begin
  select * into v_booking from public.bookings where id = p_booking;
  if not found or not public.can_access_branch(v_booking.company_id, v_booking.branch_id) then
    raise exception 'No tienes acceso a esta reserva' using errcode = '42501';
  end if;
  -- Mismo orden de locks que create_booking: primero sede+servicio, luego la fila.
  perform pg_advisory_xact_lock(hashtext(v_booking.branch_id::text || ':' || v_booking.service_id::text));
  v_booking := public.lock_booking_for_admin(p_booking);

  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'Solo se reprograman reservas pendientes o confirmadas' using errcode = 'SV006';
  end if;
  if coalesce(p_force, false) and not public.has_company_role(v_booking.company_id, '{owner,admin}') then
    raise exception 'Solo propietarios y administradores pueden forzar un horario' using errcode = '42501';
  end if;
  if p_starts_at is null then
    raise exception 'Elige un horario' using errcode = 'SV001';
  end if;

  v_ends := p_starts_at + (v_booking.ends_at - v_booking.starts_at);
  v_block_start := p_starts_at - (v_booking.starts_at - v_booking.block_starts_at);
  v_block_end := v_ends + (v_booking.block_ends_at - v_booking.ends_at);

  if not coalesce(p_force, false) then
    if p_starts_at <= now() then
      raise exception 'Ese horario ya pasó' using errcode = 'SV001';
    end if;
    v_capacity := least(coalesce(p_capacity, 0),
                        public.booking_capacity_cap(v_booking.company_id, v_booking.branch_id, v_booking.service_id));
    if v_capacity < 1 then
      raise exception 'Ese horario no está disponible' using errcode = 'SV001';
    end if;
    select count(*) into v_used
    from public.bookings bk
    where bk.branch_id = v_booking.branch_id
      and bk.service_id = v_booking.service_id
      and bk.status in ('pending', 'confirmed')
      and bk.id <> v_booking.id
      and tstzrange(bk.block_starts_at, bk.block_ends_at) && tstzrange(v_block_start, v_block_end);
    if v_used >= v_capacity then
      raise exception 'SLOT_TAKEN' using errcode = 'SV001';
    end if;
  end if;

  update public.bookings
  set starts_at = p_starts_at, ends_at = v_ends, block_starts_at = v_block_start, block_ends_at = v_block_end
  where id = v_booking.id;

  insert into public.booking_events (company_id, booking_id, actor, action, payload)
  values (v_booking.company_id, v_booking.id, (select auth.uid()), 'rescheduled',
          jsonb_build_object('from', v_booking.starts_at, 'to', p_starts_at)
            || case when coalesce(p_force, false) then '{"forced": true}'::jsonb else '{}'::jsonb end);

  return jsonb_build_object('id', v_booking.id, 'code', v_booking.code, 'starts_at', p_starts_at,
                            'branch_id', v_booking.branch_id, 'service_id', v_booking.service_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- update_booking_admin(id, payload): edita datos del cliente, productos y respuestas.
-- payload = { customer?: {name, phone, email, notes}, items?: [{product_id, quantity}],
--             answers?: [{field_id, value}], reprice?: boolean }
-- Precios: los congelados en la reserva (servicio y productos que ya tenía); un producto nuevo
-- toma el precio actual. Con reprice, todo toma el precio actual (D24). El stock se ajusta por
-- la diferencia. Las respuestas de campos que ya no se piden se conservan.
-- ---------------------------------------------------------------------------
create function public.update_booking_admin(p_booking uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings := public.lock_booking_for_admin(p_booking);
  v_reprice boolean := coalesce((p_payload ->> 'reprice')::boolean, false);
  v_digits int;
  v_changes text[] := '{}'::text[];
  v_name text;
  v_phone text;
  v_email text;
  v_notes text;
  v_customer_id uuid;
  v_service record;
  v_service_price numeric := v_booking.service_price;
  v_service_discount numeric := v_booking.service_discount;
  v_item jsonb;
  v_old public.booking_items;
  v_addon record;
  v_has_addon boolean;
  v_qty int;
  v_unit_price numeric;
  v_unit_discount numeric;
  v_name_item text;
  v_new_items jsonb := '[]'::jsonb;
  v_answers jsonb;
  v_products_total numeric := 0;
  v_items_discount numeric := 0;
  v_items_total numeric := 0;
begin
  if v_booking.status = 'cancelled' then
    raise exception 'Una reserva cancelada no se edita' using errcode = 'SV006';
  end if;
  v_digits := public.currency_digits(v_booking.currency);

  -- Cliente ----------------------------------------------------------------------------
  if p_payload ? 'customer' then
    v_name := btrim(p_payload #>> '{customer,name}');
    v_phone := btrim(p_payload #>> '{customer,phone}');
    v_email := nullif(btrim(coalesce(p_payload #>> '{customer,email}', '')), '');
    v_notes := nullif(btrim(coalesce(p_payload #>> '{customer,notes}', '')), '');
    if v_name is null or length(v_name) not between 1 and 160 then
      raise exception 'Escribe el nombre' using errcode = 'SV003';
    end if;
    if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
      raise exception 'Teléfono no válido' using errcode = 'SV003';
    end if;
    if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
      raise exception 'Correo no válido' using errcode = 'SV003';
    end if;
    if v_notes is not null and length(v_notes) > 1000 then
      raise exception 'Las notas son demasiado largas' using errcode = 'SV003';
    end if;
    insert into public.customers (company_id, name, phone, email)
    values (v_booking.company_id, v_name, v_phone, v_email)
    on conflict (company_id, phone) do update
      set name = excluded.name, email = coalesce(excluded.email, public.customers.email)
    returning id into v_customer_id;
    update public.bookings
    set customer_id = v_customer_id, customer_name = v_name, customer_phone = v_phone,
        customer_email = v_email, customer_notes = v_notes
    where id = v_booking.id;
    v_changes := array_append(v_changes, 'customer');
  end if;

  -- Precio del servicio ------------------------------------------------------------------
  if v_reprice then
    select * into v_service from public.effective_catalog(v_booking.branch_id, now()) e
    where e.item_id = v_booking.service_id and e.kind = 'service';
    if found then
      v_service_price := v_service.base_price;
      v_service_discount := v_service.discount_amount;
    end if;
    v_changes := array_append(v_changes, 'reprice');
  end if;

  -- Productos ----------------------------------------------------------------------------
  if p_payload ? 'items' or v_reprice then
    -- Devolver el stock de lo que tenía; se vuelve a descontar lo que quede.
    update public.catalog_items ci set stock = ci.stock + i.quantity
    from public.booking_items i
    where i.booking_id = v_booking.id and i.product_id = ci.id and ci.stock is not null;

    for v_item in
      select * from jsonb_array_elements(
        case when p_payload ? 'items' then coalesce(p_payload -> 'items', '[]'::jsonb)
             else (select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'quantity', i.quantity)), '[]')
                   from public.booking_items i where i.booking_id = v_booking.id and i.product_id is not null)
        end)
    loop
      v_qty := (v_item ->> 'quantity')::int;
      if v_qty is null or v_qty < 1 or v_qty > 999 then
        raise exception 'Cantidad no válida' using errcode = 'SV002';
      end if;
      if v_new_items @> jsonb_build_array(jsonb_build_object('product_id', v_item ->> 'product_id')) then
        raise exception 'Producto repetido' using errcode = 'SV002';
      end if;
      v_old := null;
      select * into v_old from public.booking_items i
      where i.booking_id = v_booking.id and i.product_id = (v_item ->> 'product_id')::uuid;
      v_has_addon := false;
      if v_old.id is null or v_reprice then
        select * into v_addon from public.effective_addons(v_booking.service_id, v_booking.branch_id, now()) a
        where a.item_id = (v_item ->> 'product_id')::uuid;
        v_has_addon := found;
      end if;
      if v_has_addon then
        -- Producto nuevo, o «recalcular con precios actuales».
        v_name_item := v_addon.name;
        v_unit_price := v_addon.base_price;
        v_unit_discount := v_addon.discount_amount;
      elsif v_old.id is not null then
        -- Precio congelado de la reserva (por unidad); también si ya no es complemento.
        v_name_item := v_old.name;
        v_unit_price := v_old.unit_price;
        v_unit_discount := round(v_old.discount / v_old.quantity, v_digits);
      else
        raise exception 'Un producto no está disponible para este servicio' using errcode = 'SV002';
      end if;
      update public.catalog_items set stock = stock - v_qty
      where id = (v_item ->> 'product_id')::uuid and stock is not null;
      if found and (select stock from public.catalog_items where id = (v_item ->> 'product_id')::uuid) < 0 then
        raise exception 'No hay stock suficiente de «%»', v_name_item using errcode = 'SV002';
      end if;
      v_new_items := v_new_items || jsonb_build_array(jsonb_build_object(
        'product_id', v_item ->> 'product_id', 'name', v_name_item, 'unit_price', v_unit_price,
        'discount', round(v_unit_discount * v_qty, v_digits), 'quantity', v_qty,
        'line_total', round((v_unit_price - v_unit_discount) * v_qty, v_digits)));
    end loop;

    -- Las líneas sin producto (producto borrado del catálogo) se conservan tal cual.
    delete from public.booking_items where booking_id = v_booking.id and product_id is not null;
    insert into public.booking_items (company_id, booking_id, product_id, name, unit_price, discount, quantity, line_total)
    select v_booking.company_id, v_booking.id, (x ->> 'product_id')::uuid, x ->> 'name', (x ->> 'unit_price')::numeric,
           (x ->> 'discount')::numeric, (x ->> 'quantity')::int, (x ->> 'line_total')::numeric
    from jsonb_array_elements(v_new_items) x;
    if p_payload ? 'items' then v_changes := array_append(v_changes, 'items'); end if;
  end if;

  -- Totales (= bookingTotals) ------------------------------------------------------------------
  select coalesce(sum(round(i.unit_price * i.quantity, v_digits)), 0), coalesce(sum(i.discount), 0),
         coalesce(sum(i.line_total), 0)
  into v_products_total, v_items_discount, v_items_total
  from public.booking_items i where i.booking_id = v_booking.id;

  update public.bookings
  set service_price = v_service_price,
      service_discount = v_service_discount,
      products_total = v_products_total,
      discount_total = v_service_discount + v_items_discount,
      total = v_service_price - v_service_discount + v_items_total
  where id = v_booking.id;

  -- Respuestas ---------------------------------------------------------------------------
  if p_payload ? 'answers' then
    v_answers := public.validate_booking_answers(v_booking.company_id, v_booking.service_id, p_payload -> 'answers');
    delete from public.booking_answers a
    where a.booking_id = v_booking.id
      and (a.field_id in (select f.id from public.service_fields(v_booking.company_id, v_booking.service_id) f));
    insert into public.booking_answers (company_id, booking_id, field_id, label, type, value)
    select v_booking.company_id, v_booking.id, (x ->> 'field_id')::uuid, x ->> 'label',
           (x ->> 'type')::public.field_type, x -> 'value'
    from jsonb_array_elements(v_answers) x;
    v_changes := array_append(v_changes, 'answers');
  end if;

  insert into public.booking_events (company_id, booking_id, actor, action, payload)
  values (v_booking.company_id, v_booking.id, (select auth.uid()), 'edited',
          jsonb_build_object('changes', to_jsonb(v_changes),
                             'total', jsonb_build_object('from', v_booking.total,
                               'to', (select total from public.bookings where id = v_booking.id))));

  return jsonb_build_object('id', v_booking.id, 'code', v_booking.code,
                            'total', (select total from public.bookings where id = v_booking.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- booking_history(id): historial con el correo de quien hizo cada cambio (auth.users no es
-- accesible desde el cliente y staff no puede listar miembros).
-- ---------------------------------------------------------------------------
create function public.booking_history(p_booking uuid)
returns table (id uuid, action text, payload jsonb, created_at timestamptz, actor_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where bookings.id = p_booking;
  if not found or not public.can_access_branch(v_booking.company_id, v_booking.branch_id) then
    raise exception 'No tienes acceso a esta reserva' using errcode = '42501';
  end if;
  return query
    select e.id, e.action, e.payload, e.created_at, u.email::text
    from public.booking_events e
    left join auth.users u on u.id = e.actor
    where e.booking_id = p_booking
    order by e.created_at, e.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clientes con estadísticas. security_invoker: RLS de customers y bookings (staff solo cuenta
-- las reservas de sus sedes).
-- ---------------------------------------------------------------------------
create view public.customer_stats with (security_invoker = true) as
select
  c.id,
  c.company_id,
  c.name,
  c.phone,
  c.email,
  c.notes,
  c.created_at,
  count(b.id)::int as bookings_count,
  max(b.starts_at) filter (where b.status = 'completed') as last_visit_at,
  coalesce(sum(b.total) filter (where b.status = 'completed'), 0)::numeric(12, 2) as total_spent,
  min(b.starts_at) filter (where b.status in ('pending', 'confirmed') and b.starts_at >= now()) as next_booking_at
from public.customers c
left join public.bookings b on b.customer_id = c.id
group by c.id;

revoke all on public.customer_stats from anon, authenticated;
grant select on public.customer_stats to authenticated;
grant select on public.customer_stats to service_role;

-- ---------------------------------------------------------------------------
-- Tiempo real: la bandeja escucha inserts/updates de bookings (fase 11 §1).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bookings;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios de las funciones
-- ---------------------------------------------------------------------------
revoke execute on function
  public.booking_capacity_cap(uuid, uuid, uuid),
  public.admin_slot_inputs(uuid, uuid, timestamptz, timestamptz, uuid),
  public.create_booking_core(jsonb, text, uuid, boolean),
  public.create_booking(jsonb),
  public.create_booking_admin(jsonb),
  public.booking_transition_allowed(public.booking_status, public.booking_status, timestamptz, timestamptz),
  public.lock_booking_for_admin(uuid),
  public.change_booking_status(uuid, public.booking_status, text),
  public.reschedule_booking(uuid, timestamptz, int, boolean),
  public.update_booking_admin(uuid, jsonb),
  public.booking_history(uuid)
from public, anon, authenticated;

grant execute on function public.create_booking(jsonb) to service_role;
grant execute on function
  public.admin_slot_inputs(uuid, uuid, timestamptz, timestamptz, uuid),
  public.create_booking_admin(jsonb),
  public.booking_transition_allowed(public.booking_status, public.booking_status, timestamptz, timestamptz),
  public.change_booking_status(uuid, public.booking_status, text),
  public.reschedule_booking(uuid, timestamptz, int, boolean),
  public.update_booking_admin(uuid, jsonb),
  public.booking_history(uuid)
to authenticated, service_role;
