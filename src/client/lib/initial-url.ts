/**
 * Hash de la URL al cargar, antes de que supabase-js lo procese y lo borre. Supabase Auth
 * informa ahí de enlaces vencidos (`#error_code=otp_expired&error_description=…`).
 * Se importa desde main.tsx para que se evalúe primero.
 */
const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));

export const initialAuthError: { code: string; description: string } | null = params.get('error_code')
  ? { code: params.get('error_code') ?? '', description: params.get('error_description') ?? '' }
  : null;
