/**
 * Observabilidad (fase 13 §5): una línea JSON por petición en Workers Logs y errores del
 * navegador en `POST /api/client-errors`. Sin datos personales: nada de cuerpos, consultas,
 * IPs ni cabeceras; los mensajes se limpian de correos, teléfonos, tokens y códigos.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { AppEnv } from './env';

/** Quita lo que pueda identificar a alguien de un texto libre (mensajes y pilas de error). */
export function scrub(text: string, max = 500): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[num]')
    .replace(/([?&#][^\s'")]*)/g, '') // consultas y hashes de URL (tokens `?t=`, `#access_token`)
    .replace(/\/reserva\/[0-9A-Za-z-]{8,9}/g, '/reserva/[code]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .slice(0, max);
}

/** Ruta sin datos: el patrón de Hono para la API y el primer segmento para páginas. */
export function routeLabel(routePath: string, path: string): string {
  if (routePath && routePath !== '*' && routePath !== '/*' && routePath !== '/api/*') return routePath;
  if (path.startsWith('/api/')) return '/api/*';
  const first = path.split('/')[1];
  return first ? `/${first}/*` : '/';
}

export const requestLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const started = Date.now();
  await next();
  const tenant = c.get('tenant');
  console.log(
    JSON.stringify({
      msg: 'request',
      tenant: tenant?.type === 'company' ? tenant.slug : (tenant?.type ?? null),
      method: c.req.method,
      route: routeLabel(c.req.routePath, c.req.path),
      status: c.res.status,
      duration: Date.now() - started,
    }),
  );
};

const clientErrorSchema = z.object({
  kind: z.enum(['error', 'unhandledrejection', 'react', 'csp']),
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  path: z.string().max(500).optional(),
  release: z.string().max(40).optional(),
});

export const clientErrorRoutes = new Hono<AppEnv>();

clientErrorRoutes.post('/', async (c) => {
  const limiter = c.env.CLIENT_ERROR_LIMITER;
  if (limiter) {
    const ip = c.req.header('cf-connecting-ip') ?? 'local';
    if (!(await limiter.limit({ key: `client-errors:${ip}` })).success) return c.body(null, 429);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.body(null, 400);
  }
  const parsed = clientErrorSchema.safeParse(raw);
  if (!parsed.success) return c.body(null, 400);
  const e = parsed.data;
  const tenant = c.get('tenant');
  console.error(
    JSON.stringify({
      msg: 'client_error',
      tenant: tenant.type === 'company' ? tenant.slug : tenant.type,
      kind: e.kind,
      message: scrub(e.message),
      stack: e.stack ? scrub(e.stack, 1500) : undefined,
      path: e.path ? routeLabel('', scrub(e.path, 200)) : undefined,
      release: e.release,
    }),
  );
  return c.body(null, 204);
});
