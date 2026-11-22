import { describe, expect, it } from 'vitest';
import { isValidSlug, normalizeHost, resolveTenant } from './tenant';

const prod = { rootDomain: 'roquintech.com', platformSubdomain: 'servigo' };
const local = { rootDomain: 'localhost', platformSubdomain: 'servigo' };
const qs = (s: string) => new URLSearchParams(s);

describe('isValidSlug', () => {
  it.each(['abc', 'mi-empresa', 'a1b', 'x'.repeat(32), '123'])('acepta %s', (s) => {
    expect(isValidSlug(s)).toBe(true);
  });

  it.each(['ab', 'x'.repeat(33), '-abc', 'abc-', 'a--b', 'xn--abc', 'ABC', 'a_b', 'a.b', 'ñandu', ''])(
    'rechaza %s',
    (s) => {
      expect(isValidSlug(s)).toBe(false);
    },
  );
});

describe('normalizeHost', () => {
  it('quita puerto, mayúsculas y punto final', () => {
    expect(normalizeHost('Demo.LocalHost:5273')).toBe('demo.localhost');
    expect(normalizeHost('demo.roquintech.com.')).toBe('demo.roquintech.com');
  });
});

describe('resolveTenant — producción (00 §4)', () => {
  it('servigo.roquintech.com → plataforma', () => {
    expect(resolveTenant('servigo.roquintech.com', prod)).toEqual({ type: 'platform' });
  });

  it('{slug}.roquintech.com → empresa', () => {
    expect(resolveTenant('demo.roquintech.com', prod)).toEqual({ type: 'company', slug: 'demo' });
    expect(resolveTenant('Spa-Luna.roquintech.com:443', prod)).toEqual({ type: 'company', slug: 'spa-luna' });
  });

  it('www → 301 a la web corporativa', () => {
    expect(resolveTenant('www.roquintech.com', prod)).toEqual({ type: 'redirect', to: 'https://roquintech.com' });
  });

  it('apex no es un tenant', () => {
    expect(resolveTenant('roquintech.com', prod)).toEqual({ type: 'not_found' });
  });

  it('subdominios de más de un nivel → not_found', () => {
    expect(resolveTenant('a.demo.roquintech.com', prod)).toEqual({ type: 'not_found' });
  });

  it('slug inválido → not_found', () => {
    expect(resolveTenant('ab.roquintech.com', prod)).toEqual({ type: 'not_found' });
    expect(resolveTenant('xn--abc.roquintech.com', prod)).toEqual({ type: 'not_found' });
  });

  it('dominio ajeno → not_found', () => {
    expect(resolveTenant('demo.otrodominio.com', prod)).toEqual({ type: 'not_found' });
    expect(resolveTenant('evilroquintech.com', prod)).toEqual({ type: 'not_found' });
  });

  it('?tenant= se ignora en producción', () => {
    expect(resolveTenant('servigo.roquintech.com', prod, qs('tenant=demo'))).toEqual({ type: 'platform' });
    expect(resolveTenant('otra.roquintech.com', prod, qs('tenant=demo'))).toEqual({ type: 'company', slug: 'otra' });
  });

  it('preview workers.dev: plataforma o ?tenant=', () => {
    expect(resolveTenant('servigo.cuenta.workers.dev', prod)).toEqual({ type: 'platform' });
    expect(resolveTenant('servigo.cuenta.workers.dev', prod, qs('tenant=demo'))).toEqual({
      type: 'company',
      slug: 'demo',
    });
  });
});

describe('resolveTenant — local', () => {
  it('localhost:5273 → plataforma', () => {
    expect(resolveTenant('localhost:5273', local)).toEqual({ type: 'platform' });
  });

  it('{slug}.localhost:5273 → empresa', () => {
    expect(resolveTenant('demo.localhost:5273', local)).toEqual({ type: 'company', slug: 'demo' });
  });

  it('servigo.localhost también es plataforma', () => {
    expect(resolveTenant('servigo.localhost:5273', local)).toEqual({ type: 'platform' });
  });

  it('localhost:5273/?tenant={slug} → empresa', () => {
    expect(resolveTenant('localhost:5273', local, qs('tenant=demo'))).toEqual({ type: 'company', slug: 'demo' });
    expect(resolveTenant('localhost:5273', local, qs('tenant=-mal'))).toEqual({ type: 'not_found' });
  });

  it('?tenant= vacío se ignora', () => {
    expect(resolveTenant('localhost:5273', local, qs('tenant='))).toEqual({ type: 'platform' });
  });

  it('www.localhost no redirige en local', () => {
    expect(resolveTenant('www.localhost:5273', local)).toEqual({ type: 'not_found' });
  });
});
