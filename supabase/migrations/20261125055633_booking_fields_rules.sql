-- Fase 07: reglas de los campos de información adicional que un CHECK no puede expresar.
-- La forma de `options` y `validation` la usan el formulario público (fase 10) y su
-- validación en SQL: aquí se garantiza que siempre sea coherente.

-- ---------------------------------------------------------------------------
-- Forma de options y validation según el tipo.
--   options: [{value, label}] con value estable (a-z, 0-9, -) y único; solo en listas.
--   validation: {minLength, maxLength, pattern, patternMessage} en textos;
--               {min, max} en número (valor) y en multiselect (cantidad de opciones).
-- ---------------------------------------------------------------------------
create function public.booking_fields_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_list boolean := new.type in ('select', 'multiselect', 'radio');
  v_allowed text[];
  v_key text;
  v_value jsonb;
begin
  -- Opciones -----------------------------------------------------------------
  if not v_list and jsonb_array_length(new.options) > 0 then
    raise exception 'Solo las listas tienen opciones' using errcode = '23514';
  end if;
  if jsonb_array_length(new.options) > 50 then
    raise exception 'Máximo 50 opciones por campo' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.options) o
    where jsonb_typeof(o) <> 'object'
       or jsonb_typeof(o -> 'value') is distinct from 'string'
       or jsonb_typeof(o -> 'label') is distinct from 'string'
       or (o ->> 'value') !~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'
       or length(btrim(o ->> 'label')) not between 1 and 100
  ) then
    raise exception 'Cada opción debe tener un texto (1-100) y un valor válido' using errcode = '23514';
  end if;
  if (select count(distinct o ->> 'value') from jsonb_array_elements(new.options) o)
     <> jsonb_array_length(new.options) then
    raise exception 'Las opciones de un campo no pueden repetirse' using errcode = '23514';
  end if;

  -- Validaciones ---------------------------------------------------------------
  v_allowed := case
    when new.type in ('text', 'textarea') then array['minLength', 'maxLength', 'pattern', 'patternMessage']
    when new.type in ('number', 'multiselect') then array['min', 'max']
    else array[]::text[]
  end;
  for v_key, v_value in select * from jsonb_each(new.validation) loop
    if not v_key = any (v_allowed) then
      raise exception 'Validación «%» no aplica a este tipo de campo', v_key using errcode = '23514';
    end if;
    if v_key in ('pattern', 'patternMessage') then
      if jsonb_typeof(v_value) <> 'string' or length(v_value #>> '{}') > 200 then
        raise exception 'El patrón debe ser un texto de hasta 200 caracteres' using errcode = '23514';
      end if;
    elsif jsonb_typeof(v_value) <> 'number'
       or (v_key in ('minLength', 'maxLength') and ((v_value #>> '{}')::numeric < 0
           or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric))) then
      raise exception 'La validación «%» debe ser un número válido', v_key using errcode = '23514';
    end if;
  end loop;
  if (new.validation ->> 'minLength')::numeric > (new.validation ->> 'maxLength')::numeric
     or (new.validation ->> 'min')::numeric > (new.validation ->> 'max')::numeric then
    raise exception 'El mínimo no puede ser mayor que el máximo' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger booking_fields_validate
  before insert or update of type, options, validation on public.booking_fields
  for each row execute function public.booking_fields_validate();

-- ---------------------------------------------------------------------------
-- Un campo con respuestas no se borra: se inactiva (las respuestas guardan copia de
-- label y type, pero no de las opciones).
-- ---------------------------------------------------------------------------
create function public.booking_fields_block_delete_with_answers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.companies c where c.id = old.company_id)
     and exists (select 1 from public.booking_answers a where a.field_id = old.id) then
    raise exception 'El campo «%» ya tiene respuestas: inactívalo en lugar de borrarlo', old.label
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger booking_fields_block_delete_with_answers
  before delete on public.booking_fields
  for each row execute function public.booking_fields_block_delete_with_answers();

revoke execute on function
  public.booking_fields_validate(),
  public.booking_fields_block_delete_with_answers()
from authenticated;

-- ---------------------------------------------------------------------------
-- reorder_rows: ahora también ordena los campos.
-- ---------------------------------------------------------------------------
create or replace function public.reorder_rows(p_table text, p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_table not in ('branches', 'sponsors', 'social_links', 'catalog_items', 'booking_fields') then
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
