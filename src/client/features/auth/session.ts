import { useSyncExternalStore } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from '@client/lib/supabase';

export type SessionState =
  | { status: 'loading'; session: null; lastEvent: null }
  | { status: 'ready'; session: Session | null; lastEvent: AuthChangeEvent };

let state: SessionState = { status: 'loading', session: null, lastEvent: null };
const listeners = new Set<() => void>();

// Una sola suscripción por pestaña. No se llama a Supabase dentro del callback
// (supabase-js lo desaconseja: puede bloquearse).
supabase.auth.onAuthStateChange((event, session) => {
  state = { status: 'ready', session, lastEvent: event };
  for (const listener of listeners) listener();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sesión actual de Supabase Auth (localStorage de este subdominio). */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, () => state);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * ¿Debe crear contraseña? Un usuario que llega por `inviteUserByEmail` no tiene una;
 * al crearla se marca `password_set` en sus metadatos.
 */
export function needsPassword(session: Session | null): boolean {
  const user = session?.user;
  return !!user?.invited_at && user.user_metadata.password_set !== true;
}

/** Destino seguro tras el login: solo rutas internas del área (evita open redirects). */
export function safeNext(next: string | null, base: '/admin' | '/console'): string {
  if (!next || !next.startsWith(base) || next.startsWith('//') || next.includes('\\')) return base;
  return next;
}
