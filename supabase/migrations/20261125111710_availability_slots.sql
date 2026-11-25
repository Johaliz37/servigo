-- Fase 08: reglas de los eventos de disponibilidad y entrada del motor de cupos.

-- ---------------------------------------------------------------------------
-- availability_events_validate
--   · rrule: solo FREQ DAILY/WEEKLY/MONTHLY/YEARLY y pares CLAVE=valor (lo que entiende el motor).
--   · service_ids: solo servicios; una lista vacía equivale a «todos» (null).
--   · Excepción («solo este evento»): su serie es recurrente, de la misma sede y del mismo tipo.
--   · Duración: hasta 366 días (un evento no puede ocupar el calendario indefinidamente).
-- ---------------------------------------------------------------------------
create function public.availability_events_validate()
returns trigger
language plpgsql
security definer -- ve la serie y los servicios aunque RLS los oculte (la empresa la valida otro trigger)
set search_path = ''
as $$
declare
  v_parent public.availability_events;
begin
  if new.rrule is not null then
    new.rrule := regexp_replace(new.rrule, '^RRULE:', '');
    if new.rrule !~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,+-]+)*$' then
      raise exception 'Regla de repetición no válida' using errcode = '23514';
    end if;
  end if;

  if new.service_ids is not null and cardinality(new.service_ids) = 0 then
    new.service_ids := null;
  end if;
  if new.service_ids is not null and exists (
    select 1 from unnest(new.service_ids) s(id)
    left join public.catalog_items ci on ci.id = s.id
    where ci.kind is distinct from 'service'
  ) then
    raise exception 'Un horario solo puede limitarse a servicios' using errcode = '23514';
  end if;

  if new.ends_at - new.starts_at > interval '366 days' then
    raise exception 'Un evento no puede durar más de un año' using errcode = '23514';
  end if;

  if new.recurrence_parent_id is not null then
    select * into v_parent from public.availability_events where id = new.recurrence_parent_id;
    if v_parent.rrule is null
       or v_parent.branch_id is distinct from new.branch_id
       or v_parent.kind <> new.kind then
      raise exception 'La excepción debe pertenecer a una serie recurrente de la misma sede y tipo'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger availability_events_validate
  before insert or update on public.availability_events
  for each row execute function public.availability_events_validate();

-- ---------------------------------------------------------------------------
-- get_slot_inputs(sede, servicio, desde, hasta): todo lo que necesita el motor
-- (`src/shared/availability.ts`) y nada más: eventos que aplican a la sede (los suyos si
-- tiene horario propio, si no los de la empresa), bloques ocupados del servicio sin datos
-- personales, configuración y servicio. `null` si la sede o la empresa no están activas o el
-- servicio no se ofrece en la sede. Solo la llama el Worker (secret key).
-- ---------------------------------------------------------------------------
create function public.get_slot_inputs(p_branch uuid, p_service uuid, p_from timestamptz, p_to timestamptz)
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
        and bk.block_starts_at < p_to + interval '1 day'
        and bk.block_ends_at > p_from - interval '1 day'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_slot_inputs(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_slot_inputs(uuid, uuid, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- apply_availability_plan(plan): aplica en una transacción los cambios del calendario
-- {inserts: [fila], updates: [{id, patch}], deletes: [id]} en ese orden. Editar «este y los
-- siguientes» toca varias filas a la vez y el «Deshacer» aplica el plan inverso: o todo o nada.
-- security invoker: RLS decide qué puede tocar el usuario (staff: sus sedes; empresa: owner/admin).
-- Un update que RLS oculta falla con 42501; un delete de una fila que ya no existe no falla
-- (p. ej. la excepción que se llevó la cascada de su serie).
-- ---------------------------------------------------------------------------
create function public.apply_availability_plan(p_plan jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_count int;
begin
  if jsonb_typeof(p_plan) <> 'object' then
    raise exception 'Plan no válido' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_plan -> 'inserts', '[]')) loop
    insert into public.availability_events (
      id, company_id, branch_id, kind, title, notes, color, starts_at, ends_at, all_day, timezone, rrule,
      exdates, recurrence_parent_id, recurrence_original_start, service_ids, capacity_override
    )
    select
      coalesce(r.id, gen_random_uuid()), r.company_id, r.branch_id, r.kind, coalesce(r.title, ''), r.notes, r.color,
      r.starts_at, r.ends_at, coalesce(r.all_day, false), coalesce(r.timezone, 'America/Bogota'), r.rrule,
      coalesce(r.exdates, '{}'), r.recurrence_parent_id, r.recurrence_original_start, r.service_ids, r.capacity_override
    from jsonb_populate_record(null::public.availability_events, v_item) r;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_plan -> 'updates', '[]')) loop
    update public.availability_events t
    set (kind, title, notes, color, starts_at, ends_at, all_day, timezone, rrule, exdates,
         recurrence_parent_id, recurrence_original_start, service_ids, capacity_override)
      = (select p.kind, p.title, p.notes, p.color, p.starts_at, p.ends_at, p.all_day, p.timezone, p.rrule, p.exdates,
                p.recurrence_parent_id, p.recurrence_original_start, p.service_ids, p.capacity_override
         from jsonb_populate_record(t, v_item -> 'patch') p)
    where t.id = (v_item ->> 'id')::uuid;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'No tienes permiso para cambiar este horario o ya no existe' using errcode = '42501';
    end if;
  end loop;

  delete from public.availability_events
  where id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p_plan -> 'deletes', '[]')) x);
end;
$$;

revoke execute on function public.apply_availability_plan(jsonb) from public, anon;
grant execute on function public.apply_availability_plan(jsonb) to authenticated;
