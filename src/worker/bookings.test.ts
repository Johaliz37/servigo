import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompanyBySlugRow } from '@shared/tenant';
import { signBookingToken, verifyBookingToken } from './booking-token';
import app from './index';

// Fase 10: token HMAC y protecciones de /api/bookings (rate limit, Turnstile, validación,
// forma constante de la búsqueda). El flujo completo contra la BD lo cubre la E2E.

const SECRET = 'sb_secret_test';
const subject = { companyId: 'c1', code: 'K7M29QXA', phone: '+573001234567' };

describe('token de reserva', () => {
  it('firma y verifica; cambiar código, teléfono o empresa lo invalida', async () => {
    const token = await signBookingToken(SECRET, subject);
    expect(token).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/);
    expect(await verifyBookingToken(SECRET, subject, token)).toBe(true);
    expect(await verifyBookingToken(SECRET, { ...subject, code: 'K7M29QXB' }, token)).toBe(false);
    expect(await verifyBookingToken(SECRET, { ...subject, phone: '+573001234568' }, token)).toBe(false);
    expect(await verifyBookingToken(SECRET, { ...subject, companyId: 'c2' }, token)).toBe(false);
    expect(await verifyBookingToken('otra-clave', subject, token)).toBe(false);
  });

  it('vence a los 30 días y rechaza basura', async () => {
    const now = Date.parse('2026-11-25T00:00:00Z');
    const token = await signBookingToken(SECRET, subject, now);
    expect(await verifyBookingToken(SECRET, subject, token, now + 29 * 86_400_000)).toBe(true);
    expect(await verifyBookingToken(SECRET, subject, token, now + 31 * 86_400_000)).toBe(false);
    const [exp, sig] = token.split('.');
    expect(await verifyBookingToken(SECRET, subject, `${Number(exp) + 999}.${sig}`, now)).toBe(false);
    for (const bad of [null, '', 'abc', '123.', '123.!!!!!!!!!!!!!!!!!!!!!!!!']) {
      expect(await verifyBookingToken(SECRET, subject, bad, now)).toBe(false);
    }
  });
});

const demoRow: CompanyBySlugRow = {
  id: 'c1',
  slug: 'demo',
  name: 'Barbería Demo',
  status: 'active',
  timezone: 'America/Bogota',
  currency: 'COP',
  locale: 'es-CO',
  branding: { logo_path: null, favicon_path: null, primary_color: null, secondary_color: null },
  seo: {},
};

function makeEnv(limitOk = true) {
  return {
    ROOT_DOMAIN: 'localhost',
    PLATFORM_SUBDOMAIN: 'servigo',
    SUPABASE_URL: 'http://sb.test',
    SUPABASE_SECRET_KEY: SECRET,
    SUPABASE_PUBLISHABLE_KEY: 'pk',
    TURNSTILE_SECRET_KEY: 'ts',
    BOOKING_CREATE_LIMITER: { limit: vi.fn(async () => ({ success: limitOk })) },
    BOOKING_LOOKUP_LIMITER: { limit: vi.fn(async () => ({ success: limitOk })) },
    ASSETS: { fetch: () => Promise.resolve(new Response('')) },
  } as unknown as Env;
}

/** Supabase + Turnstile simulados. */
function mockUpstream(opts: { turnstile?: boolean; rpc?: Record<string, unknown> } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('turnstile')) return Response.json({ success: opts.turnstile ?? true });
      const fn = url.split('/rest/v1/rpc/')[1] ?? '';
      if (fn === 'get_company_by_slug') return Response.json(demoRow);
      calls.push(fn);
      void init;
      return Response.json(opts.rpc?.[fn] ?? null);
    }),
  );
  return calls;
}

const post = (env: Env, path: string, body: unknown) =>
  app.request(
    `http://demo.localhost:5273${path}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env,
  );

afterEach(() => vi.unstubAllGlobals());

const validBooking = {
  branch_slug: 'centro',
  service_id: '30000000-0000-4000-a000-000000000001',
  starts_at: '2026-12-01T14:00:00.000Z',
  customer: { name: 'Ana', phone: '+573001234567', email: '', notes: '' },
  turnstile: 'tok',
};

describe('/api/bookings', () => {
  it('rate limit → 429 sin tocar la BD', async () => {
    const calls = mockUpstream();
    const res = await post(makeEnv(false), '/api/bookings', validBooking);
    expect(res.status).toBe(429);
    expect(calls).toEqual([]);
  });

  it('Turnstile inválido → 403; cuerpo inválido → 400', async () => {
    const calls = mockUpstream({ turnstile: false });
    expect((await post(makeEnv(), '/api/bookings', validBooking)).status).toBe(403);
    expect(
      (await post(makeEnv(), '/api/bookings', { ...validBooking, customer: { name: '', phone: 'x' } })).status,
    ).toBe(400);
    expect(calls).toEqual([]);
  });

  it('servicio que ya no está en la sede → 404', async () => {
    mockUpstream({ rpc: { get_booking_form: null } });
    const res = await post(makeEnv(), '/api/bookings', validBooking);
    expect(res.status).toBe(404);
  });

  it('un inicio que no es un cupo del motor → 409 SLOT_TAKEN, sin llamar a create_booking', async () => {
    const calls = mockUpstream({
      rpc: {
        get_booking_form: {
          branch: { id: 'b1', slug: 'centro', name: 'Centro', timezone: 'America/Bogota' },
          service: { id: validBooking.service_id, price: 100, final_price: 100 },
          addons: [],
          fields: [],
          settings: { require_email: false, terms_text: '', auto_confirm: false },
        },
        get_slot_inputs: null,
      },
    });
    const res = await post(makeEnv(), '/api/bookings', validBooking);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('SLOT_TAKEN');
    expect(calls).not.toContain('create_booking');
  });

  it('respuestas que no cumplen los campos → 422 con el nombre del campo', async () => {
    mockUpstream({
      rpc: {
        get_booking_form: {
          branch: { id: 'b1', slug: 'centro', name: 'Centro', timezone: 'America/Bogota' },
          service: { id: validBooking.service_id },
          addons: [],
          fields: [
            {
              id: 'f1',
              service_id: null,
              label: 'Alergias',
              help_text: null,
              placeholder: null,
              type: 'text',
              options: [],
              required: true,
              validation: {},
              is_active: true,
              sort_order: 1,
            },
          ],
          settings: { require_email: false, terms_text: '', auto_confirm: false },
        },
      },
    });
    const res = await post(makeEnv(), '/api/bookings', validBooking);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toContain('«Alergias»');
  });
});

describe('/api/bookings/lookup', () => {
  it('misma forma con y sin resultados, y nunca devuelve el teléfono', async () => {
    mockUpstream({ rpc: { find_bookings: [] } });
    const empty = await post(makeEnv(), '/api/bookings/lookup', {
      mode: 'contact',
      contact: { phone: '+573001234567' },
      turnstile: 't',
    });
    expect(await empty.json()).toEqual({ results: [] });

    mockUpstream({
      rpc: {
        find_bookings: [
          {
            code: 'K7M29QXA',
            status: 'pending',
            starts_at: '2026-12-01T14:00:00Z',
            service_name: 'Corte',
            branch_name: 'Centro',
            timezone: 'America/Bogota',
            customer_name: 'An***',
            customer_phone: '+573001234567',
          },
        ],
      },
    });
    const started = Date.now();
    const found = await post(makeEnv(), '/api/bookings/lookup', {
      mode: 'contact',
      contact: { phone: '+573001234567' },
      turnstile: 't',
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(650);
    const body = (await found.json()) as { results: Record<string, unknown>[] };
    expect(Object.keys(body.results[0]!).sort()).toEqual(
      ['branch_name', 'code', 'customer_name', 'service_name', 'starts_at', 'status', 'timezone', 'token'].sort(),
    );
    expect(JSON.stringify(body)).not.toContain('+573001234567');
  });

  it('por código: si el contacto no coincide, no devuelve nada', async () => {
    mockUpstream({
      rpc: { get_booking_public: { code: 'K7M29QXA', customer_phone: '+573009999999', customer_email: null } },
    });
    const res = await post(makeEnv(), '/api/bookings/lookup', {
      mode: 'code',
      code: 'K7M2-9QXA',
      contact: { phone: '+573001234567' },
      turnstile: 't',
    });
    expect(await res.json()).toEqual({ results: [] });
  });
});

describe('GET /api/bookings/:code', () => {
  it('sin token válido → 404 (no revela si existe)', async () => {
    mockUpstream({ rpc: { get_booking_public: { code: 'K7M29QXA', customer_phone: '+573001234567' } } });
    const res = await app.request('http://demo.localhost:5273/api/bookings/K7M29QXA?t=1.abc', undefined, makeEnv());
    expect(res.status).toBe(404);
  });
});
