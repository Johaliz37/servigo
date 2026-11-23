-- Reservas, clientes y su detalle.

-- Código legible: 8 caracteres Crockford Base32 sin I L O U (00 §6). 256 % 32 = 0 → sin sesgo.
create function public.generate_booking_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
begin
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'), -- E.164
  email extensions.citext,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, phone)
);

create index customers_company_email_idx on public.customers (company_id, email) where email is not null;
create index customers_name_trgm_idx on public.customers using gin (name extensions.gin_trgm_ops);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete restrict,
  service_id uuid not null references public.catalog_items (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  code text not null default public.generate_booking_code() check (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  status public.booking_status not null default 'pending',
  starts_at timestamptz not null, -- sin buffers
  ends_at timestamptz not null,
  block_starts_at timestamptz not null, -- con buffers (ocupación)
  block_ends_at timestamptz not null,
  customer_name text not null,
  customer_phone text not null,
  customer_email extensions.citext,
  customer_notes text,
  internal_notes text,
  service_name text not null,
  service_price numeric(12, 2) not null check (service_price >= 0),
  service_discount numeric(12, 2) not null default 0 check (service_discount >= 0),
  products_total numeric(12, 2) not null default 0 check (products_total >= 0),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  total numeric(12, 2) not null check (total >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  source text not null default 'web' check (source in ('web', 'admin')),
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  constraint bookings_range check (starts_at < ends_at),
  constraint bookings_block_range check (block_starts_at <= starts_at and block_ends_at >= ends_at),
  constraint bookings_cancelled check ((status = 'cancelled') = (cancelled_at is not null))
);

create index bookings_branch_starts_idx on public.bookings (company_id, branch_id, starts_at);
create index bookings_customer_phone_idx on public.bookings (company_id, customer_phone);
create index bookings_customer_email_idx on public.bookings (company_id, customer_email) where customer_email is not null;
create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_service_idx on public.bookings (service_id);
create index bookings_created_by_idx on public.bookings (created_by) where created_by is not null;
-- Ocupación por sede/servicio (cálculo de cupos y revalidación al insertar).
create index bookings_block_gist_idx on public.bookings
  using gist (branch_id, service_id, tstzrange(block_starts_at, block_ends_at));

create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  product_id uuid references public.catalog_items (id) on delete set null,
  name text not null, -- snapshot
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  quantity int not null check (quantity between 1 and 999),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index booking_items_company_idx on public.booking_items (company_id);
create index booking_items_booking_idx on public.booking_items (booking_id);
create index booking_items_product_idx on public.booking_items (product_id) where product_id is not null;

create table public.booking_answers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  field_id uuid references public.booking_fields (id) on delete set null,
  label text not null, -- snapshot
  type public.field_type not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index booking_answers_company_idx on public.booking_answers (company_id);
create index booking_answers_booking_idx on public.booking_answers (booking_id);
create index booking_answers_field_idx on public.booking_answers (field_id) where field_id is not null;

-- Historial (solo inserción).
create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  actor uuid references auth.users (id) on delete set null,
  action text not null check (action in ('created', 'status_changed', 'rescheduled', 'edited')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index booking_events_company_idx on public.booking_events (company_id);
create index booking_events_booking_idx on public.booking_events (booking_id, created_at);
create index booking_events_actor_idx on public.booking_events (actor) where actor is not null;
