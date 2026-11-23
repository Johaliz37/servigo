/**
 * Esquemas Zod compartidos entre cliente (formularios) y Worker (validación de API).
 */
import { z } from 'zod';
import { SLUG_REGEX } from './tenant';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Escribe un correo válido' }));

export const passwordSchema = z.string().min(8, { error: 'Usa al menos 8 caracteres' }).max(72, {
  error: 'Usa máximo 72 caracteres',
});

export const slugSchema = z.string().trim().regex(SLUG_REGEX, {
  error: 'De 3 a 32 caracteres: minúsculas, números y guiones (sin "--" ni guion al inicio o final)',
});

export const memberRoleSchema = z.enum(['owner', 'admin', 'staff']);

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: memberRoleSchema,
  /** Solo staff: sedes asignadas. `null` = todas. */
  branchIds: z.array(z.uuid()).nullable().default(null),
});
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

export const createCompanySchema = z.object({
  name: z.string().trim().min(1, { error: 'Escribe el nombre' }).max(120),
  slug: slugSchema,
  ownerEmail: emailSchema,
  timezone: z.string().trim().min(1).default('America/Bogota'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, { error: 'Código ISO 4217 de 3 letras (p. ej. COP)' })
    .default('COP'),
});
export type CreateCompanyInput = z.input<typeof createCompanySchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: 'Escribe tu contraseña' }),
});

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { error: 'Las contraseñas no coinciden', path: ['confirm'] });

/** Respuestas de la API del Worker. */
export interface InviteResult {
  invitationId: string;
  email: string;
  /** `invite`: usuario nuevo; `magic_link`: ya tenía cuenta; `none`: no se pudo enviar el correo. */
  emailSent: 'invite' | 'magic_link' | 'none';
}

export interface CreateCompanyResult extends InviteResult {
  companyId: string;
  slug: string;
  url: string;
}

export interface ApiError {
  error: string;
  message: string;
}
