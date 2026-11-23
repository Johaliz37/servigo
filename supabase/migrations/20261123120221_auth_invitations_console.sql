-- Fase 03: invitaciones, gestión de miembros y consola superadmin.
-- Errores de negocio con `raise exception` (SQLSTATE P0001) y mensaje en español:
-- el cliente los muestra tal cual (src/shared/errors.ts).

-- Quien invita queda registrado sin que el cliente lo envíe.
alter table public.company_invitations alter column invited_by set default auth.uid();

-- ---------------------------------------------------------------------------
-- Toda empresa conserva al menos un owner
-- ---------------------------------------------------------------------------

-- AFTER: ve el estado final de la sentencia. Si la empresa ya no existe es un borrado
-- en cascada (empresa eliminada) y se permite.
create function public.company_members_keep_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner'
    and (tg_op = 'DELETE' or new.role <> 'owner')
    and exists (select 1 from public.companies c where c.id = old.company_id)
    and not exists (
      select 1 from public.company_members m where m.company_id = old.company_id and m.role = 'owner'
    )
  then
    raise exception 'La empresa debe conservar al menos un owner';
  end if;
  return null;
end;
$$;

create trigger company_members_keep_owner
  after update of role or delete on public.company_members
  for each row execute function public.company_members_keep_owner();

revoke execute on function public.company_members_keep_owner() from authenticated;

-- ---------------------------------------------------------------------------
-- Slugs
-- ---------------------------------------------------------------------------

-- 'invalid' | 'reserved' | 'taken' | 'available'. Interna: la usan check_slug y create_company.
create function public.slug_status(p_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_slug is null or p_slug !~ '^(?!.*--)[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$' then 'invalid'
    when exists (select 1 from public.reserved_slugs r where r.slug operator(extensions.=) p_slug::extensions.citext)
      then 'reserved'
    when exists (select 1 from public.companies c where c.slug operator(extensions.=) p_slug::extensions.citext)
      then 'taken'
    else 'available'
  end;
$$;

-- Validación en vivo del formulario de alta (solo superadmin).
create function public.check_slug(p_slug text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo el superadmin puede consultar slugs' using errcode = '42501';
  end if;
  return public.slug_status(p_slug);
end;
$$;

-- ---------------------------------------------------------------------------
-- Alta de empresa (superadmin): empresa + sede principal + invitación al owner
-- ---------------------------------------------------------------------------

create function public.create_company(
  p_name text,
  p_slug text,
  p_owner_email text,
  p_timezone text default 'America/Bogota',
  p_currency text default 'COP'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text := public.slug_status(p_slug);
  v_company uuid;
  v_branch uuid;
  v_invitation public.company_invitations;
begin
  if not public.is_platform_admin() then
    raise exception 'Solo el superadmin puede crear empresas' using errcode = '42501';
  end if;
  if v_status = 'invalid' then
    raise exception 'El slug "%" no es válido: 3 a 32 caracteres, minúsculas, números y guiones', p_slug;
  elsif v_status = 'reserved' then
    raise exception 'El slug "%" está reservado', p_slug;
  elsif v_status = 'taken' then
    raise exception 'El slug "%" ya está en uso', p_slug;
  end if;
  if p_owner_email is null or p_owner_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo del owner no es válido';
  end if;

  insert into public.companies (name, slug, timezone, currency, contact_email)
  values (btrim(p_name), p_slug, p_timezone, upper(p_currency), lower(p_owner_email))
  returning id into v_company;

  insert into public.branches (company_id, slug, name)
  values (v_company, 'principal', 'Sede principal')
  returning id into v_branch;

  insert into public.company_invitations (company_id, email, role, invited_by)
  values (v_company, lower(p_owner_email), 'owner', (select auth.uid()))
  returning * into v_invitation;

  return jsonb_build_object(
    'company_id', v_company,
    'slug', p_slug,
    'branch_id', v_branch,
    'invitation_id', v_invitation.id,
    'invitation_token', v_invitation.token,
    'owner_email', v_invitation.email
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Consola: listado de empresas con métricas
-- ---------------------------------------------------------------------------

create function public.console_companies()
returns table (
  id uuid,
  name text,
  slug text,
  status public.company_status,
  branches_count int,
  bookings_this_month int,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo el superadmin puede ver la consola' using errcode = '42501';
  end if;
  return query
    select
      c.id,
      c.name,
      c.slug::text,
      c.status,
      (select count(*)::int from public.branches b where b.company_id = c.id),
      -- "Del mes" en la zona horaria de la empresa.
      (select count(*)::int from public.bookings k
        where k.company_id = c.id
          and k.starts_at >= (date_trunc('month', now() at time zone c.timezone) at time zone c.timezone)
          and k.starts_at < ((date_trunc('month', now() at time zone c.timezone) + interval '1 month') at time zone c.timezone)),
      c.created_at
    from public.companies c
    order by c.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Miembros: listado con email (auth.users no es accesible desde el cliente)
-- ---------------------------------------------------------------------------

create function public.list_company_members(p_company uuid)
returns table (
  id uuid,
  user_id uuid,
  email text,
  role public.member_role,
  branch_ids uuid[],
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_company_role(p_company, '{owner,admin}') then
    raise exception 'No tienes permiso para ver los miembros' using errcode = '42501';
  end if;
  return query
    select m.id, m.user_id, u.email::text, m.role, m.branch_ids, m.created_at, u.last_sign_in_at
    from public.company_members m
    join auth.users u on u.id = m.user_id
    where m.company_id = p_company
    order by array_position(array['owner', 'admin', 'staff']::public.member_role[], m.role), u.email;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitaciones
-- ---------------------------------------------------------------------------

-- Datos para la pantalla de aceptar invitación (antes o después de iniciar sesión).
-- Conocer el token (uuid aleatorio) equivale a poder ver la invitación.
create function public.get_invitation(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'company_name', c.name,
    'company_slug', c.slug,
    'email', i.email,
    'role', i.role,
    'expired', i.expires_at < now(),
    'accepted', i.accepted_at is not null
  )
  from public.company_invitations i
  join public.companies c on c.id = i.company_id
  where i.token = p_token;
$$;

-- Crea la membresía del usuario autenticado. Si ya era miembro no cambia su rol
-- (un owner invitado como staff no se degrada); el rol se ajusta desde Miembros.
create function public.accept_invitation(p_token uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_invitation public.company_invitations;
  v_slug text;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para aceptar la invitación' using errcode = '42501';
  end if;

  select * into v_invitation from public.company_invitations where token = p_token for update;
  if not found then
    raise exception 'La invitación no existe o fue revocada';
  end if;
  if v_invitation.accepted_at is not null then
    raise exception 'Esta invitación ya fue aceptada';
  end if;
  if v_invitation.expires_at < now() then
    raise exception 'La invitación venció; pide que te la reenvíen';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_email is null or lower(v_email) <> lower(v_invitation.email::text) then
    raise exception 'Esta invitación es para %; entra con ese correo', v_invitation.email;
  end if;

  insert into public.company_members (company_id, user_id, role, branch_ids)
  values (v_invitation.company_id, v_uid, v_invitation.role, v_invitation.branch_ids)
  on conflict (company_id, user_id) do nothing;

  update public.company_invitations set accepted_at = now() where id = v_invitation.id;

  select c.slug::text into v_slug from public.companies c where c.id = v_invitation.company_id;
  return jsonb_build_object('company_id', v_invitation.company_id, 'slug', v_slug, 'role', v_invitation.role);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------

revoke execute on function public.slug_status(text) from authenticated;
grant execute on function
  public.check_slug(text),
  public.create_company(text, text, text, text, text),
  public.console_companies(),
  public.list_company_members(uuid),
  public.accept_invitation(uuid)
to authenticated, service_role;
grant execute on function public.get_invitation(uuid) to anon, authenticated, service_role;
