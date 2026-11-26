/**
 * Errores de Supabase (Auth, PostgREST, Postgres) y del Worker → mensaje en español
 * para el usuario (fase 03 §6). TS puro: lo usan el cliente y el Worker.
 */

export interface ErrorLike {
  code?: string | undefined;
  message?: string | undefined;
  status?: number | undefined;
  name?: string | undefined;
}

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Correo o contraseña incorrectos.',
  email_not_confirmed: 'Confirma tu correo antes de entrar.',
  user_not_found: 'No existe una cuenta con ese correo.',
  user_banned: 'Tu cuenta está bloqueada.',
  weak_password: 'La contraseña es muy débil: usa al menos 8 caracteres.',
  same_password: 'La contraseña nueva debe ser distinta de la actual.',
  over_email_send_rate_limit: 'Se enviaron demasiados correos. Intenta de nuevo en unos minutos.',
  over_request_rate_limit: 'Demasiados intentos. Espera un momento y vuelve a intentar.',
  signup_disabled: 'El registro está cerrado: solo se entra por invitación.',
  otp_expired: 'El enlace venció o ya se usó. Pide uno nuevo.',
  session_not_found: 'Tu sesión terminó. Inicia sesión de nuevo.',
  email_exists: 'Ya existe una cuenta con ese correo.',
};

const PG_MESSAGES: Record<string, string> = {
  '23505': 'Ya existe un registro con esos datos.',
  '23503': 'No se puede completar: hay datos relacionados.',
  '23514': 'Algún dato no es válido.',
  '22P02': 'Algún dato tiene un formato no válido.',
  '23502': 'Falta un dato obligatorio.',
  '22001': 'Algún texto es demasiado largo.',
  '40001': 'Hubo un cruce con otro cambio. Intenta de nuevo.',
  '40P01': 'Hubo un cruce con otro cambio. Intenta de nuevo.',
  '57014': 'La operación tardó demasiado. Intenta con un rango más corto.',
  '42501': 'No tienes permiso para hacer esto.',
  PGRST116: 'No encontramos ese registro: puede que ya no exista.',
  PGRST301: 'Tu sesión terminó. Inicia sesión de nuevo.',
  PGRST303: 'Tu sesión terminó. Inicia sesión de nuevo.',
};

/** Restricciones únicas con mensaje propio (el nombre viene en el mensaje de Postgres). */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  catalog_items_company_id_reference_key: 'Ya existe otro ítem con esa referencia.',
  branches_company_id_slug_key: 'Ya existe otra sede con esa dirección web.',
};

export const GENERIC_ERROR = 'Algo salió mal. Intenta de nuevo.';

export function errorMessage(error: unknown): string {
  if (error === null || error === undefined) return GENERIC_ERROR;
  if (typeof error === 'string') return error;
  const e = error as ErrorLike;

  if (e.name === 'TypeError' && /fetch|network/i.test(e.message ?? '')) {
    return 'No hay conexión con el servidor. Revisa tu internet.';
  }
  if (e.code && AUTH_MESSAGES[e.code]) return AUTH_MESSAGES[e.code] as string;
  // `raise exception` de nuestras funciones: el mensaje ya está en español.
  if (e.code === 'P0001' && e.message) return e.message;
  // Reservas (fases 10–11): SV001 cupo, SV002 productos, SV003 datos, SV004 no disponible,
  // SV005 cancelar, SV006 transición. El mensaje ya está en español.
  if (e.code?.startsWith('SV') && e.message) {
    return e.message === 'SLOT_TAKEN' ? 'Ese horario ya está lleno. Elige otro.' : e.message;
  }
  // Triggers propios con mensaje en español (p. ej. slug reservado).
  if (e.code === '23514' && e.message && /[áéíóúñ]|reservado|debe/i.test(e.message)) return e.message;
  if (e.code === '23505' && e.message) {
    const known = Object.keys(CONSTRAINT_MESSAGES).find((name) => e.message?.includes(name));
    if (known) return CONSTRAINT_MESSAGES[known] as string;
  }
  if (e.code && PG_MESSAGES[e.code]) return PG_MESSAGES[e.code] as string;
  if (e.status !== undefined && e.status >= 500)
    return 'El servidor no está disponible. Intenta de nuevo en un momento.';
  if (e.status === 429) return AUTH_MESSAGES.over_request_rate_limit as string;
  if (e.status === 401) return 'Tu sesión terminó. Inicia sesión de nuevo.';
  if (e.status === 403) return PG_MESSAGES['42501'] as string;
  return GENERIC_ERROR;
}
