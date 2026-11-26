-- Fase 13 §1: política de privacidad por empresa, autorización de datos en la reserva web y
-- eliminación de los datos de un cliente a petición (Ley 1581 de 2012, Colombia). Ver 00 D31.

-- ---------------------------------------------------------------------------
-- Política de privacidad: Markdown propio de la empresa; `null` = plantilla del sistema
-- (src/shared/privacy.ts), que se arma con los datos de contacto de la empresa.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column privacy_policy text check (privacy_policy is null or length(privacy_policy) <= 20000),
  add column privacy_updated_at timestamptz;

create function public.get_public_privacy(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('policy', c.privacy_policy, 'updated_at', c.privacy_updated_at)
  from public.public_company(p_slug) c
  where c.id is not null;
$$;

revoke execute on function public.get_public_privacy(text) from public;
grant execute on function public.get_public_privacy(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Autorización de tratamiento de datos: obligatoria en la reserva web; queda el instante.
-- Las reservas manuales del panel no la piden (la empresa la recoge por su cuenta).
-- ---------------------------------------------------------------------------
alter table public.bookings add column privacy_consent_at timestamptz;

create or replace function public.create_booking(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if jsonb_typeof(p_payload -> 'privacy_consent') is distinct from 'boolean'
     or not (p_payload ->> 'privacy_consent')::boolean then
    raise exception 'Debes autorizar el tratamiento de tus datos personales' using errcode = 'SV003';
  end if;
  v_result := public.create_booking_core(p_payload, 'web', null, false);
  update public.bookings set privacy_consent_at = now() where id = (v_result ->> 'id')::uuid;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clientes anonimizados: conservan sus reservas (cifras del dashboard) sin datos personales.
-- El teléfono pasa a un marcador único `anon-…` (la tabla exige teléfono y lo hace único).
-- ---------------------------------------------------------------------------
alter table public.customers add column anonymized_at timestamptz;
alter table public.customers drop constraint customers_phone_check;
alter table public.customers add constraint customers_phone_check check (
  phone ~ '^\+[1-9][0-9]{6,14}$' or (anonymized_at is not null and phone ~ '^anon-[0-9a-f]{32}$')
);

-- anonymize_customer(customer): solo owner (como borrar clientes, 00 §7). Borra nombre,
-- teléfono, correo y notas del cliente y de sus reservas, sus respuestas adicionales y los
-- motivos de cancelación; deja un evento `anonymized` en cada reserva. Devuelve cuántas
-- reservas tocó. Repetirla no hace nada (0).
alter table public.booking_events drop constraint booking_events_action_check;
alter table public.booking_events add constraint booking_events_action_check
  check (action in ('created', 'status_changed', 'rescheduled', 'edited', 'anonymized'));

create function public.anonymize_customer(p_customer uuid)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_marker text;
  v_count int;
begin
  select * into v_customer from public.customers where id = p_customer for update;
  if not found or not public.has_company_role(v_customer.company_id, '{owner}') then
    raise exception 'No tienes permiso para eliminar los datos de este cliente' using errcode = '42501';
  end if;
  if v_customer.anonymized_at is not null then
    return 0;
  end if;

  v_marker := 'anon-' || replace(v_customer.id::text, '-', '');

  update public.customers
     set name = 'Cliente eliminado', phone = v_marker, email = null, notes = null, anonymized_at = now()
   where id = v_customer.id;

  update public.bookings
     set customer_name = 'Cliente eliminado', customer_phone = v_marker, customer_email = null,
         customer_notes = null, internal_notes = null, cancel_reason = null
   where customer_id = v_customer.id;
  get diagnostics v_count = row_count;

  delete from public.booking_answers a
   using public.bookings b
   where b.id = a.booking_id and b.customer_id = v_customer.id;

  update public.booking_events e
     set payload = e.payload - 'reason'
    from public.bookings b
   where b.id = e.booking_id and b.customer_id = v_customer.id and e.payload ? 'reason';

  insert into public.booking_events (company_id, booking_id, actor, action, payload)
  select b.company_id, b.id, (select auth.uid()), 'anonymized', '{}'::jsonb
    from public.bookings b
   where b.customer_id = v_customer.id;

  return v_count;
end;
$$;

revoke execute on function public.anonymize_customer(uuid) from public, anon;
grant execute on function public.anonymize_customer(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dashboard (D30): quien no es miembro de la empresa recibía ceros; ahora 42501, como el
-- resto del panel (lo detectó la prueba de aislamiento de la fase 13).
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_branches(p_company uuid, p_branch uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_company_role(p_company) then
    raise exception 'No tienes acceso a esta empresa' using errcode = '42501';
  end if;
  return (
    select coalesce(array_agg(b.id), '{}')
      from public.branches b
     where b.company_id = p_company
       and (p_branch is null or b.id = p_branch)
       and public.can_access_branch(p_company, b.id)
  );
end;
$$;
