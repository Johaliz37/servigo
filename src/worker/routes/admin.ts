import { Hono } from 'hono';
import { z } from 'zod';
import { inviteMemberSchema, type InviteResult } from '@shared/schemas';
import type { ClientTenant } from '@shared/tenant';
import type { AppEnv } from '../env';
import { apiError, bearerToken, dbError, parseBody } from '../http';
import { bumpSlotsVersion, purgePublic } from '../public-cache';
import { sendInvitationEmail, userClient } from '../supabase';
import { loadCompany, purgeCompany } from '../tenant';

const INVITATION_DAYS = 7;

/** `/api/admin/*`: operaciones del panel de una empresa que necesitan la secret key. */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', async (c, next) => {
  if (!c.get('company')) return apiError(c, 404, 'not_found', 'Solo disponible en el sitio de una empresa');
  if (!bearerToken(c)) return apiError(c, 401, 'unauthorized', 'Inicia sesión');
  return next();
});

const acceptUrl = (requestUrl: string, token: string) =>
  `${new URL(requestUrl).origin}/admin/aceptar-invitacion?token=${encodeURIComponent(token)}`;

/**
 * Invita a un miembro. La fila se inserta con el JWT del invitador, así RLS decide si
 * puede invitar ese rol (owner: todos; admin: solo staff). Luego se envía el correo.
 */
adminRoutes.post('/invite', async (c) => {
  const company = c.get('company');
  const jwt = bearerToken(c);
  if (!company || !jwt) return apiError(c, 401, 'unauthorized', 'Inicia sesión');

  const body = await parseBody(c, inviteMemberSchema);
  if ('response' in body) return body.response;
  const { email, role, branchIds } = body.data;

  const { data, error } = await userClient(c.env, jwt)
    .from('company_invitations')
    .insert({ company_id: company.id, email, role, branch_ids: role === 'staff' ? branchIds : null })
    .select('id, token, email')
    .single();
  if (error) {
    if (error.code === '23505') {
      return apiError(
        c,
        409,
        'invitation_pending',
        'Ya hay una invitación pendiente para ese correo: reenvíala desde la lista.',
      );
    }
    // RLS rechaza el insert con 42501 (rol insuficiente).
    return dbError(c, error);
  }

  const emailSent = await sendInvitationEmail(c.env, data.email, acceptUrl(c.req.url, data.token));
  return c.json({ invitationId: data.id, email: data.email, emailSent } satisfies InviteResult, 201);
});

/** Reenvía una invitación pendiente y renueva su vencimiento. */
adminRoutes.post('/invitations/:id/resend', async (c) => {
  const company = c.get('company');
  const jwt = bearerToken(c);
  if (!company || !jwt) return apiError(c, 401, 'unauthorized', 'Inicia sesión');

  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000).toISOString();
  const { data, error } = await userClient(c.env, jwt)
    .from('company_invitations')
    .update({ expires_at: expiresAt })
    .eq('id', c.req.param('id'))
    .eq('company_id', company.id)
    .is('accepted_at', null)
    .select('id, token, email')
    .maybeSingle();
  if (error) return dbError(c, error);
  if (!data) return apiError(c, 404, 'not_found', 'La invitación no existe, ya fue aceptada o no puedes gestionarla');

  const emailSent = await sendInvitationEmail(c.env, data.email, acceptUrl(c.req.url, data.token));
  return c.json({ invitationId: data.id, email: data.email, emailSent } satisfies InviteResult);
});

/**
 * Borra la caché del tenant tras editar perfil o marca (fase 05 §2) y devuelve la empresa
 * recién leída, para que el panel la aplique sin recargar. Solo owner/admin.
 */
adminRoutes.post('/purge-tenant', async (c) => {
  const company = c.get('company');
  const jwt = bearerToken(c);
  if (!company || !jwt) return apiError(c, 401, 'unauthorized', 'Inicia sesión');

  const { data: allowed, error } = await userClient(c.env, jwt).rpc('has_company_role', {
    p_company: company.id,
    p_roles: ['owner', 'admin'],
  });
  if (error) return dbError(c, error);
  if (allowed !== true) return apiError(c, 403, 'forbidden', 'No tienes permiso para hacer esto');

  await Promise.all([purgeCompany(company.slug), purgePublic(company.id)]);
  const fresh = await loadCompany(c.env, company.slug);
  if (!fresh) return apiError(c, 404, 'company_not_found', 'Esta empresa no existe');
  return c.json({ type: 'company', slug: fresh.slug, company: fresh } satisfies ClientTenant, 200, {
    'cache-control': 'no-store',
  });
});

/**
 * Invalida la caché del sitio público (fase 09 §2) tras guardar contenido, catálogo o sedes
 * en el panel: el cambio se ve al instante y no al vencer los 60 s. Solo owner/admin.
 */
adminRoutes.post('/purge-public', async (c) => {
  const company = c.get('company');
  const jwt = bearerToken(c);
  if (!company || !jwt) return apiError(c, 401, 'unauthorized', 'Inicia sesión');

  const { data: allowed, error } = await userClient(c.env, jwt).rpc('has_company_role', {
    p_company: company.id,
    p_roles: ['owner', 'admin'],
  });
  if (error) return dbError(c, error);
  if (allowed !== true) return apiError(c, 403, 'forbidden', 'No tienes permiso para hacer esto');

  await purgePublic(company.id);
  return c.body(null, 204);
});

const slotsChangedSchema = z.object({ branch_id: z.uuid(), service_id: z.uuid() });

/**
 * Invalida los cupos cacheados de una sede y servicio (D28) tras confirmar, cancelar,
 * reprogramar o crear una reserva en el panel (fase 11): el sitio público deja de ofrecer, o
 * vuelve a ofrecer, ese horario al instante. Cualquier miembro con acceso a la sede.
 */
adminRoutes.post('/slots-changed', async (c) => {
  const company = c.get('company');
  const jwt = bearerToken(c);
  if (!company || !jwt) return apiError(c, 401, 'unauthorized', 'Inicia sesión');

  const body = await parseBody(c, slotsChangedSchema);
  if ('response' in body) return body.response;

  const { data: allowed, error } = await userClient(c.env, jwt).rpc('can_access_branch', {
    p_company: company.id,
    p_branch: body.data.branch_id,
  });
  if (error) return dbError(c, error);
  if (allowed !== true) return apiError(c, 403, 'forbidden', 'No tienes permiso para hacer esto');

  await bumpSlotsVersion(company.id, body.data.branch_id, body.data.service_id);
  return c.body(null, 204);
});
