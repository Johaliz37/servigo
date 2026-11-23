-- Disponibilidad como eventos con RRULE, estilo Google Calendar (00 D6).

create table public.availability_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- null = nivel empresa (lo usan las sedes con own_availability = false).
  branch_id uuid references public.branches (id) on delete cascade,
  kind public.availability_kind not null, -- open = ventana de atención; closed = no disponibilidad
  title text not null default '',
  notes text,
  color text check (public.is_hex_color(color)),
  starts_at timestamptz not null, -- primera ocurrencia
  ends_at timestamptz not null,
  all_day boolean not null default false,
  timezone text not null default 'America/Bogota' check (public.is_valid_timezone(timezone)),
  rrule text check (rrule is null or rrule ~ '^(RRULE:)?FREQ='), -- RFC 5545
  exdates timestamptz[] not null default '{}',
  recurrence_parent_id uuid references public.availability_events (id) on delete cascade,
  recurrence_original_start timestamptz,
  service_ids uuid[], -- null = aplica a todos los servicios
  capacity_override int check (capacity_override between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_events_range check (starts_at < ends_at),
  -- Una excepción ("solo este evento") apunta a su serie y a la ocurrencia que reemplaza, y no es recurrente.
  constraint availability_events_exception check (
    (recurrence_parent_id is null and recurrence_original_start is null)
    or (recurrence_parent_id is not null and recurrence_original_start is not null and rrule is null)
  )
);

create index availability_events_company_idx on public.availability_events (company_id);
create index availability_events_branch_idx on public.availability_events (company_id, branch_id, starts_at);
create index availability_events_branch_fk_idx on public.availability_events (branch_id) where branch_id is not null;
create index availability_events_parent_idx on public.availability_events (recurrence_parent_id)
  where recurrence_parent_id is not null;
