import { describe, expect, it } from 'vitest';
import { effectivePrice } from './pricing';
import {
  aboutPath,
  bookingPath,
  discountDeadline,
  discountOff,
  formatDuration,
  itemPath,
  mapsUrl,
  matchPublicRoute,
  plainExcerpt,
  robotsTxt,
  sitemapXml,
  telUrl,
  whatsappUrl,
  type PublicItem,
} from './public-site';

const ID = '30000000-0000-4000-a000-000000000001';

describe('rutas públicas', () => {
  it('arma rutas de sede, ficha, reserva y «Acerca de»', () => {
    expect(itemPath('centro', { id: ID, kind: 'service' })).toBe(`/s/centro/servicios/${ID}`);
    expect(itemPath('centro', { id: ID, kind: 'product' })).toBe(`/s/centro/productos/${ID}`);
    expect(bookingPath('centro')).toBe('/s/centro/reservar');
    expect(bookingPath('centro', ID)).toBe(`/s/centro/reservar/${ID}`);
    expect(aboutPath()).toBe('/acerca');
    expect(aboutPath('norte')).toBe('/acerca#sede-norte');
  });

  it('reconoce las rutas con meta propios', () => {
    expect(matchPublicRoute(`/s/Centro/servicios/${ID.toUpperCase()}`)).toEqual({
      type: 'item',
      branchSlug: 'centro',
      kind: 'service',
      id: ID,
    });
    expect(matchPublicRoute('/s/norte/')).toEqual({ type: 'branch', branchSlug: 'norte' });
    expect(matchPublicRoute('/s/norte/servicios/123')).toBeNull();
    expect(matchPublicRoute('/s/norte/reservar')).toBeNull();
    expect(matchPublicRoute('/acerca')).toBeNull();
    expect(matchPublicRoute('/s/%E0%A4%A/')).toEqual({ type: 'branch', branchSlug: '%e0%a4%a' });
  });
});

describe('textos del sitio', () => {
  it('formatea la duración', () => {
    expect(formatDuration(30)).toBe('30 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(90)).toBe('1 h 30 min');
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });

  it('fecha límite del descuento en la zona de la empresa', () => {
    // 1 dic 03:00 UTC = 30 nov 22:00 en Bogotá.
    expect(discountDeadline({ ends_at: '2026-12-01T03:00:00Z' }, 'America/Bogota')).toBe('Hasta el 30 nov');
  });

  it('badge del descuento: porcentaje o ahorro', () => {
    const money = (n: number) => `$${n}`;
    const base = { label: null, amount: 5000, ends_at: '2026-12-01T00:00:00Z' };
    expect(discountOff({ ...base, type: 'percent', value: 12.5 }, money)).toBe('−12,5 %');
    expect(discountOff({ ...base, type: 'fixed', value: 5000 }, money)).toBe('−$5000');
  });

  it('el precio que llega de la RPC es el mismo que calcula pricing.ts (D24)', () => {
    // Forma de get_public_branch para un ítem de 35.000 con 15 % (redondeo COP sin decimales).
    const fromRpc: Pick<PublicItem, 'price' | 'final_price'> = { price: 35000, final_price: 29750 };
    const local = effectivePrice(
      { price: 35000 },
      {
        currency: 'COP',
        discount: {
          id: 'd',
          label: '',
          type: 'percent',
          value: 15,
          starts_at: null,
          ends_at: '2099-01-01',
          branch_id: null,
          is_active: true,
        },
      },
    );
    expect({ price: local.base, final_price: local.final }).toEqual(fromRpc);
  });

  it('enlaces de contacto y mapa', () => {
    expect(whatsappUrl('+57 300 111 2233', 'Hola')).toBe('https://wa.me/573001112233?text=Hola');
    expect(whatsappUrl('123')).toBeNull();
    expect(whatsappUrl(null)).toBeNull();
    expect(telUrl('+57 (601) 123-4567')).toBe('tel:+576011234567');
    expect(telUrl('12')).toBeNull();
    expect(mapsUrl({ maps_url: 'https://maps.app.goo.gl/x', address: 'A', city: 'B' })).toBe(
      'https://maps.app.goo.gl/x',
    );
    expect(mapsUrl({ maps_url: null, address: 'Calle 10 # 20', city: 'Bogotá' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Calle%2010%20%23%2020%2C%20Bogot%C3%A1',
    );
    expect(mapsUrl({ maps_url: null, address: null, city: null })).toBeNull();
  });

  it('resumen de Markdown para la meta descripción', () => {
    expect(plainExcerpt('## Hola\n\nCorte **clásico** con [toalla](https://x.com) caliente.')).toBe(
      'Hola Corte clásico con toalla caliente.',
    );
    expect(plainExcerpt('a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(plainExcerpt(null)).toBe('');
  });
});

describe('robots y sitemap', () => {
  it('robots.txt por tipo de sitio', () => {
    expect(robotsTxt('https://demo.roquintech.com', true)).toBe(
      'User-agent: *\nDisallow: /admin\nDisallow: /reserva/\nDisallow: /mis-reservas\nDisallow: /api/\nAllow: /\n\nSitemap: https://demo.roquintech.com/sitemap.xml\n',
    );
    expect(robotsTxt('https://servigo.roquintech.com', false)).toBe(
      'User-agent: *\nDisallow: /console\nDisallow: /api/\nAllow: /\n',
    );
  });

  it('sitemap con «Acerca de» visible y caracteres escapados', () => {
    const xml = sitemapXml('https://demo.roquintech.com', {
      about_visible: true,
      branches: [{ slug: 'centro', items: [{ id: ID, kind: 'product' }] }],
    });
    expect(xml).toContain('<loc>https://demo.roquintech.com/acerca</loc>');
    expect(xml).toContain(`<loc>https://demo.roquintech.com/s/centro/productos/${ID}</loc>`);
    expect(sitemapXml('https://x.test/?a=1&b', { about_visible: false, branches: [] })).toContain('&amp;b');
  });
});
