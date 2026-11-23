import { Hono } from 'hono';
import { z } from 'zod';
import { createCompanySchema, type CreateCompanyResult, type InviteResult } from '@shared/schemas';
import { companyOrigin } from '@shared/tenant';
import type { AppEnv } from '../env';
import { apiError, bearerToken, dbError, parseBody } from '../http';
import { sendInvitationEmail, userClient } from '../supabase';
import { purgeCompany } from '../tenant';

/** `/api/superadmin/*`: consola de la plataforma. Solo en el host de la plataforma. */
export const superadminRoutes = new Hono<AppEnv>();

superadminRoutes.use('*', async (c, next) => {
  if (c.get('tenant').type !== 'platform') return apiError(c, 404, 'not_found', 'Solo disponible en la consola');
  const jwt = bearerToken(c);
  if (!jwt) return apiError(c, 401, 'unauthorized', 'Inicia sesión');
  // Se comprueba aquí para responder 403 claro; las RPC lo vuelven a validar en la BD.
  const { data, error } = await userClient(c.env, jwt).rpc('is_platform_admin');
  if (error) return dbError(c, error);
  if (data !== true) return apiError(c, 403, 'forbidden', 'Solo el superadmin puede usar la consola');
  return next();
});

const acceptUrl = (requestUrl: string, rootDomain: string, slug: string, token: string) =>
  `${companyOrigin(requestUrl, rootDomain, slug)}/admin/aceptar-invitacion?token=${encodeURIComponent(token)}`;

const createdSchema = z.object({
  company_id: z.string(),
  slug: z.string(),
  invitation_id: z.string(),
  invitation_token: z.string(),
  owner_email: z.string(),
});

/** Alta: empresa + sede principal + invitación al owner (RPC atómica) y correo. */
superadminRoutes.post('/companies', async (c) => {
  const jwt = bearerToken(c) as string;
  const body = await parseBody(c, createCompanySchema);
  if ('response' in body) return body.response;
  const input = body.data;

  const { data, error } = await userClient(c.env, jwt).rpc('create_company', {
    p_name: input.name,
    p_slug: input.slug,
    p_owner_email: input.ownerEmail,
    p_timezone: input.timezone,
    p_currency: input.currency,
  });
  if (error) return dbError(c, error);
  const created = createdSchema.parse(data);
  await purgeCompany(created.slug); // por si se consultó antes de existir (404 cacheado)

  const emailSent = await sendInvitationEmail(
    c.env,
    created.owner_email,
    acceptUrl(c.req.url, c.env.ROOT_DOMAIN, created.slug, created.invitation_token),
  );
  const result: CreateCompanyResult = {
    companyId: created.company_id,
    slug: created.slug,
    url: companyOrigin(c.req.url, c.env.ROOT_DOMAIN, created.slug),
    invitationId: created.invitation_id,
    email: created.owner_email,
    emailSent,
  };
  return c.json(result, 201);
});

const statusSchema = z.object({ status: z.enum(['active', 'suspended']) });

/** Suspender / reactivar. Pasa por el Worker para invalidar la caché del tenant. */
superadminRoutes.patch('/companies/:id/status', async (c) => {
  const jwt = bearerToken(c) as string;
  const body = await parseBody(c, statusSchema);
  if ('response' in body) return body.response;

  const { data, error } = await userClient(c.env, jwt)
    .from('companies')
    .update({ status: body.data.status })
    .eq('id', c.req.param('id'))
    .select('id, slug, status')
    .maybeSingle();
  if (error) return dbError(c, error);
  if (!data) return apiError(c, 404, 'not_found', 'La empresa no existe');
  await purgeCompany(data.slug);
  return c.json(data);
});

/** Reenvía la invitación pendiente del owner (si el primer correo no llegó). */
superadminRoutes.post('/companies/:id/resend-owner-invite', async (c) => {
  const jwt = bearerToken(c) as string;
  const db = userClient(c.env, jwt);
  const pending = await db
    .from('company_invitations')
    .select('id')
    .eq('company_id', c.req.param('id'))
    .eq('role', 'owner')
    .is('accepted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pending.error) return dbError(c, pending.error);
  if (!pending.data) return apiError(c, 404, 'not_found', 'No hay invitación de owner pendiente');

  const { data: invitation, error } = await db
    .from('company_invitations')
    .update({ expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
    .eq('id', pending.data.id)
    .select('id, token, email, companies(slug)')
    .single();
  if (error) return dbError(c, error);
  if (!invitation.companies) return apiError(c, 404, 'not_found', 'La empresa no existe');

  const emailSent = await sendInvitationEmail(
    c.env,
    invitation.email,
    acceptUrl(c.req.url, c.env.ROOT_DOMAIN, invitation.companies.slug, invitation.token),
  );
  return c.json({ invitationId: invitation.id, email: invitation.email, emailSent } satisfies InviteResult);
});
