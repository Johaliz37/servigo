-- Fase 10: reserva y consulta de reservas sin cuenta.
--   get_booking_form (anon)        → lo que el asistente necesita para un servicio.
--   create_booking (service_role)  → crea la reserva en una transacción, revalidándolo todo.
--   get_booking_public / find_bookings / cancel_booking_public (service_role) → consulta.
-- Solo el Worker llama a las de service_role (secret key), después de Turnstile y del rate
-- limit (00 §3, regla 2). Errores propios: SV001 cupo tomado, SV002 producto no permitido o
-- sin stock, SV003 respuesta no válida, SV004 no disponible, SV005 no se puede cancelar.

-- ---------------------------------------------------------------------------
-- Campos que se piden para un servicio: generales + los del servicio, activos, en orden
-- (= fieldsForService en src/shared/booking-fields.ts).
-- ---------------------------------------------------------------------------
create function public.service_fields(p_company uuid, p_service uuid)
returns setof public.booking_fields
language sql
stable
security definer
set search_path = ''
as $$
  select f.*
  from public.booking_fields f
  where f.company_id = p_company
    and f.is_active
    and (f.service_id is null or f.service_id = p_service)
  order by (f.service_id is not null), f.sort_order, f.created_at;
$$;

-- ---------------------------------------------------------------------------
-- get_booking_form(slug, sede, servicio): servicio con precio, complementos, campos y
-- configuración de la reserva. null si la empresa, la sede o el servicio no están activos.
-- ---------------------------------------------------------------------------
create function public.get_booking_form(p_slug text, p_branch_slug text, p_service_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'branch', jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name', b.name, 'address', b.address, 'city', b.city,
      'timezone', coalesce(b.timezone, c.timezone)
    ),
    'service', pc.item,
    'addons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.item_id,
        'kind', 'product',
        'name', a.name,
        'short_description', a.short_description,
        'cover', case when a.cover_path is null then null
                      else jsonb_build_object('path', a.cover_path, 'alt', a.cover_alt) end,
        'price', a.base_price,
        'final_price', a.final_price,
        'discount', case when a.discount_id is null then null
                         else jsonb_build_object(
                           'label', a.discount_label, 'type', a.discount_type, 'value', a.discount_value,
                           'amount', a.discount_amount, 'ends_at', a.discount_ends_at) end,
        'max_quantity', a.max_quantity
      ))
      from public.effective_addons(pc.item_id, b.id, now()) a
    ), '[]'::jsonb),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'service_id', f.service_id, 'label', f.label, 'help_text', f.help_text,
        'placeholder', f.placeholder, 'type', f.type, 'options', f.options, 'required', f.required,
        'validation', f.validation, 'is_active', f.is_active, 'sort_order', f.sort_order
      ))
      from public.service_fields(c.id, pc.item_id) f
    ), '[]'::jsonb),
    'settings', jsonb_build_object(
      'require_email', coalesce((c.booking_settings ->> 'require_email')::boolean, false),
      'terms_text', coalesce(c.booking_settings ->> 'terms_text', ''),
      'auto_confirm', coalesce((c.booking_settings ->> 'auto_confirm')::boolean, false)
    )
  )
  from public.public_company(p_slug) c
  join lateral public.public_branch(c.id, p_branch_slug) b on b.id is not null
  join lateral public.public_catalog(b.id) pc on pc.item_id = p_service_id and pc.kind = 'service'
  where c.id is not null;
$$;

-- ---------------------------------------------------------------------------
-- Respuestas: mismas reglas que buildAnswersSchema (D25). Recibe [{field_id, value}] (ya
-- normalizado por el Worker) y devuelve las filas a guardar con copia de label y type.
-- Campos desconocidos o de otro servicio se descartan; los opcionales vacíos no se guardan.
-- ---------------------------------------------------------------------------
create function public.validate_booking_answers(p_company uuid, p_service uuid, p_answers jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.booking_fields;
  v jsonb;
  v_text text;
  v_num numeric;
  v_len int;
  v_max int;
  v_values text[];
  v_list text[];
  v_rows jsonb := '[]'::jsonb;
  v_min numeric;
  v_maxn numeric;
begin
  if p_answers is not null and jsonb_typeof(p_answers) <> 'array' then
    raise exception 'Respuestas no válidas' using errcode = 'SV003';
  end if;

  for f in select * from public.service_fields(p_company, p_service) loop
    select a -> 'value' into v
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
    where a ->> 'field_id' = f.id::text
    limit 1;
    if v = 'null'::jsonb then v := null; end if;

    if f.type in ('text', 'textarea') then
      if v is not null and jsonb_typeof(v) <> 'string' then
        raise exception '«%»: valor no válido', f.label using errcode = 'SV003';
      end if;
      v_text := nullif(regexp_replace(v #>> '{}', '^\s+|\s+$', '', 'g'), '');
      if v_text is null then
        if f.required then raise exception '«%» es obligatorio', f.label using errcode = 'SV003'; end if;
        continue;
      end if;
      v_len := length(v_text);
      v_max := least(coalesce((f.validation ->> 'maxLength')::int, case f.type when 'text' then 500 else 5000 end),
                     case f.type when 'text' then 500 else 5000 end);
      if v_len > v_max or v_len < coalesce((f.validation ->> 'minLength')::int, 0) then
        raise exception '«%»: longitud no válida', f.label using errcode = 'SV003';
      end if;
      if f.validation ? 'pattern' and v_text !~ ('^(?:' || (f.validation ->> 'pattern') || ')$') then
        raise exception '«%»: el formato no es válido', f.label using errcode = 'SV003';
      end if;
      v := to_jsonb(v_text);

    elsif f.type in ('select', 'radio') then
      if v is null or v = '""'::jsonb then
        if f.required then raise exception '«%» es obligatorio', f.label using errcode = 'SV003'; end if;
        continue;
      end if;
      if jsonb_typeof(v) <> 'string'
         or not exists (select 1 from jsonb_array_elements(f.options) o where o ->> 'value' = v #>> '{}') then
        raise exception '«%»: elige una opción de la lista', f.label using errcode = 'SV003';
      end if;

    elsif f.type = 'multiselect' then
      if v is null then v := '[]'::jsonb; end if;
      if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'string') then
        raise exception '«%»: valor no válido', f.label using errcode = 'SV003';
      end if;
      v_values := array(select jsonb_array_elements_text(v));
      v_list := array(select o ->> 'value' from jsonb_array_elements(f.options) o);
      v_min := (f.validation ->> 'min')::numeric;
      v_maxn := (f.validation ->> 'max')::numeric;
      if not (v_values <@ v_list)
         or (select count(distinct x) from unnest(v_values) x) <> cardinality(v_values)
         or (f.required and cardinality(v_values) = 0)
         or (cardinality(v_values) > 0 and v_min is not null and cardinality(v_values) < v_min)
         or (v_maxn is not null and cardinality(v_values) > v_maxn) then
        raise exception '«%»: selección no válida', f.label using errcode = 'SV003';
      end if;
      if cardinality(v_values) = 0 then continue; end if;

    elsif f.type = 'checkbox' then
      if v is null then v := 'false'::jsonb; end if;
      if jsonb_typeof(v) <> 'boolean' then
        raise exception '«%»: valor no válido', f.label using errcode = 'SV003';
      end if;
      if f.required and v <> 'true'::jsonb then
        raise exception 'Debes marcar «%»', f.label using errcode = 'SV003';
      end if;

    elsif f.type = 'number' then
      if v is null then
        if f.required then raise exception '«%» es obligatorio', f.label using errcode = 'SV003'; end if;
        continue;
      end if;
      if jsonb_typeof(v) <> 'number' then
        raise exception '«%»: escribe un número', f.label using errcode = 'SV003';
      end if;
      v_num := (v #>> '{}')::numeric;
      if v_num < (f.validation ->> 'min')::numeric or v_num > (f.validation ->> 'max')::numeric then
        raise exception '«%»: fuera de rango', f.label using errcode = 'SV003';
      end if;

    elsif f.type = 'date' then
      if v is null or v = '""'::jsonb then
        if f.required then raise exception '«%» es obligatorio', f.label using errcode = 'SV003'; end if;
        continue;
      end if;
      v_text := v #>> '{}';
      if jsonb_typeof(v) <> 'string' or v_text !~ '^\d{4}-\d{2}-\d{2}$'
         or to_char(to_date(v_text, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v_text then
        raise exception '«%»: fecha no válida', f.label using errcode = 'SV003';
      end if;
    end if;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'field_id', f.id, 'label', f.label, 'type', f.type, 'value', v));
  end loop;
  return v_rows;
exception
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'Respuesta no válida' using errcode = 'SV003';
end;
$$;

-- ---------------------------------------------------------------------------
-- create_booking(payload) — 00 §3 regla 4, fase 08 (D26) y D24/D25.
-- payload = { company_id, branch_id, service_id, starts_at, capacity,
--   customer: {name, phone, email, notes}, items: [{product_id, quantity}],
--   answers: [{field_id, value}] }
-- `capacity` es la de la ventana según el motor (capacity_override o la del servicio); el
-- Worker ya comprobó que el inicio es un cupo válido (ventana, antelación, días máximos).
-- ---------------------------------------------------------------------------
create function public.create_booking(p_payload jsonb)
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
    raise exception 'Escribe tu nombre' using errcode = 'SV003';
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Teléfono no válido' using errcode = 'SV003';
  end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Correo no válido' using errcode = 'SV003';
  end if;
  if v_email is null and coalesce((v_company.booking_settings ->> 'require_email')::boolean, false) then
    raise exception 'El correo es obligatorio' using errcode = 'SV003';
  end if;
  if v_notes is not null and length(v_notes) > 1000 then
    raise exception 'Las notas son demasiado largas' using errcode = 'SV003';
  end if;

  -- Horario y capacidad ----------------------------------------------------------------
  if v_starts is null or v_starts <= now() then
    raise exception 'Ese horario ya no está disponible' using errcode = 'SV001';
  end if;
  if v_capacity < 1 then
    raise exception 'Capacidad no válida' using errcode = 'SV001';
  end if;
  v_ends := v_starts + make_interval(mins => v_service.duration_minutes);
  v_block_start := v_starts - make_interval(mins => v_service.buffer_before_minutes);
  v_block_end := v_ends + make_interval(mins => v_service.buffer_after_minutes);

  select count(*) into v_used
  from public.bookings bk
  where bk.branch_id = v_branch.id
    and bk.service_id = v_service.item_id
    and bk.status in ('pending', 'confirmed')
    and tstzrange(bk.block_starts_at, bk.block_ends_at) && tstzrange(v_block_start, v_block_end);
  if v_used >= v_capacity then
    raise exception 'SLOT_TAKEN' using errcode = 'SV001';
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

  v_status := (case when coalesce((v_company.booking_settings ->> 'auto_confirm')::boolean, false)
                    then 'confirmed' else 'pending' end)::public.booking_status;
  -- = bookingTotals: total = subtotal − descuentos, todo ya redondeado a la moneda.
  v_total := v_service.final_price + v_items_total;

  -- Reserva con código único (reintento ante colisión) ---------------------------------
  for i in 1..5 loop
    begin
      insert into public.bookings (
        company_id, branch_id, service_id, customer_id, code, status,
        starts_at, ends_at, block_starts_at, block_ends_at,
        customer_name, customer_phone, customer_email, customer_notes,
        service_name, service_price, service_discount, products_total, discount_total, total, currency, source
      )
      values (
        v_company.id, v_branch.id, v_service.item_id, v_customer_id, public.generate_booking_code(), v_status,
        v_starts, v_ends, v_block_start, v_block_end,
        v_name, v_phone, v_email, v_notes,
        v_service.name, v_service.base_price, v_service.discount_amount, v_products_total,
        v_service.discount_amount + v_items_discount, v_total, v_company.currency, 'web'
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

  insert into public.booking_events (company_id, booking_id, action, payload)
  values (v_company.id, v_booking_id, 'created', jsonb_build_object('source', 'web', 'status', v_status));

  return jsonb_build_object(
    'id', v_booking_id, 'code', v_code, 'status', v_status, 'starts_at', v_starts, 'total', v_total,
    'phone', v_phone
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Detalle de una reserva por código, para el Worker: decide él si el contacto coincide o
-- si el token es válido. Incluye teléfono y correo para esa comprobación (el Worker no los
-- reenvía completos al navegador).
-- ---------------------------------------------------------------------------
create function public.get_booking_public(p_company uuid, p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', bk.code,
    'status', bk.status,
    'starts_at', bk.starts_at,
    'ends_at', bk.ends_at,
    'created_at', bk.created_at,
    'customer_name', bk.customer_name,
    'customer_phone', bk.customer_phone,
    'customer_email', bk.customer_email,
    'customer_notes', bk.customer_notes,
    'branch_id', bk.branch_id,
    'service_id', bk.service_id,
    'service_name', bk.service_name,
    'service_price', bk.service_price,
    'service_discount', bk.service_discount,
    'products_total', bk.products_total,
    'discount_total', bk.discount_total,
    'total', bk.total,
    'currency', bk.currency,
    'branch', jsonb_build_object(
      'slug', b.slug, 'name', b.name, 'address', b.address, 'city', b.city, 'maps_url', b.maps_url,
      'phone', b.phone, 'whatsapp', coalesce(b.whatsapp, c.whatsapp),
      'timezone', coalesce(b.timezone, c.timezone)
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.name, 'unit_price', i.unit_price, 'discount', i.discount, 'quantity', i.quantity,
        'line_total', i.line_total
      ) order by i.created_at, i.name)
      from public.booking_items i where i.booking_id = bk.id
    ), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', a.label, 'type', a.type, 'value', a.value, 'options', coalesce(f.options, '[]'::jsonb)
      ) order by a.created_at, a.label)
      from public.booking_answers a
      left join public.booking_fields f on f.id = a.field_id
      where a.booking_id = bk.id
    ), '[]'::jsonb),
    'cancel', jsonb_build_object(
      'allowed', coalesce((c.booking_settings ->> 'allow_customer_cancel')::boolean, false),
      'limit_hours', coalesce((c.booking_settings ->> 'cancel_limit_hours')::int, 24)
    )
  )
  from public.bookings bk
  join public.companies c on c.id = bk.company_id
  join public.branches b on b.id = bk.branch_id
  where bk.company_id = p_company
    and bk.code = upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
$$;

-- Nombre enmascarado: «Juan Pérez» → «Ju*** Pé***».
create function public.mask_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(left(w, 2) || '***', ' ' order by n), '')
  from regexp_split_to_table(btrim(coalesce(p_name, '')), '\s+') with ordinality as t (w, n)
  where w <> '';
$$;

-- ---------------------------------------------------------------------------
-- find_bookings(empresa, teléfono?, correo?): reservas del contacto en la empresa, con datos
-- mínimos (nombre enmascarado). Próximas primero; luego las de los últimos 12 meses.
-- ---------------------------------------------------------------------------
create function public.find_bookings(p_company uuid, p_phone text default null, p_email text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.row order by x.upcoming desc, x.sort_key), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'code', bk.code, 'status', bk.status, 'starts_at', bk.starts_at, 'service_name', bk.service_name,
        'branch_name', b.name, 'timezone', coalesce(b.timezone, c.timezone),
        'customer_name', public.mask_name(bk.customer_name), 'customer_phone', bk.customer_phone
      ) as row,
      bk.starts_at >= now() as upcoming,
      case when bk.starts_at >= now() then extract(epoch from bk.starts_at) else -extract(epoch from bk.starts_at) end
        as sort_key
    from public.bookings bk
    join public.branches b on b.id = bk.branch_id
    join public.companies c on c.id = bk.company_id
    where bk.company_id = p_company
      and (p_phone is not null or p_email is not null)
      and (p_phone is null or bk.customer_phone = p_phone)
      and (p_email is null or bk.customer_email operator(extensions.=) p_email::extensions.citext)
      and bk.starts_at >= now() - interval '12 months'
    order by 2 desc, 3
    limit 50
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- cancel_booking_public(empresa, código): si la empresa lo permite y falta más del límite.
-- ---------------------------------------------------------------------------
create function public.cancel_booking_public(p_company uuid, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_settings jsonb;
begin
  select bk.* into v_booking from public.bookings bk
  where bk.company_id = p_company and bk.code = upper(p_code)
  for update;
  if not found then raise exception 'La reserva no existe' using errcode = 'SV005'; end if;

  select booking_settings into v_settings from public.companies where id = p_company;
  if not coalesce((v_settings ->> 'allow_customer_cancel')::boolean, false) then
    raise exception 'Esta empresa no permite cancelar en línea' using errcode = 'SV005';
  end if;
  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'Esta reserva ya no se puede cancelar' using errcode = 'SV005';
  end if;
  if v_booking.starts_at - now() <= make_interval(hours => coalesce((v_settings ->> 'cancel_limit_hours')::int, 24)) then
    raise exception 'Ya pasó el plazo para cancelar en línea' using errcode = 'SV005';
  end if;

  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Cancelada por el cliente'
  where id = v_booking.id;

  -- Devolver el stock de los productos.
  update public.catalog_items ci set stock = ci.stock + i.quantity
  from public.booking_items i
  where i.booking_id = v_booking.id and i.product_id = ci.id and ci.stock is not null;

  insert into public.booking_events (company_id, booking_id, action, payload)
  values (p_company, v_booking.id, 'status_changed',
          jsonb_build_object('from', v_booking.status, 'to', 'cancelled', 'by', 'customer'));

  return jsonb_build_object('code', v_booking.code, 'status', 'cancelled');
end;
$$;

revoke execute on function
  public.service_fields(uuid, uuid),
  public.validate_booking_answers(uuid, uuid, jsonb),
  public.create_booking(jsonb),
  public.get_booking_public(uuid, text),
  public.find_bookings(uuid, text, text),
  public.cancel_booking_public(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.create_booking(jsonb),
  public.get_booking_public(uuid, text),
  public.find_bookings(uuid, text, text),
  public.cancel_booking_public(uuid, text)
to service_role;

grant execute on function public.get_booking_form(text, text, uuid) to anon, authenticated, service_role;
grant execute on function public.mask_name(text) to authenticated, service_role;
