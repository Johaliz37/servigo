import { describe, expect, it } from 'vitest';
import { brandCssVariables, contrastRatio, hexToOklch, readableForeground } from './color';
import { errorMessage, GENERIC_ERROR } from './errors';
import { formatInTimeZone, formatMoney, slugify } from './format';
import { assignableRoles, can } from './permissions';
import { createCompanySchema, inviteMemberSchema, newPasswordSchema } from './schemas';
import { companyOrigin, mediaUrl, toTenantCompany } from './tenant';

describe('color', () => {
  it('convierte hex a OKLCH (valores de referencia)', () => {
    expect(hexToOklch('#ffffff')).toMatchObject({ c: 0, h: 0 });
    expect(hexToOklch('#ffffff')?.l).toBeCloseTo(1, 3);
    expect(hexToOklch('#000000')?.l).toBeCloseTo(0, 3);
    // #ff0000 ≈ oklch(0.628 0.2577 29.23)
    const red = hexToOklch('#ff0000');
    expect(red?.l).toBeCloseTo(0.628, 2);
    expect(red?.c).toBeCloseTo(0.2577, 2);
    expect(red?.h).toBeCloseTo(29.23, 0);
    expect(hexToOklch('nope')).toBeNull();
  });

  it('calcula contraste WCAG', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('elige texto legible (AA) sobre colores claros y oscuros', () => {
    for (const bg of ['#1F4E79', '#6B4E9B', '#F2A93B', '#E8D5F2', '#ffff00', '#000080', '#777777']) {
      const fg = readableForeground(bg);
      expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(4.4);
    }
    expect(readableForeground('#1F4E79')).toBe('#ffffff');
    expect(readableForeground('#F2A93B')).toBe('#0a0a0a');
  });

  it('genera variables de shadcn y omite colores inválidos', () => {
    const vars = brandCssVariables('#1F4E79', '#F2A93B');
    expect(vars['--primary']).toMatch(/^oklch\(/);
    expect(vars['--ring']).toBe(vars['--primary']);
    expect(vars['--secondary']).toMatch(/^oklch\(/);
    expect(brandCssVariables(null, 'mal')).toEqual({});
  });
});

describe('errors', () => {
  it('traduce errores de Auth y Postgres', () => {
    expect(errorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      'Correo o contraseña incorrectos.',
    );
    expect(errorMessage({ code: '42501', message: 'permission denied' })).toBe('No tienes permiso para hacer esto.');
    expect(errorMessage({ code: 'P0001', message: 'El slug "x" ya está en uso' })).toBe('El slug "x" ya está en uso');
    expect(errorMessage({ code: '23514', message: 'El slug "api" está reservado' })).toBe(
      'El slug "api" está reservado',
    );
    expect(errorMessage({ code: '23514', message: 'new row violates check constraint "x"' })).toBe(
      'Algún dato no es válido.',
    );
    expect(errorMessage({ status: 429 })).toMatch(/Demasiados intentos/);
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/conexión/);
    expect(errorMessage({ message: 'boom' })).toBe(GENERIC_ERROR);
    expect(errorMessage(null)).toBe(GENERIC_ERROR);
  });
});

describe('permissions', () => {
  it('aplica la matriz de roles', () => {
    expect(can('owner', 'members.manage_admins')).toBe(true);
    expect(can('admin', 'members.manage_admins')).toBe(false);
    expect(can('admin', 'members.manage_staff')).toBe(true);
    expect(can('staff', 'members.view')).toBe(false);
    expect(can('staff', 'bookings.manage')).toBe(true);
    expect(can('staff', 'catalog.edit')).toBe(false);
    expect(can('platform_admin', 'company.edit')).toBe(true);
    expect(can(null, 'dashboard.view')).toBe(false);
  });

  it('limita los roles asignables', () => {
    expect(assignableRoles('owner')).toEqual(['owner', 'admin', 'staff']);
    expect(assignableRoles('admin')).toEqual(['staff']);
    expect(assignableRoles('staff')).toEqual([]);
  });
});

describe('format', () => {
  it('formatea dinero sin decimales en COP', () => {
    expect(formatMoney(45000, 'COP', 'es-CO').replace(/\s/g, ' ')).toBe('$ 45.000');
    expect(formatMoney(12.5, 'USD', 'en-US')).toBe('$12.50');
  });

  it('muestra la hora en la zona de la sede, no la del sistema', () => {
    const utc = '2026-11-23T15:30:00Z';
    expect(formatInTimeZone(utc, 'America/Bogota', 'yyyy-MM-dd HH:mm')).toBe('2026-11-23 10:30');
    expect(formatInTimeZone(utc, 'Europe/Madrid', 'yyyy-MM-dd HH:mm')).toBe('2026-11-23 16:30');
    expect(formatInTimeZone(utc, 'America/Bogota', 'EEEE d MMMM')).toBe('lunes 23 noviembre');
  });

  it('sugiere slugs válidos', () => {
    expect(slugify('Barbería El Corte')).toBe('barberia-el-corte');
    expect(slugify('  --Spa & Luna--  ')).toBe('spa-luna');
    expect(slugify('Ñandú Peluquería Unisex de Bogotá Norte Sur')).toBe('nandu-peluqueria-unisex-de-bogot');
    expect(slugify('a'.repeat(31) + '-b')).toBe('a'.repeat(31));
  });
});

describe('schemas', () => {
  it('normaliza la invitación', () => {
    const v = inviteMemberSchema.parse({ email: '  Ana@Demo.CO ', role: 'staff' });
    expect(v).toEqual({ email: 'ana@demo.co', role: 'staff', branchIds: null });
    expect(inviteMemberSchema.safeParse({ email: 'x', role: 'staff' }).success).toBe(false);
    expect(inviteMemberSchema.safeParse({ email: 'a@b.co', role: 'root' }).success).toBe(false);
  });

  it('valida el alta de empresa con los mismos slugs que Postgres', () => {
    const ok = createCompanySchema.parse({
      name: ' Barbería ',
      slug: 'barberia',
      ownerEmail: 'O@x.co',
      currency: 'cop',
    });
    expect(ok).toMatchObject({ name: 'Barbería', ownerEmail: 'o@x.co', currency: 'COP', timezone: 'America/Bogota' });
    for (const slug of ['ab', 'a--b', '-ab', 'ab-', 'Mayus', 'a'.repeat(33)]) {
      expect(createCompanySchema.safeParse({ name: 'x', slug, ownerEmail: 'o@x.co' }).success).toBe(false);
    }
  });

  it('exige contraseñas iguales y de 8+ caracteres', () => {
    expect(newPasswordSchema.safeParse({ password: '12345678', confirm: '12345678' }).success).toBe(true);
    expect(newPasswordSchema.safeParse({ password: '1234567', confirm: '1234567' }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: '12345678', confirm: '12345679' }).success).toBe(false);
  });
});

describe('tenant helpers', () => {
  it('construye URLs públicas de media', () => {
    expect(mediaUrl('http://127.0.0.1:54421/', 'abc/logo v1.webp')).toBe(
      'http://127.0.0.1:54421/storage/v1/object/public/media/abc/logo%20v1.webp',
    );
    expect(mediaUrl('http://x', null)).toBeNull();
    expect(mediaUrl('http://x', 'https://cdn/x.png')).toBe('https://cdn/x.png');
  });

  it('calcula el origen de una empresa desde la plataforma', () => {
    expect(companyOrigin('http://localhost:5273/api/x', 'localhost', 'demo')).toBe('http://demo.localhost:5273');
    expect(companyOrigin('https://servigo.roquintech.com/api/x', 'roquintech.com', 'spa')).toBe(
      'https://spa.roquintech.com',
    );
  });

  it('mapea la fila de get_company_by_slug', () => {
    const c = toTenantCompany(
      {
        id: '1',
        slug: 'demo',
        name: 'Demo',
        status: 'active',
        timezone: 'America/Bogota',
        currency: 'COP',
        locale: 'es-CO',
        branding: { logo_path: '1/logo.webp', favicon_path: null, primary_color: '#000000', secondary_color: null },
        seo: null,
      },
      'http://sb',
    );
    expect(c.logoUrl).toBe('http://sb/storage/v1/object/public/media/1/logo.webp');
    expect(c.seo).toEqual({});
    expect(c.primaryColor).toBe('#000000');
  });
});
