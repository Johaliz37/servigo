-- Fase 12: métricas del dashboard calculadas en Postgres (D30).
-- Son security definer, pero solo agregan las sedes que el usuario puede ver
-- (`dashboard_branches`, una vez por consulta, con can_access_branch): staff solo suma sus
-- sedes aunque pida otra o toda la empresa. Con RLS (security definer) la política se evaluaba
-- en cada fila: ~100 ms por consulta y 3 s los KPIs con 10k reservas.
-- Periodo = reservas cuyo inicio está en [p_from, p_to). Máximo 366 días.
-- Ingresos: null si el usuario no puede verlos (staff con booking_settings.staff_can_see_revenue = false).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- ¿Ve ingresos? owner/admin siempre; staff salvo que la empresa lo desactive.
create function public.can_see_revenue(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_company_role(p_company, '{owner,admin}')
    or (public.has_company_role(p_company, '{staff}')
        and coalesce((select (booking_settings ->> 'staff_can_see_revenue')::boolean
                      from public.companies where id = p_company), true));
$$;

-- Zona de los buckets: la de la sede elegida, si no la de la empresa.
create function public.dashboard_tz(p_company uuid, p_branch uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select b.timezone from public.branches b where b.id = p_branch and b.company_id = p_company),
    (select c.timezone from public.companies c where c.id = p_company),
    'UTC');
$$;

create function public.dashboard_check_range(p_from timestamptz, p_to timestamptz)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days' then
    raise exception 'Rango no válido (máximo 366 días)' using errcode = '22023';
  end if;
end;
$$;

-- Sedes que el usuario puede ver (todas o la pedida, si tiene acceso). Vacío si no es miembro.
create function public.dashboard_branches(p_company uuid, p_branch uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(b.id), '{}')
  from public.branches b
  where b.company_id = p_company
    and (p_branch is null or b.id = p_branch)
    and public.can_access_branch(p_company, b.id);
$$;

-- Reservas del periodo en las sedes visibles.
create function public.dashboard_bookings(p_company uuid, p_branch uuid, p_from timestamptz, p_to timestamptz)
returns setof public.bookings
language sql
stable
security definer
set search_path = ''
as $$
  select b.*
  from public.bookings b
  where b.company_id = p_company
    and b.branch_id in (select unnest(public.dashboard_branches(p_company, p_branch)))
    and b.starts_at >= p_from
    and b.starts_at < p_to;
$$;

-- ---------------------------------------------------------------------------
-- KPIs de un periodo
--   bookings_total: todas (incluidas canceladas); by_status: por estado.
--   revenue_expected: total de confirmed + completed; revenue_completed: completed.
--   avg_ticket: revenue_expected / nº de confirmed + completed.
--   new_customers: clientes con reserva en el periodo cuya primera reserva (de la empresa,
--   visible) cae en el periodo; returning_customers: el resto de clientes del periodo.
--   cancellation_rate y no_show_rate: sobre bookings_total (0–1).
-- ---------------------------------------------------------------------------
create function public.dashboard_period(p_company uuid, p_branch uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select * from public.dashboard_bookings(p_company, p_branch, p_from, p_to)),
  agg as (
    select
      count(*)::int as total,
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (where status = 'confirmed')::int as confirmed,
      count(*) filter (where status = 'completed')::int as completed,
      count(*) filter (where status = 'cancelled')::int as cancelled,
      count(*) filter (where status = 'no_show')::int as no_show,
      coalesce(sum(total) filter (where status in ('confirmed', 'completed')), 0) as revenue_expected,
      coalesce(sum(total) filter (where status = 'completed'), 0) as revenue_completed
    from b
  ),
  firsts as (
    select c.customer_id,
           (select min(x.starts_at) from public.bookings x
            where x.company_id = p_company and x.customer_id = c.customer_id and x.status <> 'cancelled'
              and x.branch_id in (select unnest(public.dashboard_branches(p_company, null)))) as first_at
    from (select distinct customer_id from b where status <> 'cancelled') c
  ),
  cust as (
    select count(*) filter (where first_at >= p_from)::int as new_customers,
           count(*) filter (where first_at < p_from)::int as returning_customers
    from firsts
  )
  select jsonb_build_object(
    'bookings_total', a.total,
    'by_status', jsonb_build_object('pending', a.pending, 'confirmed', a.confirmed, 'completed', a.completed,
                                    'cancelled', a.cancelled, 'no_show', a.no_show),
    'revenue_expected', case when public.can_see_revenue(p_company) then a.revenue_expected end,
    'revenue_completed', case when public.can_see_revenue(p_company) then a.revenue_completed end,
    'avg_ticket', case when public.can_see_revenue(p_company) then
                    case when a.confirmed + a.completed > 0
                         then round(a.revenue_expected / (a.confirmed + a.completed), 2) else 0 end end,
    'new_customers', c.new_customers,
    'returning_customers', c.returning_customers,
    'cancellation_rate', case when a.total > 0 then round(a.cancelled::numeric / a.total, 4) else 0 end,
    'no_show_rate', case when a.total > 0 then round(a.no_show::numeric / a.total, 4) else 0 end
  )
  from agg a cross join cust c;
$$;

-- KPIs del periodo y del periodo anterior de la misma duración (para la variación %).
create function public.dashboard_kpis(p_company uuid, p_branch uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.dashboard_check_range(p_from, p_to);
  return jsonb_build_object(
    'current', public.dashboard_period(p_company, p_branch, p_from, p_to),
    'previous', public.dashboard_period(p_company, p_branch, p_from - (p_to - p_from), p_from),
    'can_see_revenue', public.can_see_revenue(p_company)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Serie temporal: reservas no canceladas e ingresos esperados por día, semana (lunes) o mes,
-- en la zona de la sede o de la empresa. Incluye los buckets vacíos.
-- ---------------------------------------------------------------------------
create function public.dashboard_timeseries(
  p_company uuid,
  p_branch uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := public.dashboard_tz(p_company, p_branch);
  v_step interval;
  v_revenue boolean := public.can_see_revenue(p_company);
begin
  perform public.dashboard_check_range(p_from, p_to);
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'Agrupación no válida' using errcode = '22023';
  end if;
  v_step := ('1 ' || p_bucket)::interval;

  return coalesce((
    with buckets as (
      select generate_series(
        date_trunc(p_bucket, p_from at time zone v_tz),
        date_trunc(p_bucket, (p_to - interval '1 microsecond') at time zone v_tz),
        v_step) as bucket
    ),
    b as (
      select date_trunc(p_bucket, starts_at at time zone v_tz) as bucket, status, total
      from public.dashboard_bookings(p_company, p_branch, p_from, p_to)
      where status <> 'cancelled'
    )
    select jsonb_agg(jsonb_build_object(
      'bucket', to_char(k.bucket, 'YYYY-MM-DD'),
      'bookings', (select count(*) from b where b.bucket = k.bucket),
      'revenue', case when v_revenue then
                   (select coalesce(sum(total), 0) from b where b.bucket = k.bucket and status in ('confirmed', 'completed'))
                 end
    ) order by k.bucket)
    from buckets k
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Top servicios y productos (reservas no canceladas). Ingresos de confirmed + completed:
-- del servicio, precio − descuento; del producto, total de la línea.
-- ---------------------------------------------------------------------------
create function public.dashboard_top_services(
  p_company uuid,
  p_branch uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 8
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_revenue boolean := public.can_see_revenue(p_company);
begin
  perform public.dashboard_check_range(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.service_id, 'name', x.name, 'count', x.n,
                                        'revenue', case when v_revenue then x.revenue end)
                     order by x.n desc, x.revenue desc, x.name)
    from (
      select b.service_id,
             coalesce(ci.name, max(b.service_name)) as name,
             count(*)::int as n,
             coalesce(sum(b.service_price - b.service_discount) filter (where b.status in ('confirmed', 'completed')), 0)
               as revenue
      from public.dashboard_bookings(p_company, p_branch, p_from, p_to) b
      left join public.catalog_items ci on ci.id = b.service_id
      where b.status <> 'cancelled'
      group by b.service_id, ci.name
      order by n desc, revenue desc
      limit greatest(1, least(coalesce(p_limit, 8), 50))
    ) x
  ), '[]'::jsonb);
end;
$$;

create function public.dashboard_top_products(
  p_company uuid,
  p_branch uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 8
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_revenue boolean := public.can_see_revenue(p_company);
begin
  perform public.dashboard_check_range(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.product_id, 'name', x.name, 'quantity', x.qty,
                                        'revenue', case when v_revenue then x.revenue end)
                     order by x.qty desc, x.revenue desc, x.name)
    from (
      select i.product_id,
             max(i.name) as name,
             sum(i.quantity)::int as qty,
             coalesce(sum(i.line_total) filter (where b.status in ('confirmed', 'completed')), 0) as revenue
      from public.dashboard_bookings(p_company, p_branch, p_from, p_to) b
      join public.booking_items i on i.booking_id = b.id
      where b.status <> 'cancelled'
      group by i.product_id, coalesce(i.product_id::text, i.name)
      order by qty desc, revenue desc
      limit greatest(1, least(coalesce(p_limit, 8), 50))
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Mapa de calor: reservas no canceladas por día de la semana (1 = lunes … 7 = domingo) y
-- hora local de inicio. Solo las celdas con reservas.
-- ---------------------------------------------------------------------------
create function public.dashboard_heatmap(p_company uuid, p_branch uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := public.dashboard_tz(p_company, p_branch);
begin
  perform public.dashboard_check_range(p_from, p_to);
  return coalesce((
    select jsonb_agg(jsonb_build_object('dow', x.dow, 'hour', x.hour, 'count', x.n) order by x.dow, x.hour)
    from (
      select extract(isodow from starts_at at time zone v_tz)::int as dow,
             extract(hour from starts_at at time zone v_tz)::int as hour,
             count(*)::int as n
      from public.dashboard_bookings(p_company, p_branch, p_from, p_to)
      where status <> 'cancelled'
      group by 1, 2
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Comparación entre sedes: solo owner/admin (staff recibe 42501).
-- ---------------------------------------------------------------------------
create function public.dashboard_by_branch(p_company uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.dashboard_check_range(p_from, p_to);
  if not public.has_company_role(p_company, '{owner,admin}') then
    raise exception 'Solo propietarios y administradores comparan sedes' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', br.id, 'name', br.name, 'bookings', coalesce(x.n, 0), 'cancelled', coalesce(x.cancelled, 0),
      'revenue', coalesce(x.revenue, 0)
    ) order by coalesce(x.n, 0) desc, br.sort_order, br.name)
    from public.branches br
    left join (
      select branch_id,
             count(*) filter (where status <> 'cancelled')::int as n,
             count(*) filter (where status = 'cancelled')::int as cancelled,
             sum(total) filter (where status in ('confirmed', 'completed')) as revenue
      from public.dashboard_bookings(p_company, null, p_from, p_to)
      group by branch_id
    ) x on x.branch_id = br.id
    where br.company_id = p_company and (br.is_active or x.n > 0)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke execute on function
  public.can_see_revenue(uuid),
  public.dashboard_tz(uuid, uuid),
  public.dashboard_check_range(timestamptz, timestamptz),
  public.dashboard_branches(uuid, uuid),
  public.dashboard_bookings(uuid, uuid, timestamptz, timestamptz),
  public.dashboard_period(uuid, uuid, timestamptz, timestamptz),
  public.dashboard_kpis(uuid, uuid, timestamptz, timestamptz),
  public.dashboard_timeseries(uuid, uuid, timestamptz, timestamptz, text),
  public.dashboard_top_services(uuid, uuid, timestamptz, timestamptz, int),
  public.dashboard_top_products(uuid, uuid, timestamptz, timestamptz, int),
  public.dashboard_heatmap(uuid, uuid, timestamptz, timestamptz),
  public.dashboard_by_branch(uuid, timestamptz, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.can_see_revenue(uuid),
  public.dashboard_kpis(uuid, uuid, timestamptz, timestamptz),
  public.dashboard_timeseries(uuid, uuid, timestamptz, timestamptz, text),
  public.dashboard_top_services(uuid, uuid, timestamptz, timestamptz, int),
  public.dashboard_top_products(uuid, uuid, timestamptz, timestamptz, int),
  public.dashboard_heatmap(uuid, uuid, timestamptz, timestamptz),
  public.dashboard_by_branch(uuid, timestamptz, timestamptz)
to authenticated, service_role;
