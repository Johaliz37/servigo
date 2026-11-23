-- Información adicional que el cliente responde al reservar.

create table public.booking_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  service_id uuid references public.catalog_items (id) on delete cascade, -- null = general (todas las reservas)
  label text not null check (length(btrim(label)) between 1 and 200),
  help_text text,
  placeholder text,
  type public.field_type not null,
  options jsonb not null default '[]' check (jsonb_typeof(options) = 'array'), -- [{value, label}]
  required boolean not null default false,
  validation jsonb not null default '{}' check (jsonb_typeof(validation) = 'object'), -- {min,max,minLength,maxLength,pattern}
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Los tipos de lista necesitan al menos una opción.
  constraint booking_fields_options_required check (
    type not in ('select', 'multiselect', 'radio') or jsonb_array_length(options) > 0
  )
);

create index booking_fields_company_idx on public.booking_fields (company_id, sort_order);
create index booking_fields_service_idx on public.booking_fields (service_id) where service_id is not null;
