import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCompany } from '@client/app/tenant-context';
import { supabase } from '@client/lib/supabase';
import { useMembership } from '@client/features/auth/membership';

export interface BranchOption {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  isActive: boolean;
}

interface BranchContextValue {
  /** Sedes visibles para el usuario (staff: solo las asignadas). */
  branches: BranchOption[];
  loading: boolean;
  /** `null` = todas las sedes. */
  selectedId: string | null;
  selected: BranchOption | null;
  select: (id: string | null) => void;
}

const BranchContext = createContext<BranchContextValue | null>(null);

const storageKey = (companyId: string) => `servigo:branch:${companyId}`;

function readStored(companyId: string): string | null {
  try {
    return localStorage.getItem(storageKey(companyId));
  } catch {
    return null;
  }
}

export function useBranchesQuery() {
  const company = useCompany();
  return useQuery({
    queryKey: ['branches', company.id],
    queryFn: async (): Promise<BranchOption[]> => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, slug, timezone, is_active')
        .eq('company_id', company.id)
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        timezone: b.timezone ?? company.timezone,
        isActive: b.is_active,
      }));
    },
  });
}

/** Selector de sede global del panel, persistido en localStorage (filtra calendario, reservas, dashboard). */
export function BranchProvider({ children }: { children: ReactNode }) {
  const company = useCompany();
  const { branchIds } = useMembership();
  const query = useBranchesQuery();
  const [stored, setStored] = useState<string | null>(() => readStored(company.id));

  const branches = useMemo(
    () => (query.data ?? []).filter((b) => branchIds === null || branchIds.includes(b.id)),
    [query.data, branchIds],
  );

  // Una selección guardada que ya no existe (o no es accesible) vuelve a "todas";
  // con una sola sede visible, esa queda fija.
  const selectedId =
    branches.length === 1 ? (branches[0]?.id ?? null) : branches.some((b) => b.id === stored) ? stored : null;

  const select = useCallback(
    (id: string | null) => {
      setStored(id);
      try {
        if (id) localStorage.setItem(storageKey(company.id), id);
        else localStorage.removeItem(storageKey(company.id));
      } catch {
        // localStorage no disponible (modo privado estricto): la selección dura la sesión.
      }
    },
    [company.id],
  );

  const value = useMemo<BranchContextValue>(
    () => ({
      branches,
      loading: query.isPending,
      selectedId,
      selected: branches.find((b) => b.id === selectedId) ?? null,
      select,
    }),
    [branches, query.isPending, selectedId, select],
  );

  return <BranchContext value={value}>{children}</BranchContext>;
}

export function useSelectedBranch(): BranchContextValue {
  const value = use(BranchContext);
  if (!value) throw new Error('useSelectedBranch fuera de BranchProvider');
  return value;
}
