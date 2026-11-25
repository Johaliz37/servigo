import { mediaUrl as buildMediaUrl } from '@shared/tenant';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/**
 * URL pública directa del bucket `media` (00 D14). `thumb` = miniatura de 400 px.
 * Módulo aparte de `media.ts` para que el sitio público no cargue supabase-js, el compresor ni zod
 * (la miniatura sigue la regla de `thumbPath` en `@shared/content`).
 */
export function mediaUrl(path: string | null | undefined, variant?: 'thumb'): string | null {
  if (!path) return null;
  return buildMediaUrl(SUPABASE_URL, variant === 'thumb' ? path.replace(/\.webp$/, '.thumb.webp') : path);
}
