import type { ApiError } from '@shared/schemas';
import { ApiRequestError } from './api-error';
import { supabase } from './supabase';

/** Llama a la API del Worker con el JWT de la sesión actual. */
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(
      res.status,
      err.error ?? 'http_error',
      err.message ?? 'Algo salió mal. Intenta de nuevo.',
    );
  }
  return payload as T;
}
