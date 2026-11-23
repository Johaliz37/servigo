import { createContext, use, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { can, type Action, type EffectiveRole } from '@shared/permissions';
import { useCompany } from '@client/app/tenant-context';
import { supabase } from '@client/lib/supabase';
import { useSession } from './session';

export interface Membership {
  role: EffectiveRole;
  /** `null` = todas las sedes. */
  branchIds: string[] | null;
}

/** Rol del usuario en la empresa del subdominio (o superadmin). `null` = no es miembro. */
export function useMembershipQuery() {
  const company = useCompany();
  const { session } = useSession();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ['membership', company.id, userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<Membership | null> => {
      const [member, platformAdmin] = await Promise.all([
        supabase
          .from('company_members')
          .select('role, branch_ids')
          .eq('company_id', company.id)
          .eq('user_id', userId as string)
          .maybeSingle(),
        supabase.rpc('is_platform_admin'),
      ]);
      if (member.error) throw member.error;
      if (platformAdmin.error) throw platformAdmin.error;
      if (member.data) return { role: member.data.role, branchIds: member.data.branch_ids };
      if (platformAdmin.data) return { role: 'platform_admin', branchIds: null };
      return null;
    },
  });
}

const MembershipContext = createContext<Membership | null>(null);

export function MembershipProvider({ membership, children }: { membership: Membership; children: ReactNode }) {
  return <MembershipContext value={membership}>{children}</MembershipContext>;
}

/** Membresía dentro de `/admin` (garantizada por `RequireMember`) y helper `can`. */
export function useMembership() {
  const membership = use(MembershipContext);
  if (!membership) throw new Error('useMembership fuera de RequireMember');
  return { ...membership, can: (action: Action) => can(membership.role, action) };
}
