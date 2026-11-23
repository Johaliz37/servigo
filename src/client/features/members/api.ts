import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InviteMemberInput, InviteResult } from '@shared/schemas';
import type { MemberRole } from '@shared/permissions';
import { useCompany } from '@client/app/tenant-context';
import { apiFetch } from '@client/lib/api';
import { supabase } from '@client/lib/supabase';

export interface MemberRow {
  id: string;
  userId: string;
  email: string;
  role: MemberRole;
  branchIds: string[] | null;
  createdAt: string;
  lastSignInAt: string | null;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: MemberRole;
  branchIds: string[] | null;
  expiresAt: string;
  createdAt: string;
}

export function useMembers() {
  const company = useCompany();
  return useQuery({
    queryKey: ['members', company.id],
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase.rpc('list_company_members', { p_company: company.id });
      if (error) throw error;
      return data.map((m) => ({
        id: m.id,
        userId: m.user_id,
        email: m.email,
        role: m.role,
        branchIds: m.branch_ids,
        createdAt: m.created_at,
        lastSignInAt: m.last_sign_in_at,
      }));
    },
  });
}

export function useInvitations() {
  const company = useCompany();
  return useQuery({
    queryKey: ['invitations', company.id],
    queryFn: async (): Promise<InvitationRow[]> => {
      const { data, error } = await supabase
        .from('company_invitations')
        .select('id, email, role, branch_ids, expires_at, created_at')
        .eq('company_id', company.id)
        .is('accepted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        branchIds: i.branch_ids,
        expiresAt: i.expires_at,
        createdAt: i.created_at,
      }));
    },
  });
}

function useInvalidate() {
  const company = useCompany();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['members', company.id] }),
      queryClient.invalidateQueries({ queryKey: ['invitations', company.id] }),
      queryClient.invalidateQueries({ queryKey: ['membership', company.id] }),
    ]);
}

export function useInviteMember() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: InviteMemberInput) => apiFetch<InviteResult>('/api/admin/invite', { body: input }),
    onSuccess: invalidate,
  });
}

export function useResendInvitation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<InviteResult>(`/api/admin/invitations/${encodeURIComponent(id)}/resend`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRevokeInvitation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('company_invitations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateMember() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, role, branchIds }: { id: string; role: MemberRole; branchIds: string[] | null }) => {
      const { data, error } = await supabase
        .from('company_members')
        .update({ role, branch_ids: role === 'staff' ? branchIds : null })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      // RLS filtra en silencio las filas que no puede tocar: 0 filas = sin permiso.
      if (data.length === 0) throw Object.assign(new Error('forbidden'), { code: '42501' });
    },
    onSuccess: invalidate,
  });
}

export function useRemoveMember() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('company_members').delete().eq('id', id).select('id');
      if (error) throw error;
      if (data.length === 0) throw Object.assign(new Error('forbidden'), { code: '42501' });
    },
    onSuccess: invalidate,
  });
}

export const EMAIL_SENT_MESSAGES: Record<InviteResult['emailSent'], string> = {
  invite: 'Le enviamos un correo para crear su contraseña y aceptar.',
  magic_link: 'Ya tenía cuenta: le enviamos un enlace de acceso para aceptar.',
  none: 'No se pudo enviar el correo. Reenvía la invitación desde la lista en unos minutos.',
};
