-- Núcleo: plataforma, slugs reservados, empresas, miembros, invitaciones y sedes.

-- ---------------------------------------------------------------------------
-- Validadores reutilizables (inmutables/estables, sin dependencias de tablas)
-- ---------------------------------------------------------------------------

create function public.is_valid_timezone(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_tz is null or exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;

create function public.is_hex_color(p_color text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_color is null or p_color ~ '^#[0-9A-Fa-f]{6}$';
$$;

-- ---------------------------------------------------------------------------
-- Plataforma
-- ---------------------------------------------------------------------------

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is 'Operadores de Servigo (superadmin). Solo se escribe por SQL/service_role.';

create table public.reserved_slugs (
  slug extensions.citext primary key,
  reason text not null default 'system' check (reason in ('system', 'roquintech_product')),
  created_at timestamptz not null default now()
);

comment on table public.reserved_slugs is
  'Subdominios que no pueden ser empresa (00 §4). Lanzar un producto de Roquintech = insertar su nombre aquí.';

insert into public.reserved_slugs (slug, reason) values
  ('www', 'system'), ('app', 'system'), ('admin', 'system'), ('api', 'system'), ('console', 'system'),
  ('mail', 'system'), ('smtp', 'system'), ('ftp', 'system'), ('static', 'system'), ('assets', 'system'),
  ('cdn', 'system'), ('media', 'system'), ('status', 'system'), ('docs', 'system'), ('blog', 'system'),
  ('help', 'system'), ('soporte', 'system'), ('dev', 'system'), ('staging', 'system'), ('test', 'system'),
  ('auth', 'system'), ('login', 'system'), ('email', 'system'), ('webmail', 'system'), ('imap', 'system'),
  ('pop', 'system'), ('ns1', 'system'), ('ns2', 'system'), ('autodiscover', 'system'), ('autoconfig', 'system'),
  ('roquintech', 'roquintech_product'), ('servigo', 'roquintech_product');

-- ---------------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique
    constraint companies_slug_format check (slug::text ~ '^(?!.*--)[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  legal_name text,
  tax_id text,
  logo_path text,
  favicon_path text,
  hero_image_path text,
  primary_color text check (public.is_hex_color(primary_color)),
  secondary_color text check (public.is_hex_color(secondary_color)),
  contact_email extensions.citext,
  contact_phone text,
  whatsapp text,
  timezone text not null default 'America/Bogota' check (public.is_valid_timezone(timezone)),
  currency char(3) not null default 'COP' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'es-CO',
  footer jsonb not null default '{"text": "", "show_socials": true, "links": [], "address": "", "show_powered_by": true}'
    check (jsonb_typeof(footer) = 'object'),
  booking_settings jsonb not null default '{
    "auto_confirm": false,
    "min_lead_minutes": 60,
    "max_days_ahead": 60,
    "slot_step_minutes": 30,
    "allow_customer_cancel": false,
    "cancel_limit_hours": 24,
    "require_email": false,
    "terms_text": ""
  }' check (jsonb_typeof(booking_settings) = 'object'),
  seo jsonb not null default '{}' check (jsonb_typeof(seo) = 'object'),
  status public.company_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rechaza slugs reservados (la lista vive en la tabla, no en el código).
create function public.companies_check_reserved_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- operator(extensions.=): comparación citext (sin mayúsculas) aun con search_path = ''.
  if exists (select 1 from public.reserved_slugs r where r.slug operator(extensions.=) new.slug) then
    raise exception 'El slug "%" está reservado', new.slug using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger companies_reserved_slug
  before insert or update of slug on public.companies
  for each row execute function public.companies_check_reserved_slug();

-- ---------------------------------------------------------------------------
-- Miembros e invitaciones
-- ---------------------------------------------------------------------------

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  branch_ids uuid[], -- null = todas las sedes (solo relevante para staff)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create index company_members_user_idx on public.company_members (user_id);

create table public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email extensions.citext not null,
  role public.member_role not null default 'admin',
  branch_ids uuid[],
  token uuid not null default gen_random_uuid() unique,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index company_invitations_company_idx on public.company_invitations (company_id);
create index company_invitations_invited_by_idx on public.company_invitations (invited_by) where invited_by is not null;
create unique index company_invitations_pending_email_idx
  on public.company_invitations (company_id, email) where accepted_at is null;

-- ---------------------------------------------------------------------------
-- Sedes
-- ---------------------------------------------------------------------------

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  slug extensions.citext not null
    constraint branches_slug_format check (slug::text ~ '^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  address text,
  city text,
  phone text,
  whatsapp text,
  email extensions.citext,
  maps_url text,
  lat numeric(9, 6) check (lat between -90 and 90),
  lng numeric(9, 6) check (lng between -180 and 180),
  timezone text check (public.is_valid_timezone(timezone)), -- null = el de la empresa
  cover_image_path text,
  header jsonb not null default '{}' check (jsonb_typeof(header) = 'object'),
  own_availability boolean not null default false,
  own_catalog boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, slug)
);
