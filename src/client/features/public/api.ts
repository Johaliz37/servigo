/**
 * Datos del sitio público (fase 09): `fetch` al Worker (`/api/public/*`, caché de 60 s), sin
 * supabase-js. El tenant lo resuelve el Worker por el Host.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { PublicAboutSection, PublicBranch, PublicItemDetail, PublicSite } from '@shared/public-site';
import { ApiRequestError } from '@client/lib/api-error';
import { useCompany } from '@client/app/tenant-context';

/** En local con `?tenant=` el Worker necesita el parámetro también en las llamadas a la API. */
function withTenant(path: string): string {
  const tenant = new URLSearchParams(window.location.search).get('tenant');
  if (!tenant) return path;
  return `${path}${path.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(tenant)}`;
}

export async function publicFetch<T>(path: string): Promise<T> {
  const res = await fetch(withTenant(path), { headers: { accept: 'application/json' } });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload ?? {}) as { error?: string; message?: string };
    throw new ApiRequestError(res.status, err.error ?? 'http_error', err.message ?? 'No pudimos cargar la página.');
  }
  return payload as T;
}

/** 404 no se arregla reintentando. */
const retry = (count: number, error: unknown) =>
  count < 2 && !(error instanceof ApiRequestError && error.status === 404);

export const isNotFound = (error: unknown) => error instanceof ApiRequestError && error.status === 404;

const STALE = 60_000;

export function usePublicSite() {
  const company = useCompany();
  return useQuery({
    queryKey: ['public', company.id, 'site'],
    queryFn: () => publicFetch<PublicSite>('/api/public/site'),
    staleTime: STALE,
    retry,
  });
}

export function usePublicBranch(branchSlug: string) {
  const company = useCompany();
  return useQuery({
    queryKey: ['public', company.id, 'branch', branchSlug],
    queryFn: () => publicFetch<PublicBranch>(`/api/public/branch/${encodeURIComponent(branchSlug)}`),
    staleTime: STALE,
    retry,
  });
}

export function usePublicItem(branchSlug: string, id: string) {
  const company = useCompany();
  return useQuery({
    queryKey: ['public', company.id, 'item', branchSlug, id],
    queryFn: () =>
      publicFetch<PublicItemDetail>(`/api/public/item/${encodeURIComponent(branchSlug)}/${encodeURIComponent(id)}`),
    staleTime: STALE,
    retry,
  });
}

export function usePublicAbout() {
  const company = useCompany();
  return useQuery({
    queryKey: ['public', company.id, 'about'],
    queryFn: () => publicFetch<PublicAboutSection[]>('/api/public/about'),
    staleTime: STALE,
    retry,
  });
}

/**
 * Siembra la caché con los datos que el Worker incrustó en el HTML (`window.__PUBLIC__`,
 * claves de `publicDataKey`): la primera página pinta sin esperar a la API. Se usa una vez.
 */
export function seedPublicData(queryClient: QueryClient, companyId: string): void {
  const w = window as { __PUBLIC__?: Record<string, unknown> };
  const data = w.__PUBLIC__;
  if (!data) return;
  delete w.__PUBLIC__;
  for (const [key, value] of Object.entries(data)) {
    const [type, ...rest] = key.split(':');
    if (type === 'site' || type === 'branch' || type === 'item') {
      queryClient.setQueryData(['public', companyId, type, ...rest], value);
    }
  }
}
