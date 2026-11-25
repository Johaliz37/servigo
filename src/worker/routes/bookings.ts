import { Hono } from 'hono';
import { computeSlots, dayStartInstant, localDate, toSlotQuery, DAY, type SlotInputs } from '@shared/availability';
import {
  bookingRequestSchema,
  canCustomerCancel,
  cancelSchema,
  lookupSchema,
  normalizeCode,
  BOOKING_CODE_REGEX,
  type BookingDetail,
  type BookingForm,
  type BookingSummary,
  type CreatedBooking,
} from '@shared/booking';
import {
  buildAnswersSchema,
  fieldsForService,
  toAnswerRows,
  toBookingField,
  type Answers,
} from '@shared/booking-fields';
import type { TenantCompany } from '@shared/tenant';
import { signBookingToken, verifyBookingToken } from '../booking-token';
import type { AppEnv } from '../env';
import { apiError, parseBody, type Ctx } from '../http';
import { bumpSlotsVersion } from '../public-cache';
import { rpcJson, UpstreamError } from '../supabase';

/**
 * `/api/bookings/*` (fase 10): crear, consultar y cancelar reservas sin cuenta. Toda escritura
 * pasa por rate limit + Turnstile y llega a la BD por RPC con la secret key (00 §3, regla 2).
 */
export const bookingRoutes = new Hono<AppEnv>();

bookingRoutes.use('*', async (c, next) => {
  if (!c.get('company')) return apiError(c, 404, 'not_found', 'Solo disponible en el sitio de una empresa');
  return next();
});

const clientIp = (c: Ctx) => c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'local';

async function limited(binding: RateLimit | undefined, key: string): Promise<boolean> {
  if (!binding) return false;
  const { success } = await binding.limit({ key });
  return !success;
}

const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Verifica el token de Turnstile con Cloudflare (gratis). */
async function turnstileOk(c: Ctx, token: string): Promise<boolean> {
  const body = new FormData();
  body.append('secret', c.env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  const ip = c.req.header('cf-connecting-ip');
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch(TURNSTILE_URL, { method: 'POST', body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

const turnstileFailed = (c: Ctx) =>
  apiError(
    c,
    403,
    'turnstile_failed',
    'No pudimos verificar que eres una persona. Recarga la página e intenta de nuevo.',
  );
const tooMany = (c: Ctx) =>
  apiError(c, 429, 'rate_limited', 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.');

/** Errores de PostgREST con nuestros códigos de `create_booking` y compañía. */
interface RpcErrorBody {
  code?: string;
  message?: string;
}

async function rpc<T>(
  env: Env,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: T | null; error: RpcErrorBody | null }> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SECRET_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (res.ok) return { data: (await res.json()) as T | null, error: null };
  if (res.status >= 500) throw new UpstreamError(`${fn} ${res.status}`);
  return { data: null, error: (await res.json().catch(() => ({}))) as RpcErrorBody };
}

// ---------------------------------------------------------------------------
// Crear
// ---------------------------------------------------------------------------

bookingRoutes.post('/', async (c) => {
  const company = c.get('company')!;
  if (await limited(c.env.BOOKING_CREATE_LIMITER, `create:${clientIp(c)}`)) return tooMany(c);

  const parsed = await parseBody(c, bookingRequestSchema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;
  if (!(await turnstileOk(c, body.turnstile))) return turnstileFailed(c);

  // Formulario real del servicio en la sede (sin caché: precios, campos y stock al día).
  const form = await rpcJson<BookingForm>(c.env, 'get_booking_form', {
    p_slug: company.slug,
    p_branch_slug: body.branch_slug,
    p_service_id: body.service_id,
  });
  if (!form) return apiError(c, 404, 'unavailable', 'Este servicio ya no está disponible en la sede');

  // Datos y respuestas con las mismas reglas que el asistente (D25).
  if (form.settings.require_email && !body.customer.email) {
    return apiError(c, 422, 'invalid_body', 'Escribe tu correo');
  }
  if (form.settings.terms_text.trim() && !body.accept_terms) {
    return apiError(c, 422, 'invalid_body', 'Debes aceptar los términos');
  }
  const fields = fieldsForService(form.fields.map(toBookingField), body.service_id);
  const answers = buildAnswersSchema(fields).safeParse(body.answers);
  if (!answers.success) {
    const issue = answers.error.issues[0];
    const field = fields.find((f) => f.id === issue?.path[0]);
    return apiError(
      c,
      422,
      'invalid_answers',
      `${field ? `«${field.label}»: ` : ''}${issue?.message ?? 'Respuesta no válida'}`,
    );
  }
  for (const item of body.items) {
    const addon = form.addons.find((a) => a.id === item.product_id);
    if (!addon || item.quantity > addon.max_quantity) {
      return apiError(c, 422, 'invalid_items', 'Uno de los productos ya no está disponible en esa cantidad');
    }
  }

  // El inicio debe ser un cupo del motor, calculado sin caché (D26): ventana, antelación,
  // días máximos y capacidad. La BD revalida la capacidad de forma atómica.
  const start = new Date(body.starts_at);
  const tz = form.branch.timezone;
  const day = localDate(start.getTime(), tz);
  const inputs = await rpcJson<SlotInputs>(c.env, 'get_slot_inputs', {
    p_branch: form.branch.id,
    p_service: body.service_id,
    p_from: new Date(dayStartInstant(day, tz) - DAY).toISOString(),
    p_to: new Date(dayStartInstant(day, tz) + 2 * DAY).toISOString(),
  });
  const slot = inputs
    ? computeSlots(
        toSlotQuery(
          inputs,
          { from: new Date(dayStartInstant(day, tz)), to: new Date(dayStartInstant(day, tz) + DAY + 2 * 3_600_000) },
          new Date(),
        ),
      )
        .flatMap((d) => d.slots)
        .find((s) => s.start === start.toISOString())
    : undefined;
  if (!slot) return slotTaken(c);

  const { data, error } = await rpc<{ code: string; status: CreatedBooking['status']; phone: string }>(
    c.env,
    'create_booking',
    {
      p_payload: {
        company_id: company.id,
        branch_id: form.branch.id,
        service_id: body.service_id,
        starts_at: start.toISOString(),
        capacity: slot.capacity,
        customer: body.customer,
        items: body.items,
        answers: toAnswerRows(fields, answers.data as Answers).map((a) => ({ field_id: a.field_id, value: a.value })),
      },
    },
  );
  if (error || !data) return bookingError(c, error);
  await bumpSlotsVersion(company.id, form.branch.id, body.service_id);

  const token = await signBookingToken(c.env.SUPABASE_SECRET_KEY, {
    companyId: company.id,
    code: data.code,
    phone: data.phone,
  });
  return c.json({ code: data.code, status: data.status, token } satisfies CreatedBooking, 201);
});

const slotTaken = (c: Ctx) =>
  apiError(c, 409, 'SLOT_TAKEN', 'Ese horario se acaba de ocupar. Elige otro, tus datos siguen guardados.');

function bookingError(c: Ctx, error: RpcErrorBody | null) {
  switch (error?.code) {
    case 'SV001':
      return slotTaken(c);
    case 'SV002':
    case 'SV003':
      return apiError(
        c,
        422,
        error.code === 'SV002' ? 'invalid_items' : 'invalid_answers',
        error.message ?? 'Datos no válidos',
      );
    case 'SV004':
      return apiError(c, 404, 'unavailable', error.message ?? 'No disponible');
    case 'SV005':
      return apiError(c, 422, 'cannot_cancel', error.message ?? 'No se puede cancelar');
    default:
      console.error(JSON.stringify({ msg: 'booking_rpc_failed', code: error?.code, message: error?.message }));
      return apiError(c, 500, 'db_error', 'No pudimos guardar la reserva. Intenta de nuevo.');
  }
}

// ---------------------------------------------------------------------------
// Consultar
// ---------------------------------------------------------------------------

type RawDetail = Omit<BookingDetail, 'can_cancel' | 'cancel_limit_hours' | 'token'> & {
  customer_phone: string;
  customer_email: string | null;
  branch_id: string;
  cancel: { allowed: boolean; limit_hours: number };
};

const loadDetail = (env: Env, company: TenantCompany, code: string) =>
  rpcJson<RawDetail>(env, 'get_booking_public', { p_company: company.id, p_code: code });

/** Detalle para el navegador: sin teléfono ni correo completos, con token fresco. */
async function publicDetail(env: Env, company: TenantCompany, raw: RawDetail): Promise<BookingDetail> {
  const { customer_phone, cancel, ...rest } = raw;
  delete (rest as Partial<RawDetail>).customer_email;
  delete (rest as Partial<RawDetail>).branch_id;
  return {
    ...rest,
    can_cancel: canCustomerCancel(raw, cancel, new Date()),
    cancel_limit_hours: cancel.limit_hours,
    token: await signBookingToken(env.SUPABASE_SECRET_KEY, {
      companyId: company.id,
      code: raw.code,
      phone: customer_phone,
    }),
  };
}

const notFoundBooking = (c: Ctx) =>
  apiError(c, 404, 'not_found', 'No encontramos la reserva. Búscala con tu teléfono o correo.');

/** Detalle con el token de `/reserva/:code?t=`. */
bookingRoutes.get('/:code', async (c) => {
  const company = c.get('company')!;
  const code = normalizeCode(c.req.param('code'));
  if (!BOOKING_CODE_REGEX.test(code)) return notFoundBooking(c);
  const raw = await loadDetail(c.env, company, code);
  const ok =
    raw &&
    (await verifyBookingToken(
      c.env.SUPABASE_SECRET_KEY,
      { companyId: company.id, code, phone: raw.customer_phone },
      c.req.query('t'),
    ));
  if (!raw || !ok) return notFoundBooking(c);
  return c.json(await publicDetail(c.env, company, raw), 200, { 'cache-control': 'no-store' });
});

/** Tiempo mínimo de respuesta de la búsqueda: con o sin resultados tarda lo mismo. */
const LOOKUP_MIN_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sameContact = (raw: RawDetail, contact: { phone: string } | { email: string }) =>
  'phone' in contact
    ? raw.customer_phone === contact.phone
    : !!raw.customer_email && raw.customer_email.toLowerCase() === contact.email.toLowerCase();

bookingRoutes.post('/lookup', async (c) => {
  const company = c.get('company')!;
  const started = Date.now();
  if (await limited(c.env.BOOKING_LOOKUP_LIMITER, `lookup:${clientIp(c)}`)) return tooMany(c);
  const parsed = await parseBody(c, lookupSchema);
  if ('response' in parsed) return parsed.response;
  const body = parsed.data;
  if (!(await turnstileOk(c, body.turnstile))) return turnstileFailed(c);

  let results: BookingSummary[] = [];
  if (body.mode === 'code') {
    const raw = await loadDetail(c.env, company, body.code);
    if (raw && sameContact(raw, body.contact)) {
      const detail = await publicDetail(c.env, company, raw);
      results = [
        {
          code: raw.code,
          status: raw.status,
          starts_at: raw.starts_at,
          service_name: raw.service_name,
          branch_name: raw.branch.name,
          timezone: raw.branch.timezone,
          customer_name: raw.customer_name,
          token: detail.token,
        },
      ];
    }
  } else {
    const list =
      (await rpcJson<(Omit<BookingSummary, 'token'> & { customer_phone: string })[]>(c.env, 'find_bookings', {
        p_company: company.id,
        p_phone: 'phone' in body.contact ? body.contact.phone : null,
        p_email: 'email' in body.contact ? body.contact.email : null,
      })) ?? [];
    results = await Promise.all(
      list.map(async ({ customer_phone, ...row }) => ({
        ...row,
        token: await signBookingToken(c.env.SUPABASE_SECRET_KEY, {
          companyId: company.id,
          code: row.code,
          phone: customer_phone,
        }),
      })),
    );
  }

  // Misma forma y (casi) el mismo tiempo haya o no resultados: no revela qué datos existen.
  const wait = LOOKUP_MIN_MS - (Date.now() - started);
  if (wait > 0) await sleep(wait);
  return c.json({ results }, 200, { 'cache-control': 'no-store' });
});

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

bookingRoutes.post('/:code/cancel', async (c) => {
  const company = c.get('company')!;
  if (await limited(c.env.BOOKING_LOOKUP_LIMITER, `cancel:${clientIp(c)}`)) return tooMany(c);
  const code = normalizeCode(c.req.param('code'));
  const parsed = await parseBody(c, cancelSchema);
  if ('response' in parsed) return parsed.response;
  if (!(await turnstileOk(c, parsed.data.turnstile))) return turnstileFailed(c);
  if (!BOOKING_CODE_REGEX.test(code)) return notFoundBooking(c);

  const raw = await loadDetail(c.env, company, code);
  const ok =
    raw &&
    (await verifyBookingToken(
      c.env.SUPABASE_SECRET_KEY,
      { companyId: company.id, code, phone: raw.customer_phone },
      parsed.data.token,
    ));
  if (!raw || !ok) return notFoundBooking(c);

  const { error } = await rpc(c.env, 'cancel_booking_public', { p_company: company.id, p_code: code });
  if (error) return bookingError(c, error);
  await bumpSlotsVersion(company.id, raw.branch_id, raw.service_id);
  const fresh = await loadDetail(c.env, company, code);
  return c.json(await publicDetail(c.env, company, fresh ?? raw), 200, { 'cache-control': 'no-store' });
});
