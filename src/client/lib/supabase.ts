import { createClient } from '@supabase/supabase-js';
import type { Database } from '@shared/database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY (ver .env.example)');
}

// Sesión en localStorage por origen (cada subdominio tiene la suya); nunca cookies de
// dominio padre (00 D12). Solo lo importan los chunks de admin/consola/auth.
export const supabase = createClient<Database>(url, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
