/**
 * Permisos de UI por rol (00 §7, 02 §4). Solo ocultan acciones: la seguridad real es RLS.
 */

export type MemberRole = 'owner' | 'admin' | 'staff';
/** El superadmin entra a cualquier empresa con permisos de owner. */
export type EffectiveRole = MemberRole | 'platform_admin';

export type Action =
  | 'members.view'
  | 'members.manage_staff'
  | 'members.manage_admins' // invitar/cambiar/revocar owners y admins
  | 'company.edit' // datos de la empresa, sedes, contenido, configuración
  | 'catalog.edit'
  | 'forms.edit'
  | 'availability.edit_company' // horarios a nivel empresa
  | 'availability.edit_branch' // horarios de las sedes asignadas
  | 'bookings.manage'
  | 'dashboard.view';

const MATRIX: Record<EffectiveRole, ReadonlySet<Action>> = {
  platform_admin: new Set<Action>([
    'members.view',
    'members.manage_staff',
    'members.manage_admins',
    'company.edit',
    'catalog.edit',
    'forms.edit',
    'availability.edit_company',
    'availability.edit_branch',
    'bookings.manage',
    'dashboard.view',
  ]),
  owner: new Set<Action>([
    'members.view',
    'members.manage_staff',
    'members.manage_admins',
    'company.edit',
    'catalog.edit',
    'forms.edit',
    'availability.edit_company',
    'availability.edit_branch',
    'bookings.manage',
    'dashboard.view',
  ]),
  admin: new Set<Action>([
    'members.view',
    'members.manage_staff',
    'company.edit',
    'catalog.edit',
    'forms.edit',
    'availability.edit_company',
    'availability.edit_branch',
    'bookings.manage',
    'dashboard.view',
  ]),
  staff: new Set<Action>(['availability.edit_branch', 'bookings.manage', 'dashboard.view']),
};

export function can(role: EffectiveRole | null | undefined, action: Action): boolean {
  return role ? MATRIX[role].has(action) : false;
}

/** Roles que `role` puede asignar al invitar o editar miembros. */
export function assignableRoles(role: EffectiveRole | null | undefined): MemberRole[] {
  if (can(role, 'members.manage_admins')) return ['owner', 'admin', 'staff'];
  if (can(role, 'members.manage_staff')) return ['staff'];
  return [];
}

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  platform_admin: 'Superadmin',
  owner: 'Propietario',
  admin: 'Administrador',
  staff: 'Personal',
};
