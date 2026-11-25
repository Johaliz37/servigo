import { describe, expect, it } from 'vitest';
import {
  aboutSchema,
  branchSchema,
  brandContrast,
  bookingSettingsSchema,
  companyProfileSchema,
  displaySocialUrl,
  footerSchema,
  formatBytes,
  mediaObjectPath,
  normalizeSocialUrl,
  parseBookingSettings,
  parseBranchHeader,
  parseFooter,
  sponsorSchema,
  thumbPath,
  validateImageFile,
} from './content';

describe('imágenes', () => {
  it('ruta única e inmutable por subida, y su miniatura', () => {
    const path = mediaObjectPath('c1', 'branches', 'u1', 'abcdef0123456789');
    expect(path).toBe('c1/branches/u1-abcdef012345.webp');
    expect(thumbPath(path)).toBe('c1/branches/u1-abcdef012345.thumb.webp');
  });

  it('valida tipo y tamaño antes de procesar', () => {
    expect(validateImageFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(validateImageFile({ type: 'image/gif', size: 1000 })).toMatch(/Formato/);
    expect(validateImageFile({ type: 'image/jpeg', size: 16 * 1024 * 1024 })).toMatch(/15 MB/);
  });

  it('formatea tamaños', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(300 * 1024)).toBe('300 KB');
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB');
  });
});

describe('redes sociales', () => {
  it('WhatsApp: número local → wa.me con indicativo', () => {
    expect(normalizeSocialUrl('whatsapp', '300 123 4567')).toEqual({ ok: true, url: 'https://wa.me/573001234567' });
    expect(normalizeSocialUrl('whatsapp', '+52 55 1234 5678')).toEqual({ ok: true, url: 'https://wa.me/525512345678' });
    expect(normalizeSocialUrl('whatsapp', 'https://wa.me/573001234567')).toEqual({
      ok: true,
      url: 'https://wa.me/573001234567',
    });
    expect(normalizeSocialUrl('whatsapp', '123').ok).toBe(false);
  });

  it('correo y teléfono', () => {
    expect(normalizeSocialUrl('email', 'Hola@Negocio.com')).toEqual({ ok: true, url: 'mailto:hola@negocio.com' });
    expect(normalizeSocialUrl('email', 'no-es-correo').ok).toBe(false);
    expect(normalizeSocialUrl('phone', '+57 (601) 123-4567')).toEqual({ ok: true, url: 'tel:+576011234567' });
  });

  it('@usuario y URLs sin esquema', () => {
    expect(normalizeSocialUrl('instagram', '@barberia.demo')).toEqual({
      ok: true,
      url: 'https://instagram.com/barberia.demo',
    });
    expect(normalizeSocialUrl('tiktok', '@demo')).toEqual({ ok: true, url: 'https://www.tiktok.com/@demo' });
    expect(normalizeSocialUrl('facebook', 'facebook.com/demo')).toEqual({ ok: true, url: 'https://facebook.com/demo' });
    expect(normalizeSocialUrl('website', 'http://demo.com')).toEqual({ ok: true, url: 'https://demo.com' });
    expect(normalizeSocialUrl('website', 'demo').ok).toBe(false);
    expect(normalizeSocialUrl('other', '')).toEqual({ ok: false, error: 'Escribe el enlace' });
  });

  it('texto visible sin esquema', () => {
    expect(displaySocialUrl('https://www.instagram.com/demo/')).toBe('instagram.com/demo');
    expect(displaySocialUrl('mailto:a@b.co')).toBe('a@b.co');
  });
});

describe('esquemas de contenido', () => {
  const profile = {
    name: ' Barbería ',
    legal_name: '',
    tax_id: '',
    contact_email: '',
    contact_phone: '',
    whatsapp: '+57 300 111 2233',
    timezone: 'America/Bogota',
    currency: 'cop',
    locale: 'es-CO',
    primary_color: '#1F4E79',
    secondary_color: null,
    logo_path: null,
    favicon_path: null,
    hero_image_path: null,
    seo: { title: '', description: '', image_path: null },
  };

  it('perfil: vacíos → null, moneda en mayúsculas', () => {
    const out = companyProfileSchema.parse(profile);
    expect(out.name).toBe('Barbería');
    expect(out.legal_name).toBeNull();
    expect(out.contact_email).toBeNull();
    expect(out.currency).toBe('COP');
  });

  it('perfil: rechaza color y correo inválidos', () => {
    expect(companyProfileSchema.safeParse({ ...profile, primary_color: 'azul' }).success).toBe(false);
    expect(companyProfileSchema.safeParse({ ...profile, contact_email: 'x@' }).success).toBe(false);
  });

  it('contraste AA del color primario', () => {
    expect(brandContrast('#1F4E79')?.passesAA).toBe(true);
    // Amarillo y naranja claros: el botón se lee (texto oscuro), pero sobre blanco casi no se ven.
    expect(brandContrast('#FFD84D')).toMatchObject({ passesAA: false });
    expect(brandContrast('#FFD84D')!.onButton).toBeGreaterThanOrEqual(4.5);
    expect(brandContrast('#FF8A3D')?.passesAA).toBe(false);
    expect(brandContrast(null)).toBeNull();
  });

  it('footer: completa claves faltantes y valida enlaces', () => {
    expect(parseFooter({ text: 'Hola' })).toEqual({
      text: 'Hola',
      address: '',
      links: [],
      show_socials: true,
      show_powered_by: true,
    });
    expect(parseFooter(null).links).toEqual([]);
    expect(footerSchema.safeParse({ links: [{ label: 'Políticas', url: '/politicas' }] }).success).toBe(true);
    expect(footerSchema.safeParse({ links: [{ label: 'Malo', url: 'javascript:alert(1)' }] }).success).toBe(false);
  });

  it('reservas: valores por defecto y paso válido', () => {
    expect(parseBookingSettings({}).slot_step_minutes).toBe(30);
    expect(bookingSettingsSchema.safeParse({ slot_step_minutes: 7 }).success).toBe(false);
    expect(bookingSettingsSchema.parse({ max_days_ahead: '90' }).max_days_ahead).toBe(90);
  });

  it('sede: slug, mapas y encabezado', () => {
    const base = {
      name: 'Centro',
      slug: 'centro',
      address: '',
      city: '',
      phone: '',
      whatsapp: '',
      email: '',
      maps_url: '',
      timezone: null,
      cover_image_path: null,
      header: { title: '', subtitle: '', image_path: null, overlay_opacity: 0.4 },
      own_availability: false,
      own_catalog: false,
      show_sponsors: true,
    };
    expect(branchSchema.parse(base).maps_url).toBeNull();
    expect(branchSchema.safeParse({ ...base, slug: 'Centro Norte' }).success).toBe(false);
    expect(branchSchema.safeParse({ ...base, maps_url: 'maps' }).success).toBe(false);
    expect(parseBranchHeader({ overlay_opacity: 2 }).overlay_opacity).toBe(0.4);
  });

  it('acerca de y patrocinadores', () => {
    expect(aboutSchema.parse({}).is_visible).toBe(false);
    expect(
      sponsorSchema.safeParse({ name: 'A', description: '', url: 'ftp://x', image_path: null, is_visible: true })
        .success,
    ).toBe(false);
  });
});
