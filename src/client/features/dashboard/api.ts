/**
 * Datos del dashboard (fase 12, D30): agregados por RPC (`dashboard_*`, calculados en Postgres
 * sobre las sedes visibles) y ocupación con el motor de cupos en el navegador.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toAvailabilityEvent, type AvailabilityEventRow } from '@shared/availability';
import {
  combineOccupancy,
  occupancy,
  type Bucket,
  type BranchStat,
  type HeatCell,
  type KpisResponse,
  type OccupancyRow,
  type SeriesPoint,
  type TopProduct,
  type TopService,
} from '@shared/dashboard';
import { useCompany } from '@client/app/tenant-context';
import { supabase } from '@client/lib/supabase';

export interface DashboardScope {
  branchId: string | null;
  /** Instantes ISO [from, to). */
  from: string;
  to: string;
}

const opts = { placeholderData: keepPreviousData, staleTime: 30_000 } as const;

function useRpc<T>(
  name: string,
  scope: DashboardScope,
  fn: () => PromiseLike<{ data: unknown; error: unknown }>,
  enabled = true,
) {
  const company = useCompany();
  return useQuery({
    queryKey: ['dashboard', company.id, name, scope],
    enabled,
    ...opts,
    queryFn: async (): Promise<T> => {
      const { data, error } = await fn();
      if (error) throw error;
      return data as T;
    },
  });
}

export function useKpis(scope: DashboardScope) {
  const company = useCompany();
  return useRpc<KpisResponse>('kpis', scope, () =>
    supabase.rpc('dashboard_kpis', {
      p_company: company.id,
      p_branch: scope.branchId!,
      p_from: scope.from,
      p_to: scope.to,
    }),
  );
}

export function useTimeseries(scope: DashboardScope, bucket: Bucket) {
  const company = useCompany();
  return useRpc<SeriesPoint[]>(`series:${bucket}`, scope, () =>
    supabase.rpc('dashboard_timeseries', {
      p_company: company.id,
      p_branch: scope.branchId!,
      p_from: scope.from,
      p_to: scope.to,
      p_bucket: bucket,
    }),
  );
}

export function useTopServices(scope: DashboardScope) {
  const company = useCompany();
  return useRpc<TopService[]>('top-services', scope, () =>
    supabase.rpc('dashboard_top_services', {
      p_company: company.id,
      p_branch: scope.branchId!,
      p_from: scope.from,
      p_to: scope.to,
    }),
  );
}

export function useTopProducts(scope: DashboardScope) {
  const company = useCompany();
  return useRpc<TopProduct[]>('top-products', scope, () =>
    supabase.rpc('dashboard_top_products', {
      p_company: company.id,
      p_branch: scope.branchId!,
      p_from: scope.from,
      p_to: scope.to,
    }),
  );
}

export function useHeatmap(scope: DashboardScope) {
  const company = useCompany();
  return useRpc<HeatCell[]>('heatmap', scope, () =>
    supabase.rpc('dashboard_heatmap', {
      p_company: company.id,
      p_branch: scope.branchId!,
      p_from: scope.from,
      p_to: scope.to,
    }),
  );
}

export function useByBranch(scope: DashboardScope, enabled: boolean) {
  const company = useCompany();
  return useRpc<BranchStat[]>(
    'by-branch',
    scope,
    () => supabase.rpc('dashboard_by_branch', { p_company: company.id, p_from: scope.from, p_to: scope.to }),
    enabled,
  );
}

/** ¿La empresa tiene alguna reserva? (estado vacío con el enlace para compartir). */
export function useHasBookings() {
  const company = useCompany();
  return useQuery({
    queryKey: ['dashboard', company.id, 'has-bookings'],
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', company.id);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Ocupación
// ---------------------------------------------------------------------------

export interface OccupancyResult {
  current: OccupancyRow;
  previous: OccupancyRow;
  byService: { id: string; name: string; rate: number | null; offered: number; booked: number }[];
}

/**
 * Ocupación del periodo y del anterior en las sedes visibles (o la elegida). Lee horarios,
 * servicios ofrecidos en cada sede y bloques de reservas (solo horas, sin datos personales).
 */
export function useOccupancy(
  scope: DashboardScope,
  previous: { from: string; to: string },
  branches: { id: string; timezone: string }[],
) {
  const company = useCompany();
  const list = scope.branchId ? branches.filter((b) => b.id === scope.branchId) : branches;
  return useQuery({
    queryKey: ['dashboard', company.id, 'occupancy', scope, previous, list.map((b) => b.id).join(',')],
    enabled: list.length > 0,
    ...opts,
    queryFn: async (): Promise<OccupancyResult> => {
      const ids = list.map((b) => b.id);
      const [events, branchRows, bookings, catalogs] = await Promise.all([
        supabase.from('availability_events').select('*').eq('company_id', company.id),
        supabase.from('branches').select('id, own_availability').in('id', ids),
        supabase
          .from('bookings')
          .select('branch_id, service_id, block_starts_at, block_ends_at, status')
          .eq('company_id', company.id)
          .in('branch_id', ids)
          .neq('status', 'cancelled')
          .lt('block_starts_at', scope.to)
          .gt('block_ends_at', previous.from)
          .limit(20_000),
        Promise.all(ids.map((id) => supabase.rpc('effective_catalog', { p_branch: id }))),
      ]);
      for (const r of [events, branchRows, bookings, ...catalogs]) if (r.error) throw r.error;

      const own = new Map((branchRows.data ?? []).map((b) => [b.id, b.own_availability]));
      const all = (events.data ?? []) as unknown as (AvailabilityEventRow & { branch_id: string | null })[];
      const cur: OccupancyRow[] = [];
      const prev: OccupancyRow[] = [];
      const perService = new Map<string, { id: string; name: string; offered: number; booked: number }>();

      list.forEach((branch, i) => {
        const evs = all
          .filter((e) => (own.get(branch.id) ? e.branch_id === branch.id : e.branch_id === null))
          .map(toAvailabilityEvent);
        const services = (catalogs[i]!.data ?? [])
          .filter((s) => s.kind === 'service')
          .map((s) => ({ id: s.item_id, name: s.name, capacity: s.capacity ?? 1 }));
        const bks = (bookings.data ?? []).filter((b) => b.branch_id === branch.id);
        const now = occupancy({
          events: evs,
          services,
          bookings: bks,
          from: Date.parse(scope.from),
          to: Date.parse(scope.to),
          timezone: branch.timezone,
        });
        cur.push(now.total);
        prev.push(
          occupancy({
            events: evs,
            services,
            bookings: bks,
            from: Date.parse(previous.from),
            to: Date.parse(previous.to),
            timezone: branch.timezone,
          }).total,
        );
        for (const s of now.byService) {
          const acc = perService.get(s.id) ?? { id: s.id, name: s.name, offered: 0, booked: 0 };
          acc.offered += s.offered;
          acc.booked += s.booked;
          perService.set(s.id, acc);
        }
      });

      return {
        current: combineOccupancy(cur),
        previous: combineOccupancy(prev),
        byService: [...perService.values()]
          .filter((s) => s.offered > 0)
          .map((s) => ({ ...s, rate: s.booked / s.offered }))
          .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Listas cortas: próximas de hoy y pendientes
// ---------------------------------------------------------------------------

export interface ShortBooking {
  id: string;
  code: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  starts_at: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  branch: { name: string; timezone: string | null } | null;
}

const SHORT =
  'id, code, status, starts_at, customer_name, customer_phone, service_name, branch:branches(name, timezone)';

export function useShortList(kind: 'today' | 'pending', branchId: string | null, todayEnd: string) {
  const company = useCompany();
  return useQuery({
    queryKey: ['dashboard', company.id, 'list', kind, branchId, todayEnd],
    staleTime: 30_000,
    queryFn: async (): Promise<ShortBooking[]> => {
      let q = supabase
        .from('bookings')
        .select(SHORT)
        .eq('company_id', company.id)
        .gte('starts_at', new Date().toISOString());
      q =
        kind === 'today'
          ? q.in('status', ['pending', 'confirmed']).lt('starts_at', todayEnd)
          : q.eq('status', 'pending');
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q.order('starts_at').limit(6);
      if (error) throw error;
      return data as ShortBooking[];
    },
  });
}
