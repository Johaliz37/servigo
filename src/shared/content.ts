/**
 * Fase 05: contenido configurable de la empresa (perfil, marca, footer, sedes, Acerca de,
 * patrocinadores, redes) y reglas de imágenes. TS puro: lo usan los formularios y los tests.
 */
import { z } from 'zod';
import { contrastRatio, readableForeground } from './color';
import { emailSchema } from './schemas';

// ---------------------------------------------------------------------------
// Imágenes (bucket `media`, 00 D14)
// ---------------------------------------------------------------------------

/** Tope tras comprimir (criterio de aceptación de la fase 05). */
export const MEDIA_MAX_BYTES = 400 * 1024;
/** Lado mayor de la imagen principal y de la miniatura. */
export const MEDIA_MAX_SIDE = 1600;
export const MEDIA_THUMB_SIDE = 400;
/** Cuota blanda por empresa: al superarla se bloquean nuevas subidas. */
export const MEDIA_SOFT_QUOTA_BYTES = 100 * 1024 * 1024;
/** Lo que el usuario puede elegir; todo se convierte a WebP antes de subir. */
export const MEDIA_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Antes de comprimir (una foto de móvil normal pesa 3–8 MB). */
export const MEDIA_INPUT_MAX_BYTES = 15 * 1024 * 1024;

export type MediaEntity = 'company' | 'branches' | 'about' | 'sponsors' | 'catalog';

/** `{company}/{entidad}/{uuid}-{hash}.webp`: único por subida e inmutable (caché de 1 año). */
export function mediaObjectPath(companyId: string, entity: MediaEntity, id: string, hash: string): string {
  return `${companyId}/${entity}/${id}-${hash.slice(0, 12)}.webp`;
}

/** Ruta de la miniatura (400 px) de una imagen subida por Servigo. */
export function thumbPath(path: string): string {
  return path.replace(/\.webp$/, '.thumb.webp');
}

/** Error legible si el archivo elegido no se puede usar, o `null`. */
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!(MEDIA_INPUT_TYPES as readonly string[]).includes(file.type)) {
    return 'Formato no permitido: usa JPG, PNG o WebP.';
  }
  if (file.size > MEDIA_INPUT_MAX_BYTES) return 'La imagen pesa más de 15 MB.';
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Utilidades de esquema
// ---------------------------------------------------------------------------

/** Texto opcional: '' → null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres` })
    .transform((v) => (v === '' ? null : v))
    .nullable();

const optionalEmail = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .pipe(emailSchema.nullable());

const httpsUrl = z
  .string()
  .trim()
  .regex(/^https?:\/\/[^\s]+\.[^\s]+$/i, { error: 'Escribe una URL completa (https://…)' });

const optionalHttpsUrl = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .pipe(httpsUrl.nullable());

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, { error: 'Color hexadecimal (#RRGGBB)' });

/** Teléfono libre pero razonable: dígitos, espacios, +, -, paréntesis. */
const phoneText = z
  .string()
  .trim()
  .regex(/^$|^\+?[0-9 ()-]{7,20}$/, { error: 'Teléfono no válido' })
  .transform((v) => (v === '' ? null : v))
  .nullable();

// ---------------------------------------------------------------------------
// Perfil y marca
// ---------------------------------------------------------------------------

export const companySeoSchema = z.object({
  title: z.string().trim().max(70, { error: 'Máximo 70 caracteres' }).default(''),
  description: z.string().trim().max(160, { error: 'Máximo 160 caracteres' }).default(''),
  image_path: z.string().nullable().default(null),
});
export type CompanySeo = z.output<typeof companySeoSchema>;

export const companyProfileSchema = z.object({
  name: z.string().trim().min(1, { error: 'Escribe el nombre' }).max(120),
  legal_name: optionalText(160),
  tax_id: optionalText(40),
  contact_email: optionalEmail,
  contact_phone: phoneText,
  whatsapp: phoneText,
  timezone: z.string().trim().min(1, { error: 'Elige la zona horaria' }),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, { error: 'Código ISO 4217 de 3 letras' }),
  locale: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, { error: 'Formato como es-CO' }),
  primary_color: hexColorSchema.nullable(),
  secondary_color: hexColorSchema.nullable(),
  logo_path: z.string().nullable(),
  favicon_path: z.string().nullable(),
  hero_image_path: z.string().nullable(),
  seo: companySeoSchema,
});
export type CompanyProfileInput = z.input<typeof companyProfileSchema>;
export type CompanyProfile = z.output<typeof companyProfileSchema>;

export interface BrandContrast {
  /** Texto del botón (blanco o casi negro, el que más contraste) sobre el primario. Siempre ≥ 4.5. */
  onButton: number;
  /** El primario sobre el fondo blanco del sitio (enlaces, títulos, bordes, iconos). */
  onWhite: number;
  /** AA para texto grande y elementos gráficos (3:1) sobre fondo blanco. */
  passesAA: boolean;
}

/**
 * Con blanco o negro siempre hay ≥ 4.5:1 sobre el botón; el riesgo real es un primario muy
 * claro (amarillo, naranja) usado sobre el fondo blanco. Se avisa si no llega a 3:1.
 */
export function brandContrast(primary: string | null): BrandContrast | null {
  if (!primary) return null;
  const onButton = contrastRatio(primary, readableForeground(primary));
  const onWhite = contrastRatio(primary, '#ffffff');
  if (onButton === null || onWhite === null) return null;
  return { onButton, onWhite, passesAA: onWhite >= 3 };
}

// ---------------------------------------------------------------------------
// Footer (companies.footer)
// ---------------------------------------------------------------------------

export const footerLinkSchema = z.object({
  label: z.string().trim().min(1, { error: 'Escribe el texto' }).max(40),
  url: z
    .string()
    .trim()
    .regex(/^(https?:\/\/[^\s]+|\/[^\s]*|mailto:[^\s]+|tel:[^\s]+)$/i, {
      error: 'URL completa (https://…) o ruta del sitio (/…)',
    }),
});

export const footerSchema = z.object({
  text: z.string().trim().max(500, { error: 'Máximo 500 caracteres' }).default(''),
  address: z.string().trim().max(200).default(''),
  links: z.array(footerLinkSchema).max(10, { error: 'Máximo 10 enlaces' }).default([]),
  show_socials: z.boolean().default(true),
  show_powered_by: z.boolean().default(true),
});
export type Footer = z.output<typeof footerSchema>;

/** Lee el JSON guardado tolerando claves faltantes o viejas. */
export function parseFooter(raw: unknown): Footer {
  const parsed = footerSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : footerSchema.parse({});
}

// ---------------------------------------------------------------------------
// Configuración de reservas (companies.booking_settings)
// ---------------------------------------------------------------------------

export const bookingSettingsSchema = z.object({
  auto_confirm: z.boolean().default(false),
  min_lead_minutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(30 * 24 * 60)
    .default(60),
  max_days_ahead: z.coerce.number().int().min(1, { error: 'Mínimo 1 día' }).max(365).default(60),
  slot_step_minutes: z.coerce
    .number()
    .int()
    .refine((v) => [5, 10, 15, 20, 30, 45, 60, 90, 120].includes(v), { error: 'Paso no válido' })
    .default(30),
  allow_customer_cancel: z.boolean().default(false),
  cancel_limit_hours: z.coerce.number().int().min(0).max(720).default(24),
  require_email: z.boolean().default(false),
  terms_text: z.string().trim().max(5000).default(''),
});
export type BookingSettings = z.output<typeof bookingSettingsSchema>;

export function parseBookingSettings(raw: unknown): BookingSettings {
  const parsed = bookingSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : bookingSettingsSchema.parse({});
}

export const SLOT_STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;

// ---------------------------------------------------------------------------
// Sedes
// ---------------------------------------------------------------------------

/** Igual que el CHECK de `branches.slug` (1–64, sin `--`). */
export const BRANCH_SLUG_REGEX = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const branchHeaderSchema = z.object({
  title: z.string().trim().max(80).default(''),
  subtitle: z.string().trim().max(160).default(''),
  image_path: z.string().nullable().default(null),
  /** Opacidad del velo oscuro sobre la imagen (0 = sin velo). */
  overlay_opacity: z.coerce.number().min(0).max(0.9).default(0.4),
});
export type BranchHeader = z.output<typeof branchHeaderSchema>;

export function parseBranchHeader(raw: unknown): BranchHeader {
  const parsed = branchHeaderSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : branchHeaderSchema.parse({});
}

export const branchSchema = z.object({
  name: z.string().trim().min(1, { error: 'Escribe el nombre' }).max(120),
  slug: z.string().trim().regex(BRANCH_SLUG_REGEX, {
    error: 'Minúsculas, números y guiones (sin "--" ni guion al inicio o final)',
  }),
  address: optionalText(200),
  city: optionalText(80),
  phone: phoneText,
  whatsapp: phoneText,
  email: optionalEmail,
  maps_url: optionalHttpsUrl,
  /** `null` = la zona de la empresa. */
  timezone: z.string().trim().min(1).nullable(),
  cover_image_path: z.string().nullable(),
  header: branchHeaderSchema,
  own_availability: z.boolean(),
  own_catalog: z.boolean(),
  show_sponsors: z.boolean(),
});
export type BranchInput = z.input<typeof branchSchema>;
export type BranchValues = z.output<typeof branchSchema>;

// ---------------------------------------------------------------------------
// Acerca de y patrocinadores
// ---------------------------------------------------------------------------

export const aboutSchema = z.object({
  title: z.string().trim().max(120).default(''),
  body: z.string().trim().max(10_000, { error: 'Máximo 10.000 caracteres' }).default(''),
  image_path: z.string().nullable().default(null),
  is_visible: z.boolean().default(false),
});
export type AboutValues = z.output<typeof aboutSchema>;

export const sponsorSchema = z.object({
  name: z.string().trim().min(1, { error: 'Escribe el nombre' }).max(120),
  description: optionalText(300),
  url: optionalHttpsUrl,
  image_path: z.string().nullable(),
  is_visible: z.boolean(),
});
export type SponsorInput = z.input<typeof sponsorSchema>;
export type SponsorValues = z.output<typeof sponsorSchema>;

// ---------------------------------------------------------------------------
// Redes sociales
// ---------------------------------------------------------------------------

export const SOCIAL_NETWORKS = [
  'instagram',
  'facebook',
  'tiktok',
  'x',
  'youtube',
  'linkedin',
  'whatsapp',
  'website',
  'email',
  'phone',
  'other',
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  x: 'X (Twitter)',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  website: 'Sitio web',
  email: 'Correo',
  phone: 'Teléfono',
  other: 'Otro',
};

export const SOCIAL_PLACEHOLDERS: Record<SocialNetwork, string> = {
  instagram: '@tunegocio o https://instagram.com/tunegocio',
  facebook: 'https://facebook.com/tunegocio',
  tiktok: '@tunegocio',
  x: '@tunegocio',
  youtube: 'https://youtube.com/@tunegocio',
  linkedin: 'https://linkedin.com/company/tunegocio',
  whatsapp: '300 123 4567 o +57 300 123 4567',
  website: 'https://tunegocio.com',
  email: 'hola@tunegocio.com',
  phone: '+57 601 123 4567',
  other: 'https://…',
};

/** Redes donde un `@usuario` se convierte en URL de perfil. */
const HANDLE_BASE: Partial<Record<SocialNetwork, string>> = {
  instagram: 'https://instagram.com/',
  tiktok: 'https://www.tiktok.com/@',
  x: 'https://x.com/',
  youtube: 'https://youtube.com/@',
};

export type NormalizedUrl = { ok: true; url: string } | { ok: false; error: string };

/**
 * Convierte lo que escribe el usuario en una URL válida para `social_links.url`
 * (`https://`, `mailto:` o `tel:`). WhatsApp acepta un número: si tiene 10 dígitos se
 * asume el indicativo del país (`defaultCountryCode`, Colombia por defecto).
 */
export function normalizeSocialUrl(network: SocialNetwork, raw: string, defaultCountryCode = '57'): NormalizedUrl {
  const value = raw.trim();
  if (!value) return { ok: false, error: 'Escribe el enlace' };

  if (network === 'email') {
    const email = value.replace(/^mailto:/i, '');
    return emailSchema.safeParse(email).success
      ? { ok: true, url: `mailto:${email.toLowerCase()}` }
      : { ok: false, error: 'Correo no válido' };
  }

  if (network === 'phone') {
    const plus = value.replace(/^tel:/i, '').trim().startsWith('+');
    const digits = value.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return { ok: false, error: 'Teléfono no válido' };
    return { ok: true, url: `tel:${plus ? '+' : ''}${digits}` };
  }

  if (network === 'whatsapp') {
    if (/^https?:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//i.test(value)) {
      return { ok: true, url: value.replace(/^http:/i, 'https:') };
    }
    let digits = value.replace(/\D/g, '');
    if (!value.startsWith('+') && digits.length === 10) digits = defaultCountryCode + digits;
    if (digits.length < 8 || digits.length > 15) return { ok: false, error: 'Número de WhatsApp no válido' };
    return { ok: true, url: `https://wa.me/${digits}` };
  }

  const base = HANDLE_BASE[network];
  if (base && /^@[\w.-]{1,60}$/.test(value)) {
    return { ok: true, url: base + value.slice(1) };
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  if (!/^https?:\/\/[^\s/]+\.[^\s]+/i.test(withScheme)) return { ok: false, error: 'Escribe una URL válida' };
  return { ok: true, url: withScheme.replace(/^http:\/\//i, 'https://') };
}

/** Texto a mostrar de un enlace (sin esquema). */
export function displaySocialUrl(url: string): string {
  return url.replace(/^(https?:\/\/(www\.)?|mailto:|tel:)/i, '').replace(/\/$/, '');
}
