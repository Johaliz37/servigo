import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodType } from 'zod';
import { errorMessage, type ErrorLike } from '@shared/errors';
import type { AppEnv } from './env';

export type Ctx = Context<AppEnv>;

export const apiError = (c: Ctx, status: ContentfulStatusCode, error: string, message: string) =>
  c.json({ error, message }, status);

/** JWT del usuario en `Authorization: Bearer …`, o `null`. */
export function bearerToken(c: Ctx): string | null {
  const header = c.req.header('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/** Valida el cuerpo JSON con Zod. Devuelve los datos o una respuesta 400. */
export async function parseBody<T>(c: Ctx, schema: ZodType<T>): Promise<{ data: T } | { response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { response: apiError(c, 400, 'invalid_json', 'El cuerpo debe ser JSON') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { response: apiError(c, 400, 'invalid_body', first?.message ?? 'Datos no válidos') };
  }
  return { data: parsed.data };
}

/** Error de PostgREST/Postgres → respuesta HTTP con mensaje en español. */
export function dbError(c: Ctx, error: ErrorLike) {
  const status: ContentfulStatusCode =
    error.code === '42501'
      ? 403
      : error.code === 'PGRST301' || error.code === 'PGRST303'
        ? 401
        : error.code === '23505'
          ? 409
          : error.code === 'P0001' || error.code === '23514' || error.code === '22P02'
            ? 422
            : 500;
  if (status === 500) console.error(JSON.stringify({ msg: 'db_error', code: error.code, message: error.message }));
  return apiError(c, status, error.code ?? 'db_error', errorMessage(error));
}
