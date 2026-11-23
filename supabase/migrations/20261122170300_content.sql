-- Contenido del sitio: Acerca de, patrocinadores y redes sociales.
-- (El footer vive en companies.footer.)

create table public.about_sections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete cascade, -- null = general de la empresa
  title text not null default '',
  body text not null default '', -- Markdown; se sanitiza al renderizar
  image_path text,
  is_visible boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index about_sections_company_idx on public.about_sections (company_id);
-- Una sección general por empresa y una por sede.
create unique index about_sections_company_general_idx on public.about_sections (company_id) where branch_id is null;
create unique index about_sections_branch_idx on public.about_sections (branch_id) where branch_id is not null;

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text,
  image_path text,
  url text check (url is null or url ~* '^https?://'),
  is_visible boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sponsors_company_idx on public.sponsors (company_id);
create index sponsors_branch_idx on public.sponsors (branch_id, sort_order);

create table public.social_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- null = de la empresa: aparece en todas las sedes salvo que la sede tenga los suyos.
  branch_id uuid references public.branches (id) on delete cascade,
  network public.social_network not null,
  label text,
  url text not null check (url ~* '^(https?://|mailto:|tel:)'),
  is_visible boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index social_links_company_idx on public.social_links (company_id);
create index social_links_branch_idx on public.social_links (branch_id) where branch_id is not null;
