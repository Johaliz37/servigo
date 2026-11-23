import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCompanyInput, CreateCompanyResult, InviteResult } from '@shared/schemas';
import { apiFetch } from '@client/lib/api';
import { supabase } from '@client/lib/supabase';

export interface ConsoleCompany {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  branchesCount: number;
  bookingsThisMonth: number;
  createdAt: string;
}

const KEY = ['console', 'companies'];

export function useConsoleCompanies() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<ConsoleCompany[]> => {
      const { data, error } = await supabase.rpc('console_companies');
      if (error) throw error;
      return data.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        status: c.status,
        branchesCount: c.branches_count,
        bookingsThisMonth: c.bookings_this_month,
        createdAt: c.created_at,
      }));
    },
  });
}

export type SlugStatus = 'invalid' | 'reserved' | 'taken' | 'available';

export async function checkSlug(slug: string): Promise<SlugStatus> {
  const { data, error } = await supabase.rpc('check_slug', { p_slug: slug });
  if (error) throw error;
  return data as SlugStatus;
}

export function useCreateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCompanyInput) =>
      apiFetch<CreateCompanyResult>('/api/superadmin/companies', { body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetCompanyStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ConsoleCompany['status'] }) =>
      apiFetch(`/api/superadmin/companies/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useResendOwnerInvite() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<InviteResult>(`/api/superadmin/companies/${encodeURIComponent(id)}/resend-owner-invite`, {
        method: 'POST',
      }),
  });
}
