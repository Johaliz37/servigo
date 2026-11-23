import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@shared/database.types';
import type { CompanyBySlugRow } from '@shared/tenant';

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

export type Db = SupabaseClient<Database>;

/** Cliente con la secret key: salta RLS. Solo para Auth admin y RPC del servidor. */
export function adminClient(env: Env): Db {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: NO_SESSION });
}

/** Cliente que actúa como el usuario del JWT: RLS decide qué puede hacer. */
export function userClient(env: Env, jwt: string): Db {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: NO_SESSION,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

/** Cliente anónimo (publishable key, sin sesión). */
export function anonClient(env: Env): Db {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: NO_SESSION });
}

export class UpstreamError extends Error {}

/** `get_company_by_slug` con `fetch` directo: es la llamada más frecuente y la más barata así. */
export async function fetchCompanyBySlug(env: Env, slug: string): Promise<CompanyBySlugRow | null> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_company_by_slug`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SECRET_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ p_slug: slug }),
  });
  if (!res.ok) throw new UpstreamError(`get_company_by_slug ${res.status}`);
  return (await res.json()) as CompanyBySlugRow | null;
}

/**
 * Envía el correo de invitación. Usuario nuevo → `inviteUserByEmail` (crea la cuenta);
 * si ya tiene cuenta → enlace mágico al mismo destino (`redirectTo`).
 */
export async function sendInvitationEmail(
  env: Env,
  email: string,
  redirectTo: string,
): Promise<'invite' | 'magic_link' | 'none'> {
  const { error } = await adminClient(env).auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!error) return 'invite';
  if (error.code !== 'email_exists' && error.status !== 422) {
    console.error(JSON.stringify({ msg: 'invite_failed', code: error.code, status: error.status }));
    return 'none';
  }
  const otp = await anonClient(env).auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });
  if (otp.error) {
    console.error(JSON.stringify({ msg: 'magic_link_failed', code: otp.error.code, status: otp.error.status }));
    return 'none';
  }
  return 'magic_link';
}
