/**
 * Datos del calendario (fase 08). Los eventos se leen y escriben directo con RLS; los cambios
 * van como planes atómicos (`apply_availability_plan`) con actualización optimista y
 * «Deshacer» (plan inverso).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { applyPlan, invertPlan, type EventRow, type Plan } from '@shared/calendar';
import type { BookingStatus } from '@shared/availability';
import type { Json } from '@shared/database.types';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { supabase } from '@client/lib/supabase';
import { useMembership } from '@client/features/auth/membership';

export interface CalendarBranch {
  id: string;
  name: string;
  timezone: string;
  ownAvailability: boolean;
  isActive: boolean;
}

/** Sedes visibles en el calendario (staff: solo las asignadas). */
export function useCalendarBranches() {
  const company = useCompany();
  const { branchIds } = useMembership();
  return useQuery({
    queryKey: ['calendar-branches', company.id],
    queryFn: async (): Promise<CalendarBranch[]> => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, timezone, own_availability, is_active')
        .eq('company_id', company.id)
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data.map((b) => ({
        id: b.id,
        name: b.name,
        timezone: b.timezone ?? company.timezone,
        ownAvailability: b.own_availability,
        isActive: b.is_active,
      }));
    },
    select: (list) => list.filter((b) => branchIds === null || branchIds.includes(b.id)),
  });
}

/** `null` = eventos de nivel empresa (los usan las sedes sin horario propio). */
export const eventsKey = (companyId: string, branchId: string | null) => [
  'availability-events',
  companyId,
  branchId ?? 'company',
];

/**
 * Eventos de la sede (o de la empresa). Se cargan todos: las series recurrentes valen para
 * cualquier rango y una empresa tiene, como mucho, unos cientos de eventos.
 */
export function useAvailabilityEvents(branchId: string | null) {
  const company = useCompany();
  return useQuery({
    queryKey: eventsKey(company.id, branchId),
    queryFn: async (): Promise<EventRow[]> => {
      let query = supabase.from('availability_events').select('*').eq('company_id', company.id);
      query = branchId ? query.eq('branch_id', branchId) : query.is('branch_id', null);
      const { data, error } = await query.order('starts_at').order('id');
      if (error) throw error;
      return data;
    },
  });
}

async function runPlan(plan: Plan): Promise<void> {
  // created_at/updated_at los pone la BD (una fila nueva aún no los tiene: '' no es una fecha).
  const inserts = plan.inserts.map((row) => {
    const copy: Partial<EventRow> = { ...row };
    delete copy.created_at;
    delete copy.updated_at;
    return copy;
  });
  const payload = { ...plan, inserts };
  const { error } = await supabase.rpc('apply_availability_plan', { p_plan: payload as unknown as Json });
  if (error) throw error;
}

/**
 * Aplica planes con actualización optimista. `apply(plan, { undo })` muestra «Deshacer»
 * durante 5 s (aplica el plan inverso sobre las filas de antes).
 */
export function useApplyPlan(branchId: string | null) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const key = eventsKey(company.id, branchId);
  const mutation = useMutation({
    mutationFn: runPlan,
    onMutate: async (plan: Plan) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<EventRow[]>(key) ?? [];
      queryClient.setQueryData<EventRow[]>(key, applyPlan(before, plan));
      return { before };
    },
    onError: (_error, _plan, context) => {
      if (context) queryClient.setQueryData(key, context.before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  async function apply(plan: Plan, options: { success?: string; undo?: boolean } = {}): Promise<boolean> {
    const before = queryClient.getQueryData<EventRow[]>(key) ?? [];
    try {
      await mutation.mutateAsync(plan);
    } catch (error) {
      toast.error(messageOf(error));
      return false;
    }
    if (options.success) {
      toast.success(options.success, {
        duration: options.undo ? 5000 : undefined,
        action: options.undo
          ? {
              label: 'Deshacer',
              onClick: () => {
                mutation.mutate(invertPlan(plan, before), {
                  onSuccess: () => toast.success('Cambio deshecho'),
                  onError: (error) => toast.error(messageOf(error)),
                });
              },
            }
          : undefined,
      });
    }
    return true;
  }

  return { apply, pending: mutation.isPending };
}

export interface CalendarBooking {
  id: string;
  code: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  block_starts_at: string;
  block_ends_at: string;
  customer_name: string;
  service_name: string;
  service_id: string;
  branch_id: string;
}

/** Reservas no canceladas de las sedes en el rango visible (capa «Reservas»). */
export function useCalendarBookings(branchIds: string[], range: { from: number; to: number } | null) {
  const company = useCompany();
  return useQuery({
    queryKey: ['calendar-bookings', company.id, branchIds.join(','), range?.from, range?.to],
    enabled: !!range && branchIds.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<CalendarBooking[]> => {
      const { data, error } = await supabase
        .from('bookings')
        .select(
          'id, code, status, starts_at, ends_at, block_starts_at, block_ends_at, customer_name, service_name, service_id, branch_id',
        )
        .eq('company_id', company.id)
        .in('branch_id', branchIds)
        .neq('status', 'cancelled')
        .lt('block_starts_at', new Date(range!.to).toISOString())
        .gt('block_ends_at', new Date(range!.from).toISOString())
        .order('starts_at');
      if (error) throw error;
      return data;
    },
  });
}

export interface CalendarService {
  id: string;
  name: string;
  durationMinutes: number;
  bufferBefore: number;
  bufferAfter: number;
  capacity: number;
  isActive: boolean;
}

export function useCalendarServices() {
  const company = useCompany();
  return useQuery({
    queryKey: ['calendar-services', company.id],
    queryFn: async (): Promise<CalendarService[]> => {
      const { data, error } = await supabase
        .from('catalog_items')
        .select('id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, capacity, is_active')
        .eq('company_id', company.id)
        .eq('kind', 'service')
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data.map((s) => ({
        id: s.id,
        name: s.name,
        durationMinutes: s.duration_minutes ?? 30,
        bufferBefore: s.buffer_before_minutes,
        bufferAfter: s.buffer_after_minutes,
        capacity: s.capacity,
        isActive: s.is_active,
      }));
    },
  });
}

/** Activa (o desactiva) el horario propio de una sede, opcionalmente copiando el general. */
export function useSetOwnAvailability() {
  const company = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ branchId, own, copy }: { branchId: string; own: boolean; copy?: Plan }) => {
      if (copy && copy.inserts.length) await runPlan(copy);
      const { data, error } = await supabase
        .from('branches')
        .update({ own_availability: own })
        .eq('id', branchId)
        .select('id');
      if (error) throw error;
      if (data.length === 0) throw Object.assign(new Error('forbidden'), { code: '42501' });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calendar-branches', company.id] }),
        queryClient.invalidateQueries({ queryKey: ['availability-events', company.id] }),
        queryClient.invalidateQueries({ queryKey: ['branches', company.id] }),
      ]);
    },
  });
}
