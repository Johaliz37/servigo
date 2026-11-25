/**
 * Datos de la reserva pública (fase 10): `fetch` al Worker, sin supabase-js. Las escrituras
 * llevan el token de Turnstile; el Worker aplica rate limit y revalida todo.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DaySlots } from '@shared/availability';
import type {
  BookingDetail,
  BookingForm,
  BookingRequest,
  BookingSummary,
  CreatedBooking,
  LookupRequest,
} from '@shared/booking';
import { ApiRequestError } from '@client/lib/api-error';
import { useCompany } from '@client/app/tenant-context';
import { isNotFound, publicFetch } from '@client/features/public/api';

function withTenant(path: string): string {
  const tenant = new URLSearchParams(window.location.search).get('tenant');
  if (!tenant) return path;
  return `${path}${path.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(tenant)}`;
}

async function send<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(withTenant(path), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload ?? {}) as { error?: string; message?: string };
    throw new ApiRequestError(
      res.status,
      err.error ?? 'http_error',
      err.message ?? 'Algo salió mal. Intenta de nuevo.',
    );
  }
  return payload as T;
}

const retry = (count: number, error: unknown) => count < 2 && !isNotFound(error);

export function useBookingForm(branchSlug: string, serviceId: string | undefined) {
  const company = useCompany();
  return useQuery({
    queryKey: ['public', company.id, 'booking-form', branchSlug, serviceId],
    enabled: !!serviceId,
    queryFn: () =>
      publicFetch<BookingForm>(
        `/api/public/booking-form/${encodeURIComponent(branchSlug)}/${encodeURIComponent(serviceId!)}`,
      ),
    staleTime: 60_000,
    retry,
  });
}

export interface SlotsResponse {
  timezone: string;
  days: DaySlots[];
}

/** Cupos de un mes (fechas locales de la sede, `from`/`to` inclusive, ≤ 31 días). */
export function useMonthSlots(branchId: string | undefined, serviceId: string | undefined, from: string, to: string) {
  const company = useCompany();
  return useQuery({
    queryKey: ['public', company.id, 'slots', branchId, serviceId, from, to],
    enabled: !!branchId && !!serviceId,
    queryFn: () =>
      publicFetch<SlotsResponse>(`/api/public/slots?branch=${branchId}&service=${serviceId}&from=${from}&to=${to}`),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry,
  });
}

export const createBooking = (body: BookingRequest) => send<CreatedBooking>('/api/bookings', body);

export const lookupBookings = (body: LookupRequest) =>
  send<{ results: BookingSummary[] }>('/api/bookings/lookup', body);

export const cancelBooking = (code: string, token: string, turnstile: string) =>
  send<BookingDetail>(`/api/bookings/${encodeURIComponent(code)}/cancel`, { token, turnstile });

export function useBookingDetail(code: string, token: string | null) {
  const company = useCompany();
  return useQuery({
    queryKey: ['booking', company.id, code, token],
    enabled: !!token,
    queryFn: () =>
      publicFetch<BookingDetail>(`/api/bookings/${encodeURIComponent(code)}?t=${encodeURIComponent(token!)}`),
    retry,
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Tokens guardados en este navegador (para volver a ver una reserva sin el enlace)
// ---------------------------------------------------------------------------

const tokenKey = (companyId: string) => `servigo:booking-tokens:${companyId}`;

export function readToken(companyId: string, code: string): string | null {
  try {
    const map = JSON.parse(localStorage.getItem(tokenKey(companyId)) ?? '{}') as Record<string, string>;
    return map[code] ?? null;
  } catch {
    return null;
  }
}

export function saveToken(companyId: string, code: string, token: string): void {
  try {
    const map = JSON.parse(localStorage.getItem(tokenKey(companyId)) ?? '{}') as Record<string, string>;
    map[code] = token;
    // Solo las últimas 20 reservas.
    const entries = Object.entries(map).slice(-20);
    localStorage.setItem(tokenKey(companyId), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Sin localStorage: el token sigue en la URL.
  }
}
