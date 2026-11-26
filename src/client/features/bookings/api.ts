/**
 * Reservas en el panel (fase 11): lecturas directas con RLS (staff solo ve sus sedes) y
 * escrituras solo por RPC (D29: máquina de estados, cupo e historial en SQL).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  computeSlots,
  dayStartInstant,
  localDate,
  toSlotQuery,
  DAY,
  type BookingStatus,
  type DaySlots,
  type SlotInputs,
} from '@shared/availability';
import {
  bookingsCsv,
  mergeStatuses,
  searchFilter,
  tabCriteria,
  type CsvBooking,
  type InboxTab,
  type TargetStatus,
} from '@shared/booking-admin';
import type { BookingField } from '@shared/booking-fields';
import { toBookingField } from '@shared/booking-fields';
import type { Json } from '@shared/database.types';
import { useCompany } from '@client/app/tenant-context';
import { apiFetch } from '@client/lib/api';
import { supabase } from '@client/lib/supabase';

// ---------------------------------------------------------------------------
// Bandeja
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 25;

export interface InboxFilters {
  tab: InboxTab;
  /** `null` = todas las sedes visibles. */
  branchId: string | null;
  serviceId: string | null;
  status: BookingStatus | null;
  /** 'YYYY-MM-DD' (zona de la sede o de la empresa), inclusivos. */
  from: string | null;
  to: string | null;
  q: string;
}

export interface InboxRow {
  id: string;
  code: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  service_name: string;
  service_id: string;
  branch_id: string;
  total: number;
  currency: string;
  source: string;
  created_at: string;
  branch: { name: string; timezone: string | null } | null;
}

const INBOX_COLUMNS =
  'id, code, status, starts_at, ends_at, customer_name, customer_phone, customer_email, service_name, service_id, branch_id, total, currency, source, created_at, branch:branches(name, timezone)';

/** Filtros de la bandeja sobre una consulta de `bookings` (la misma para la tabla y el CSV). */
function inboxQuery(companyId: string, filters: InboxFilters, timezone: string, count: boolean) {
  const now = new Date();
  const todayDate = localDate(now.getTime(), timezone);
  const today = { start: dayStartInstant(todayDate, timezone), end: dayStartInstant(todayDate, timezone) + DAY };
  const criteria = tabCriteria(filters.tab, now, today);
  const statuses = mergeStatuses(criteria.statuses, filters.status);

  let query = supabase
    .from('bookings')
    .select(INBOX_COLUMNS, count ? { count: 'exact' } : undefined)
    .eq('company_id', companyId);
  if (filters.branchId) query = query.eq('branch_id', filters.branchId);
  if (filters.serviceId) query = query.eq('service_id', filters.serviceId);
  if (statuses?.length) query = query.in('status', statuses);
  // Estado elegido que la pestaña excluye (p. ej. «Canceladas» + «Confirmada»): nada.
  else if (statuses) query = query.is('id', null);
  if (criteria.from) query = query.gte('starts_at', criteria.from);
  if (criteria.to) query = query.lt('starts_at', criteria.to);
  if (filters.from) query = query.gte('starts_at', new Date(dayStartInstant(filters.from, timezone)).toISOString());
  if (filters.to) query = query.lt('starts_at', new Date(dayStartInstant(filters.to, timezone) + DAY).toISOString());
  const or = searchFilter(filters.q);
  if (or) query = query.or(or);
  return query.order('starts_at', { ascending: criteria.ascending }).order('id');
}

export function useInbox(filters: InboxFilters, page: number, timezone: string) {
  const company = useCompany();
  return useQuery({
    queryKey: ['admin-bookings', company.id, filters, page, timezone],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: InboxRow[]; total: number }> => {
      const from = page * PAGE_SIZE;
      const { data, error, count } = await inboxQuery(company.id, filters, timezone, true).range(
        from,
        from + PAGE_SIZE - 1,
      );
      if (error) throw error;
      return { rows: data as InboxRow[], total: count ?? 0 };
    },
  });
}

const CSV_MAX = 5000;
const BOM = String.fromCharCode(0xfeff);

/** CSV del filtro actual (todas las páginas, hasta 5.000 filas), generado en el navegador. */
export async function exportInboxCsv(
  companyId: string,
  filters: InboxFilters,
  timezone: string,
  locale: string,
): Promise<{ csv: string; rows: number; truncated: boolean }> {
  const rows: InboxRow[] = [];
  for (let from = 0; from < CSV_MAX; from += 1000) {
    const { data, error } = await inboxQuery(companyId, filters, timezone, false).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as InboxRow[]));
    if (data.length < 1000) break;
  }
  const csvRows: CsvBooking[] = rows.map((r) => ({
    ...r,
    branch: r.branch ? { name: r.branch.name, timezone: r.branch.timezone ?? timezone } : null,
  }));
  // BOM: Excel abre el UTF-8 con tildes bien.
  return {
    csv: `${BOM}${bookingsCsv(csvRows, timezone, locale)}`,
    rows: rows.length,
    truncated: rows.length >= CSV_MAX,
  };
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

export interface AdminBookingItem {
  id: string;
  product_id: string | null;
  name: string;
  unit_price: number;
  discount: number;
  quantity: number;
  line_total: number;
}

export interface AdminBookingAnswer {
  id: string;
  field_id: string | null;
  label: string;
  type: BookingField['type'];
  value: Json;
  field: { options: Json } | null;
}

export interface AdminBooking {
  id: string;
  company_id: string;
  branch_id: string;
  service_id: string;
  customer_id: string;
  code: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  block_starts_at: string;
  block_ends_at: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  customer_notes: string | null;
  internal_notes: string | null;
  service_name: string;
  service_price: number;
  service_discount: number;
  products_total: number;
  discount_total: number;
  total: number;
  currency: string;
  source: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  branch: { id: string; name: string; slug: string; timezone: string | null } | null;
  items: AdminBookingItem[];
  answers: AdminBookingAnswer[];
}

export function useAdminBooking(id: string | null) {
  const company = useCompany();
  return useQuery({
    queryKey: ['admin-booking', company.id, id],
    enabled: !!id,
    queryFn: async (): Promise<AdminBooking | null> => {
      const { data, error } = await supabase
        .from('bookings')
        .select(
          '*, branch:branches(id, name, slug, timezone), items:booking_items(id, product_id, name, unit_price, discount, quantity, line_total), answers:booking_answers(id, field_id, label, type, value, field:booking_fields(options))',
        )
        .eq('company_id', company.id)
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data as AdminBooking | null;
    },
  });
}

export interface HistoryRow {
  id: string;
  action: 'created' | 'status_changed' | 'rescheduled' | 'edited';
  payload: Record<string, unknown>;
  created_at: string;
  actor_email: string | null;
}

export function useBookingHistory(id: string | null) {
  const company = useCompany();
  return useQuery({
    queryKey: ['admin-booking', company.id, id, 'history'],
    enabled: !!id,
    queryFn: async (): Promise<HistoryRow[]> => {
      const { data, error } = await supabase.rpc('booking_history', { p_booking: id! });
      if (error) throw error;
      return data as HistoryRow[];
    },
  });
}

/** Otras reservas del mismo cliente (las que RLS deja ver). */
export function useCustomerBookings(customerId: string | null) {
  const company = useCompany();
  return useQuery({
    queryKey: ['admin-bookings', company.id, 'customer', customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<InboxRow[]> => {
      const { data, error } = await supabase
        .from('bookings')
        .select(INBOX_COLUMNS)
        .eq('company_id', company.id)
        .eq('customer_id', customerId!)
        .order('starts_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as InboxRow[];
    },
  });
}

// ---------------------------------------------------------------------------
// Mutaciones (RPC)
// ---------------------------------------------------------------------------

interface Touched {
  branch_id: string;
  service_id: string;
}

/** Tras cualquier cambio: refrescar el panel y los cupos cacheados del sitio público (D28). */
function useAfterChange() {
  const queryClient = useQueryClient();
  return (touched: Touched[]) => {
    void queryClient.invalidateQueries({ queryKey: ['admin-bookings'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-booking'] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-bookings'] });
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    const unique = new Map(touched.map((t) => [`${t.branch_id}:${t.service_id}`, t]));
    for (const t of unique.values()) {
      // Si falla, el sitio se actualiza igual al vencer los 30 s de caché.
      apiFetch('/api/admin/slots-changed', { body: t }).catch(() => undefined);
    }
  };
}

export function useChangeStatus() {
  const after = useAfterChange();
  return useMutation({
    mutationFn: async (input: { ids: string[]; to: TargetStatus; reason?: string }) => {
      const results = await Promise.allSettled(
        input.ids.map(async (id) => {
          const { data, error } = await supabase.rpc('change_booking_status', {
            p_booking: id,
            p_to: input.to,
            ...(input.reason ? { p_reason: input.reason } : {}),
          });
          if (error) throw error;
          return data as unknown as Touched;
        }),
      );
      const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      const failed = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
      return { ok, failed };
    },
    onSuccess: ({ ok }) => after(ok),
  });
}

export function useReschedule() {
  const after = useAfterChange();
  return useMutation({
    mutationFn: async (input: { id: string; startsAt: string; capacity: number | null; force: boolean }) => {
      const { data, error } = await supabase.rpc('reschedule_booking', {
        p_booking: input.id,
        p_starts_at: input.startsAt,
        ...(input.capacity !== null ? { p_capacity: input.capacity } : {}),
        p_force: input.force,
      });
      if (error) throw error;
      return data as unknown as Touched;
    },
    onSuccess: (touched) => after([touched]),
  });
}

export interface UpdatePayload {
  customer?: { name: string; phone: string; email: string | null; notes: string | null };
  items?: { product_id: string; quantity: number }[];
  answers?: { field_id: string | null; value: unknown }[];
  reprice?: boolean;
}

export function useUpdateBooking() {
  const after = useAfterChange();
  return useMutation({
    mutationFn: async (input: {
      booking: Pick<AdminBooking, 'id' | 'branch_id' | 'service_id'>;
      payload: UpdatePayload;
    }) => {
      const { error } = await supabase.rpc('update_booking_admin', {
        p_booking: input.booking.id,
        p_payload: input.payload as Json,
      });
      if (error) throw error;
      return input.booking;
    },
    onSuccess: (b) => after([b]),
  });
}

export function useSaveInternalNotes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; notes: string }) => {
      const { error } = await supabase
        .from('bookings')
        .update({ internal_notes: input.notes.trim() || null })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-booking'] }),
  });
}

export interface AdminCreatePayload {
  branch_id: string;
  service_id: string;
  starts_at: string;
  capacity: number;
  force: boolean;
  status: 'pending' | 'confirmed';
  customer: { name: string; phone: string; email: string | null; notes: string | null };
  items: { product_id: string; quantity: number }[];
  answers: { field_id: string | null; value: unknown }[];
}

export function useCreateAdminBooking() {
  const company = useCompany();
  const after = useAfterChange();
  return useMutation({
    mutationFn: async (payload: AdminCreatePayload) => {
      const { data, error } = await supabase.rpc('create_booking_admin', {
        p_payload: { ...payload, company_id: company.id } as unknown as Json,
      });
      if (error) throw error;
      return data as unknown as { id: string; code: string };
    },
    onSuccess: (_, payload) => after([payload]),
  });
}

// ---------------------------------------------------------------------------
// Cupos en el panel: el mismo motor (D26) con la entrada de `admin_slot_inputs`.
// Sin antelación mínima y hasta un año: el personal agenda a quien llega o llama.
// ---------------------------------------------------------------------------

export function useAdminMonthSlots(input: {
  branchId: string | undefined;
  serviceId: string | undefined;
  timezone: string;
  from: string;
  to: string;
  exclude?: string | undefined;
}) {
  const company = useCompany();
  const { branchId, serviceId, timezone, from, to, exclude } = input;
  return useQuery({
    queryKey: ['admin-slots', company.id, branchId, serviceId, from, to, exclude ?? null],
    enabled: !!branchId && !!serviceId,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async (): Promise<{ days: DaySlots[] }> => {
      const start = dayStartInstant(from, timezone);
      const end = dayStartInstant(to, timezone) + DAY;
      const { data, error } = await supabase.rpc('admin_slot_inputs', {
        p_branch: branchId!,
        p_service: serviceId!,
        p_from: new Date(start - DAY).toISOString(),
        p_to: new Date(end + DAY).toISOString(),
        ...(exclude ? { p_exclude: exclude } : {}),
      });
      if (error) throw error;
      if (!data) return { days: [] };
      const query = toSlotQuery(
        data as unknown as SlotInputs,
        { from: new Date(start), to: new Date(end) },
        new Date(),
      );
      query.settings = { ...query.settings, minLeadMinutes: 0, maxDaysAhead: 366 };
      return { days: computeSlots(query) };
    },
  });
}

/** Capacidad del cupo que empieza en `startsAt` (para reprogramar desde el calendario). */
export async function slotAt(input: {
  branchId: string;
  serviceId: string;
  timezone: string;
  startsAt: string;
  exclude?: string;
}): Promise<{ capacity: number; remaining: number } | null> {
  const day = localDate(Date.parse(input.startsAt), input.timezone);
  const start = dayStartInstant(day, input.timezone);
  const { data, error } = await supabase.rpc('admin_slot_inputs', {
    p_branch: input.branchId,
    p_service: input.serviceId,
    p_from: new Date(start - DAY).toISOString(),
    p_to: new Date(start + 2 * DAY).toISOString(),
    ...(input.exclude ? { p_exclude: input.exclude } : {}),
  });
  if (error) throw error;
  if (!data) return null;
  const query = toSlotQuery(
    data as unknown as SlotInputs,
    { from: new Date(start), to: new Date(start + DAY) },
    new Date(),
  );
  query.settings = { ...query.settings, minLeadMinutes: 0, maxDaysAhead: 366 };
  const iso = new Date(input.startsAt).toISOString();
  const slot = computeSlots(query)
    .flatMap((d) => d.slots)
    .find((s) => s.start === iso);
  return slot ? { capacity: slot.capacity, remaining: slot.remaining } : null;
}

// ---------------------------------------------------------------------------
// Formulario de la reserva manual: servicios de la sede, complementos y campos.
// ---------------------------------------------------------------------------

export interface AdminService {
  id: string;
  name: string;
  duration_minutes: number | null;
  price: number;
  final_price: number;
}

export interface AdminAddon {
  id: string;
  name: string;
  price: number;
  final_price: number;
  max_quantity: number;
}

export function useBranchServices(branchId: string | undefined) {
  return useQuery({
    queryKey: ['admin-branch-services', branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<AdminService[]> => {
      const { data, error } = await supabase.rpc('effective_catalog', { p_branch: branchId! });
      if (error) throw error;
      return data
        .filter((i) => i.kind === 'service')
        .map((i) => ({
          id: i.item_id,
          name: i.name,
          duration_minutes: i.duration_minutes,
          price: i.base_price,
          final_price: i.final_price,
        }));
    },
  });
}

export function useServiceAddons(serviceId: string | undefined, branchId: string | undefined) {
  return useQuery({
    queryKey: ['admin-addons', serviceId, branchId],
    enabled: !!serviceId && !!branchId,
    queryFn: async (): Promise<AdminAddon[]> => {
      const { data, error } = await supabase.rpc('effective_addons', { p_service: serviceId!, p_branch: branchId! });
      if (error) throw error;
      return data.map((a) => ({
        id: a.item_id,
        name: a.name,
        price: a.base_price,
        final_price: a.final_price,
        max_quantity: a.max_quantity,
      }));
    },
  });
}

/** Campos activos de la empresa (se filtran por servicio con `fieldsForService`). */
export function useCompanyFields() {
  const company = useCompany();
  return useQuery({
    queryKey: ['admin-booking-fields', company.id],
    queryFn: async (): Promise<BookingField[]> => {
      const { data, error } = await supabase
        .from('booking_fields')
        .select('*')
        .eq('company_id', company.id)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data.map(toBookingField);
    },
  });
}

export interface CustomerMatch {
  id: string;
  name: string;
  phone: string;
  email: string | null;
}

/** Buscador de clientes por nombre, teléfono o correo (reserva manual). */
export function useCustomerSearch(term: string) {
  const company = useCompany();
  const or = searchFilter(term, { code: 'id', name: 'name', email: 'email', phone: 'phone' });
  return useQuery({
    queryKey: ['customers', company.id, 'search', or],
    enabled: !!or,
    staleTime: 30_000,
    queryFn: async (): Promise<CustomerMatch[]> => {
      // Sin la parte de código (no aplica a clientes).
      const filter = or!
        .split(',')
        .filter((p) => !p.startsWith('id.'))
        .join(',');
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, phone, email')
        .eq('company_id', company.id)
        .or(filter)
        .order('name')
        .limit(8);
      if (error) throw error;
      return data;
    },
  });
}
