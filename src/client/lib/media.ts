import imageCompression from 'browser-image-compression';
import { useQuery } from '@tanstack/react-query';
import {
  MEDIA_MAX_BYTES,
  MEDIA_MAX_SIDE,
  MEDIA_THUMB_SIDE,
  mediaObjectPath,
  thumbPath,
  type MediaEntity,
} from '@shared/content';
import { mediaUrl as buildMediaUrl } from '@shared/tenant';
import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const BUCKET = 'media';

/** URL pública directa del bucket `media` (00 D14). `thumb` = miniatura de 400 px. */
export function mediaUrl(path: string | null | undefined, variant?: 'thumb'): string | null {
  if (!path) return null;
  return buildMediaUrl(SUPABASE_URL, variant === 'thumb' ? thumbPath(path) : path);
}

/** Recorte en píxeles de la imagen original (lo entrega react-easy-crop). */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = src;
  });
}

/** Recorta en un canvas (lado mayor ≤ MEDIA_MAX_SIDE) y devuelve PNG sin pérdida para comprimir después. */
async function cropToBlob(file: File, crop: CropArea | null): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const area = crop ?? { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight };
    const scale = Math.min(1, MEDIA_MAX_SIDE / Math.max(area.width, area.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(area.width * scale));
    canvas.height = Math.max(1, Math.round(area.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no permite procesar imágenes');
    ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('No se pudo procesar la imagen');
    return new File([blob], 'crop.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function toWebp(file: File, maxSide: number, maxBytes: number): Promise<Blob> {
  // Baja la calidad hasta entrar en el tope (normalmente basta el primer intento).
  for (const quality of [0.82, 0.72, 0.6, 0.5]) {
    const out = await imageCompression(file, {
      fileType: 'image/webp',
      initialQuality: quality,
      maxWidthOrHeight: maxSide,
      maxSizeMB: maxBytes / (1024 * 1024),
      alwaysKeepResolution: false,
      useWebWorker: true,
    });
    if (out.size <= maxBytes) return out;
  }
  throw new Error('No se pudo comprimir la imagen por debajo de 400 KB. Prueba con otra.');
}

/** Imagen principal (≤ 1600 px, ≤ 400 KB) y miniatura (400 px), ambas WebP. */
export async function processImage(file: File, crop: CropArea | null): Promise<{ main: Blob; thumb: Blob }> {
  const cropped = await cropToBlob(file, crop);
  const main = await toWebp(cropped, MEDIA_MAX_SIDE, MEDIA_MAX_BYTES);
  const thumb = await toWebp(cropped, MEDIA_THUMB_SIDE, 60 * 1024);
  return { main, thumb };
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sube principal + miniatura con caché de 1 año (nombre inmutable). Devuelve la ruta. */
export async function uploadImage(
  companyId: string,
  entity: MediaEntity,
  images: { main: Blob; thumb: Blob },
): Promise<string> {
  const path = mediaObjectPath(companyId, entity, crypto.randomUUID(), await sha256Hex(images.main));
  const options = { contentType: 'image/webp', cacheControl: '31536000', upsert: false };
  const main = await supabase.storage.from(BUCKET).upload(path, images.main, options);
  if (main.error) throw main.error;
  const thumb = await supabase.storage.from(BUCKET).upload(thumbPath(path), images.thumb, options);
  if (thumb.error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw thumb.error;
  }
  return path;
}

/**
 * Copia una imagen (y su miniatura) a una ruta nueva de la misma empresa y entidad, para que
 * cada registro tenga su archivo y borrar uno no rompa los demás.
 */
export async function copyImage(path: string): Promise<string> {
  const match = /^(.+\/)[0-9a-f-]{36}-([0-9a-f]+)\.webp$/.exec(path);
  if (!match) throw new Error('Ruta de imagen no reconocida');
  const target = `${match[1]}${crypto.randomUUID()}-${match[2]}.webp`;
  const main = await supabase.storage.from(BUCKET).copy(path, target);
  if (main.error) throw main.error;
  const thumb = await supabase.storage.from(BUCKET).copy(thumbPath(path), thumbPath(target));
  if (thumb.error) throw thumb.error;
  return target;
}

/**
 * Borra imágenes (y sus miniaturas) que ya no usa nadie. Los errores se ignoran: un archivo
 * huérfano solo ocupa cuota, nunca rompe el sitio.
 */
export async function deleteImages(paths: (string | null | undefined)[]): Promise<void> {
  const targets = paths.filter((p): p is string => !!p && !/^https?:\/\//.test(p)).flatMap((p) => [p, thumbPath(p)]);
  if (targets.length === 0) return;
  await supabase.storage.from(BUCKET).remove(targets);
}

/** Tras guardar: borra las imágenes anteriores que se reemplazaron o quitaron. */
export async function cleanupReplaced(
  before: (string | null | undefined)[],
  after: (string | null | undefined)[],
): Promise<void> {
  const keep = new Set(after.filter(Boolean));
  await deleteImages(before.filter((p) => p && !keep.has(p)));
}

export function useStorageUsage(companyId: string) {
  return useQuery({
    queryKey: ['storage-usage', companyId],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('company_storage_usage', { p_company: companyId });
      if (error) throw error;
      return Number(data);
    },
    staleTime: 30_000,
  });
}
