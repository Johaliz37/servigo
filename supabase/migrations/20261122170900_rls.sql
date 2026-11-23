-- Seguridad multitenant: helpers, privilegios y políticas RLS (fase 02 §3–4).
-- Regla: anon no toca tablas (solo RPC); authenticated ve y edita solo lo de sus empresas.

-- ---------------------------------------------------------------------------
-- Helpers (security definer: leen membresías sin depender de las políticas)
-- ---------------------------------------------------------------------------

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

create function public.has_company_role(
  p_company uuid,
  p_roles public.member_role[] default '{owner,admin,staff}'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create function public.can_access_branch(p_company uuid, p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and m.user_id = (select auth.uid())
      and (m.role in ('owner', 'admin') or m.branch_ids is null or p_branch = any (m.branch_ids))
  );
$$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------

-- anon: ninguna tabla, ninguna función salvo las RPC públicas que se otorguen explícitamente.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
-- PUBLIC tiene EXECUTE por defecto en toda función nueva; con `in schema` no se puede quitar
-- (los defaults por esquema solo suman a los globales), así que se revoca a nivel global.
alter default privileges for role postgres revoke execute on functions from public;

-- Funciones que evalúan las políticas, los CHECK y los DEFAULT para usuarios autenticados.
grant execute on function
  public.is_platform_admin(),
  public.has_company_role(uuid, public.member_role[]),
  public.can_access_branch(uuid, uuid),
  public.is_valid_timezone(text),
  public.is_hex_color(text),
  public.generate_booking_code()
to authenticated, service_role;

-- Las funciones de trigger no se invocan por RPC.
revoke execute on function
  public.set_updated_at(),
  public.lock_company_id(),
  public.enforce_company_consistency(),
  public.enforce_item_kind(),
  public.limit_item_photos(),
  public.companies_guard_platform_fields(),
  public.companies_check_reserved_slug()
from authenticated;

-- ---------------------------------------------------------------------------
-- RLS en todas las tablas de public
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Plataforma -----------------------------------------------------------------

create policy platform_admins_select on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_platform_admin());
-- Sin políticas de escritura: se gestiona por SQL / service_role.

create policy reserved_slugs_all on public.reserved_slugs
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Empresas -------------------------------------------------------------------

create policy companies_select on public.companies
  for select to authenticated
  using (public.has_company_role(id));

create policy companies_insert on public.companies
  for insert to authenticated
  with check (public.is_platform_admin());

create policy companies_update on public.companies
  for update to authenticated
  using (public.has_company_role(id, '{owner,admin}'))
  with check (public.has_company_role(id, '{owner,admin}'));

create policy companies_delete on public.companies
  for delete to authenticated
  using (public.is_platform_admin());

-- Miembros: owner gestiona a todos; admin solo a staff (02 §4).
create policy company_members_select on public.company_members
  for select to authenticated
  using (public.has_company_role(company_id));

create policy company_members_insert on public.company_members
  for insert to authenticated
  with check (
    public.has_company_role(company_id, '{owner}')
    or (role = 'staff' and public.has_company_role(company_id, '{admin}'))
  );

create policy company_members_update on public.company_members
  for update to authenticated
  using (
    public.has_company_role(company_id, '{owner}')
    or (role = 'staff' and public.has_company_role(company_id, '{admin}'))
  )
  with check (
    public.has_company_role(company_id, '{owner}')
    or (role = 'staff' and public.has_company_role(company_id, '{admin}'))
  );

create policy company_members_delete on public.company_members
  for delete to authenticated
  using (
    public.has_company_role(company_id, '{owner}')
    or (role = 'staff' and public.has_company_role(company_id, '{admin}'))
  );

-- Invitaciones: mismas reglas que miembros; solo owner/admin las ven (llevan el token).
create policy company_invitations_select on public.company_invitations
  for select to authenticated
  using (public.has_company_role(company_id, '{owner,admin}'));

create policy company_invitations_insert on public.company_invitations
  for insert to authenticated
  with check (
    public.has_company_role(company_id, '{owner}')
    or (role = 'staff' and public.has_company_role(company_id, '{admin}'))
  );

create policy company_invitations_update on public.company_invitations
  for update to authenticated
  using (
    public.has_company_role(company_id, '{owner}')
    or (role = 'staff' and public.has_company_role(company_id, '{admin}'))
  )
  with check (
    public.has_company_role(company_id, '{owner}')
    or (role = 'staff' and public.has_company_role(company_id, '{admin}'))
  );

create policy company_invitations_delete on public.company_invitations
  for delete to authenticated
  using (
    public.has_company_role(company_id, '{owner}')
    or (role = 'staff' and public.has_company_role(company_id, '{admin}'))
  );

-- Configuración (sedes, contenido, catálogo, campos) ------------------------
-- select: cualquier miembro; escritura: owner/admin.

do $$
declare
  t text;
begin
  foreach t in array array[
    'branches', 'about_sections', 'sponsors', 'social_links',
    'catalog_items', 'catalog_item_details', 'catalog_item_photos', 'discounts',
    'service_products', 'branch_catalog_items', 'booking_fields'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_company_role(company_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated '
      'with check (public.has_company_role(company_id, ''{owner,admin}''))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated '
      'using (public.has_company_role(company_id, ''{owner,admin}'')) '
      'with check (public.has_company_role(company_id, ''{owner,admin}''))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated '
      'using (public.has_company_role(company_id, ''{owner,admin}''))',
      t || '_delete', t);
  end loop;
end;
$$;

-- Disponibilidad -------------------------------------------------------------
-- Eventos de empresa (branch_id null): los ve cualquier miembro, los editan owner/admin.
-- Eventos de sede: los ve y edita quien tenga acceso a la sede (staff incluido).

create policy availability_events_select on public.availability_events
  for select to authenticated
  using (
    public.has_company_role(company_id)
    and (branch_id is null or public.can_access_branch(company_id, branch_id))
  );

create policy availability_events_insert on public.availability_events
  for insert to authenticated
  with check (
    (branch_id is null and public.has_company_role(company_id, '{owner,admin}'))
    or (branch_id is not null and public.can_access_branch(company_id, branch_id))
  );

create policy availability_events_update on public.availability_events
  for update to authenticated
  using (
    (branch_id is null and public.has_company_role(company_id, '{owner,admin}'))
    or (branch_id is not null and public.can_access_branch(company_id, branch_id))
  )
  with check (
    (branch_id is null and public.has_company_role(company_id, '{owner,admin}'))
    or (branch_id is not null and public.can_access_branch(company_id, branch_id))
  );

create policy availability_events_delete on public.availability_events
  for delete to authenticated
  using (
    (branch_id is null and public.has_company_role(company_id, '{owner,admin}'))
    or (branch_id is not null and public.can_access_branch(company_id, branch_id))
  );

-- Clientes (no tienen sede: los ve cualquier miembro) ------------------------

create policy customers_select on public.customers
  for select to authenticated using (public.has_company_role(company_id));
create policy customers_insert on public.customers
  for insert to authenticated with check (public.has_company_role(company_id));
create policy customers_update on public.customers
  for update to authenticated
  using (public.has_company_role(company_id))
  with check (public.has_company_role(company_id));
create policy customers_delete on public.customers
  for delete to authenticated using (public.has_company_role(company_id, '{owner}'));

-- Reservas -------------------------------------------------------------------
-- can_access_branch implica membresía (o superadmin). Borrar: solo owner.

create policy bookings_select on public.bookings
  for select to authenticated using (public.can_access_branch(company_id, branch_id));
create policy bookings_insert on public.bookings
  for insert to authenticated with check (public.can_access_branch(company_id, branch_id));
create policy bookings_update on public.bookings
  for update to authenticated
  using (public.can_access_branch(company_id, branch_id))
  with check (public.can_access_branch(company_id, branch_id));
create policy bookings_delete on public.bookings
  for delete to authenticated using (public.has_company_role(company_id, '{owner}'));

-- Detalle de reservas: hereda el acceso de la reserva.
do $$
declare
  t text;
  v_access text := 'exists (select 1 from public.bookings b where b.id = booking_id '
                   'and public.can_access_branch(b.company_id, b.branch_id))';
begin
  foreach t in array array['booking_items', 'booking_answers'] loop
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_select', t, v_access);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert', t, v_access);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
      t || '_update', t, v_access, v_access);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_delete', t, v_access);
  end loop;

  -- Historial: solo lectura e inserción.
  execute format('create policy booking_events_select on public.booking_events for select to authenticated using (%s)',
    v_access);
  execute format('create policy booking_events_insert on public.booking_events for insert to authenticated with check (%s)',
    v_access);
end;
$$;
