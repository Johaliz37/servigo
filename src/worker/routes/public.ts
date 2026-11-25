import { Hono } from 'hono';
import { z } from 'zod';
import { computeSlots, dayStartInstant, DAY, MAX_RANGE_DAYS, toSlotQuery, type SlotInputs } from '@shared/availability';
import { BRANCH_SLUG_REGEX } from '@shared/content';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { apiError, dbError, type Ctx } from '../http';
import { PUBLIC_CACHE_CONTROL, publicReads, type PublicRead } from '../public-cache';
import { adminClient, UpstreamError } from '../supabase';
import { edgeCache } from '../tenant';

/** `/api/public/*`: lecturas públicas del sitio de una empresa (00 §3, regla 1). */
export const publicRoutes = new Hono<AppEnv>();

const SLOTS_TTL_SECONDS = 30;

const requireCompany = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('company')) return apiError(c, 404, 'not_found', 'Solo disponible en el sitio de una empresa');
  return next();
});

const slotsQuery = z
  .object({ branch: z.uuid(), service: z.uuid(), from: z.iso.date(), to: z.iso.date() })
  .refine((q) => q.from <= q.to, { message: '«to» debe ser igual o posterior a «from»' })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / DAY < MAX_RANGE_DAYS, {
    message: `El rango es de máximo ${MAX_RANGE_DAYS} días`,
  });

const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);

/**
 * Horarios reservables de un servicio en una sede, por día local (`from` y `to` inclusive,
 * 'YYYY-MM-DD' en la zona de la sede). Lee los datos con `get_slot_inputs`, ejecuta el motor
 * compartido y cachea 30 s por sede, servicio y rango.
 */
publicRoutes.get('/slots', async (c) => {
  const company = c.get('company');
  if (!company) return apiError(c, 404, 'not_found', 'Solo disponible en el sitio de una empresa');
  const parsed = slotsQuery.safeParse(c.req.query());
  if (!parsed.success)
    return apiError(c, 400, 'invalid_query', parsed.error.issues[0]?.message ?? 'Consulta no válida');
  const { branch, service, from, to } = parsed.data;

  const cache = edgeCache();
  const key = new Request(`https://slots-cache.servigo.internal/${company.id}/${branch}/${service}/${from}/${to}`);
  const hit = await cache?.match(key);
  if (hit) return new Response(hit.body, hit);

  // Margen de un día a cada lado: la zona de la sede se conoce después de la consulta.
  const { data, error } = await adminClient(c.env).rpc('get_slot_inputs', {
    p_branch: branch,
    p_service: service,
    p_from: `${addDays(from, -1)}T00:00:00Z`,
    p_to: `${addDays(to, 2)}T00:00:00Z`,
  });
  if (error) return dbError(c, error);
  const inputs = data as unknown as SlotInputs | null;
  if (!inputs || inputs.company_id !== company.id) {
    return apiError(c, 404, 'not_found', 'La sede o el servicio no están disponibles');
  }

  const range = {
    from: new Date(dayStartInstant(from, inputs.timezone)),
    to: new Date(dayStartInstant(addDays(to, 1), inputs.timezone)),
  };
  const days = computeSlots(toSlotQuery(inputs, range, new Date()));
  const res = c.json({ timezone: inputs.timezone, days }, 200, {
    'cache-control': `public, max-age=${SLOTS_TTL_SECONDS}`,
  });
  await cache?.put(key, res.clone());
  return res;
});

// ---------------------------------------------------------------------------
// Sitio público (fase 09 §2): una RPC por página, cacheada 60 s por empresa.
// ---------------------------------------------------------------------------

const branchSlugParam = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.string().regex(BRANCH_SLUG_REGEX));

/** Responde una lectura pública: 200 con el JSON o 404 si la RPC devolvió null. */
async function sendPublic(c: Ctx, read: () => Promise<PublicRead<unknown>>, missing: string) {
  let result: PublicRead<unknown>;
  try {
    result = await read();
  } catch (err) {
    if (!(err instanceof UpstreamError) && !(err instanceof TypeError)) throw err;
    console.error(JSON.stringify({ msg: 'public_read_failed', error: String(err) }));
    return apiError(c, 503, 'unavailable', 'Servicio no disponible');
  }
  if (result.data === null) return apiError(c, 404, 'not_found', missing);
  return c.body(result.body, 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': PUBLIC_CACHE_CONTROL,
  });
}

publicRoutes.use('/site', requireCompany);
publicRoutes.use('/branch/*', requireCompany);
publicRoutes.use('/item/*', requireCompany);
publicRoutes.use('/about', requireCompany);

publicRoutes.get('/site', (c) =>
  sendPublic(c, () => publicReads.site(c.env, c.get('company')!), 'Esta empresa no existe'),
);

publicRoutes.get('/branch/:branchSlug', (c) => {
  const slug = branchSlugParam.safeParse(c.req.param('branchSlug'));
  if (!slug.success) return apiError(c, 404, 'not_found', 'Esta sede no existe');
  return sendPublic(c, () => publicReads.branch(c.env, c.get('company')!, slug.data), 'Esta sede no existe');
});

publicRoutes.get('/item/:branchSlug/:id', (c) => {
  const slug = branchSlugParam.safeParse(c.req.param('branchSlug'));
  const id = z.uuid().safeParse(c.req.param('id').toLowerCase());
  if (!slug.success || !id.success) return apiError(c, 404, 'not_found', 'Este servicio o producto no existe');
  return sendPublic(
    c,
    () => publicReads.item(c.env, c.get('company')!, slug.data, id.data),
    'Este servicio o producto no existe',
  );
});

publicRoutes.get('/about', (c) => {
  const raw = c.req.query('branch');
  const slug = raw ? branchSlugParam.safeParse(raw) : null;
  if (slug && !slug.success) return apiError(c, 404, 'not_found', 'Esta sede no existe');
  return sendPublic(c, () => publicReads.about(c.env, c.get('company')!, slug?.data ?? null), 'Esta empresa no existe');
});
