import { Hono } from 'hono';
import { z } from 'zod';
import { computeSlots, dayStartInstant, DAY, MAX_RANGE_DAYS, toSlotQuery, type SlotInputs } from '@shared/availability';
import type { AppEnv } from '../env';
import { apiError, dbError } from '../http';
import { adminClient } from '../supabase';
import { edgeCache } from '../tenant';

/** `/api/public/*`: lecturas públicas del sitio de una empresa (00 §3, regla 1). */
export const publicRoutes = new Hono<AppEnv>();

const SLOTS_TTL_SECONDS = 30;

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
