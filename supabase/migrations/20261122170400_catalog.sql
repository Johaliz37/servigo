-- Catálogo: servicios y productos en una sola tabla (00 D4).

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind public.catalog_kind not null,
  name text not null check (length(btrim(name)) between 1 and 160),
  reference text, -- referencia/SKU
  short_description text,
  description text, -- Markdown; se sanitiza al renderizar
  price numeric(12, 2) not null check (price >= 0),
  duration_minutes int check (duration_minutes > 0 and duration_minutes <= 24 * 60),
  buffer_before_minutes int not null default 0 check (buffer_before_minutes between 0 and 24 * 60),
  buffer_after_minutes int not null default 0 check (buffer_after_minutes between 0 and 24 * 60),
  capacity int not null default 1 check (capacity between 1 and 1000),
  allow_in_booking boolean not null default false,
  stock int check (stock >= 0),
  is_active boolean not null default true,
  is_featured boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, reference), -- varias filas con reference null son válidas
  constraint catalog_items_service_duration check (kind <> 'service' or duration_minutes is not null),
  constraint catalog_items_product_fields check (
    kind <> 'product' or (duration_minutes is null and buffer_before_minutes = 0 and buffer_after_minutes = 0)
  ),
  constraint catalog_items_service_fields check (kind <> 'service' or (allow_in_booking = false and stock is null))
);

create index catalog_items_company_kind_idx on public.catalog_items (company_id, kind, sort_order);
create index catalog_items_name_trgm_idx on public.catalog_items using gin (name extensions.gin_trgm_ops);

create table public.catalog_item_details (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  item_id uuid not null references public.catalog_items (id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 160),
  value text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index catalog_item_details_company_idx on public.catalog_item_details (company_id);
create index catalog_item_details_item_idx on public.catalog_item_details (item_id, sort_order);

create table public.catalog_item_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  item_id uuid not null references public.catalog_items (id) on delete cascade,
  path text not null,
  thumb_path text,
  alt text,
  is_cover boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index catalog_item_photos_company_idx on public.catalog_item_photos (company_id);
create index catalog_item_photos_item_idx on public.catalog_item_photos (item_id, sort_order);
create unique index catalog_item_photos_one_cover_idx on public.catalog_item_photos (item_id) where is_cover;

create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  item_id uuid not null references public.catalog_items (id) on delete cascade,
  label text not null default '',
  type public.discount_type not null,
  value numeric(12, 2) not null check (value > 0),
  starts_at timestamptz,
  ends_at timestamptz not null, -- fecha límite de la promoción (00 D5)
  branch_id uuid references public.branches (id) on delete cascade, -- null = todas las sedes
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discounts_percent_range check (type <> 'percent' or value <= 100),
  constraint discounts_dates check (starts_at is null or starts_at < ends_at)
);

create index discounts_company_idx on public.discounts (company_id);
create index discounts_item_idx on public.discounts (item_id, ends_at) where is_active;
create index discounts_branch_idx on public.discounts (branch_id) where branch_id is not null;

-- Productos ofrecidos dentro de un servicio (add-ons de la reserva).
create table public.service_products (
  company_id uuid not null references public.companies (id) on delete cascade,
  service_id uuid not null references public.catalog_items (id) on delete cascade,
  product_id uuid not null references public.catalog_items (id) on delete cascade,
  max_quantity int not null default 10 check (max_quantity between 1 and 999),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (service_id, product_id),
  check (service_id <> product_id)
);

create index service_products_company_idx on public.service_products (company_id);
create index service_products_product_idx on public.service_products (product_id);

-- Catálogo propio por sede (solo se usa si branches.own_catalog = true).
create table public.branch_catalog_items (
  company_id uuid not null references public.companies (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  item_id uuid not null references public.catalog_items (id) on delete cascade,
  is_active boolean not null default true,
  price_override numeric(12, 2) check (price_override >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (branch_id, item_id)
);

create index branch_catalog_items_company_idx on public.branch_catalog_items (company_id);
create index branch_catalog_items_item_idx on public.branch_catalog_items (item_id);
