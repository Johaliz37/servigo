/**
 * Datos de la fase 05: perfil de la empresa, sedes y contenido del sitio. Todo va directo a
 * Supabase con el JWT del miembro (RLS: escriben owner/admin); el Worker solo purga la caché.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseBranchHeader, type BranchValues, type SocialNetwork } from '@shared/content';
import type { ClientTenant } from '@shared/tenant';
import type { Database } from '@shared/database.types';
import { useCompany, useSetTenant } from '@client/app/tenant-context';
import { apiFetch } from '@client/lib/api';
import { copyImage, deleteImages } from '@client/lib/media';
import { supabase } from '@client/lib/supabase';

type Tables = Database['public']['Tables'];
export type CompanyRow = Tables['companies']['Row'];
export type CompanyUpdate = Tables['companies']['Update'];
export type BranchRow = Tables['branches']['Row'];
export type AboutRow = Tables['about_sections']['Row'];
export type SponsorRow = Tables['sponsors']['Row'];
export type SocialLinkRow = Tables['social_links']['Row'];

/** RLS filtra en silencio lo que no puede tocar: 0 filas = sin permiso. */
function forbidden(): Error {
  return Object.assign(new Error('forbidden'), { code: '42501' });
}

// ---------------------------------------------------------------------------
// Empresa
// ---------------------------------------------------------------------------

export function useCompanyRecord() {
  const company = useCompany();
  return useQuery({
    queryKey: ['company-record', company.id],
    queryFn: async (): Promise<CompanyRow> => {
      const { data, error } = await supabase.from('companies').select('*').eq('id', company.id).single();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Guarda campos de `companies`. Si tocan lo que ve el sitio (nombre, marca, SEO, zona…),
 * purga la caché del tenant en el Worker y aplica la empresa fresca en el panel.
 */
export function useUpdateCompany() {
  const company = useCompany();
  const setTenant = useSetTenant();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ patch, purge = true }: { patch: CompanyUpdate; purge?: boolean }) => {
      const { data, error } = await supabase.from('companies').update(patch).eq('id', company.id).select('*');
      if (error) throw error;
      if (data.length === 0) throw forbidden();
      if (purge) {
        // Si la purga falla, el sitio se actualiza solo al vencer la caché (60 s).
        const fresh = await apiFetch<ClientTenant>('/api/admin/purge-tenant', { method: 'POST' }).catch(() => null);
        if (fresh) setTenant(fresh);
      }
      return data[0] as CompanyRow;
    },
    onSuccess: (row) => queryClient.setQueryData(['company-record', company.id], row),
  });
}

// ---------------------------------------------------------------------------
// Sedes
// ---------------------------------------------------------------------------

function useInvalidateBranches() {
  const company = useCompany();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['branches-admin', company.id] }),
      // Selector de sede del panel (branch-context).
      queryClient.invalidateQueries({ queryKey: ['branches', company.id] }),
    ]);
}

export function useBranchesAdmin() {
  const company = useCompany();
  return useQuery({
    queryKey: ['branches-admin', company.id],
    queryFn: async (): Promise<BranchRow[]> => {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('company_id', company.id)
        .order('sort_order')
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveBranch() {
  const company = useCompany();
  const invalidate = useInvalidateBranches();
  return useMutation({
    mutationFn: async ({ id, values, sortOrder }: { id?: string; values: BranchValues; sortOrder?: number }) => {
      if (id) {
        const { data, error } = await supabase.from('branches').update(values).eq('id', id).select('*');
        if (error) throw error;
        if (data.length === 0) throw forbidden();
        return data[0] as BranchRow;
      }
      const { data, error } = await supabase
        .from('branches')
        .insert({ ...values, company_id: company.id, sort_order: sortOrder ?? 0 })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/** Cambia campos sueltos de una sede (activa, mostrar patrocinadores). */
export function useUpdateBranch() {
  const invalidate = useInvalidateBranches();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Pick<Tables['branches']['Update'], 'is_active' | 'show_sponsors'>;
    }) => {
      const { data, error } = await supabase.from('branches').update(patch).eq('id', id).select('id');
      if (error) throw error;
      if (data.length === 0) throw forbidden();
    },
    onSuccess: invalidate,
  });
}

/** Borra la sede y, después, las imágenes suyas y de lo que se borra en cascada. */
export function useDeleteBranch() {
  const invalidate = useInvalidateBranches();
  return useMutation({
    mutationFn: async (branch: BranchRow) => {
      const [sponsors, about] = await Promise.all([
        supabase.from('sponsors').select('image_path').eq('branch_id', branch.id),
        supabase.from('about_sections').select('image_path').eq('branch_id', branch.id),
      ]);
      const { data, error } = await supabase.from('branches').delete().eq('id', branch.id).select('id');
      if (error) throw error;
      if (data.length === 0) throw forbidden();
      await deleteImages([
        branch.cover_image_path,
        parseBranchHeader(branch.header).image_path,
        ...(sponsors.data ?? []).map((s) => s.image_path),
        ...(about.data ?? []).map((a) => a.image_path),
      ]);
    },
    onSuccess: invalidate,
  });
}

/** Orden por arrastre (RPC atómica `reorder_rows`). Aplica el orden en caché al instante. */
export function useReorder(
  table: 'branches' | 'sponsors' | 'social_links' | 'catalog_items' | 'booking_fields',
  queryKey: unknown[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc('reorder_rows', { p_table: table, p_ids: ids });
      if (error) throw error;
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<{ id: string }[]>(queryKey);
      if (previous) {
        const byId = new Map(previous.map((r) => [r.id, r]));
        const reordered = ids.map((id) => byId.get(id)).filter((r): r is { id: string } => !!r);
        queryClient.setQueryData(queryKey, [...reordered, ...previous.filter((r) => !ids.includes(r.id))]);
      }
      return { previous };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}

/** ¿La sede tiene reservas? (no se puede borrar, solo inactivar). */
export function useBranchHasBookings(branchId: string | null) {
  return useQuery({
    queryKey: ['branch-has-bookings', branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<boolean> => {
      const { count, error } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('branch_id', branchId as string);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Acerca de (una general y una por sede)
// ---------------------------------------------------------------------------

export function useAboutSections() {
  const company = useCompany();
  return useQuery({
    queryKey: ['about', company.id],
    queryFn: async (): Promise<AboutRow[]> => {
      const { data, error } = await supabase.from('about_sections').select('*').eq('company_id', company.id);
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveAbout() {
  const company = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      branchId,
      values,
    }: {
      id?: string;
      branchId: string | null;
      values: Pick<AboutRow, 'title' | 'body' | 'image_path' | 'is_visible'>;
    }) => {
      if (id) {
        const { data, error } = await supabase.from('about_sections').update(values).eq('id', id).select('*');
        if (error) throw error;
        if (data.length === 0) throw forbidden();
        return data[0] as AboutRow;
      }
      const { data, error } = await supabase
        .from('about_sections')
        .insert({ ...values, company_id: company.id, branch_id: branchId })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['about', company.id] }),
  });
}

// ---------------------------------------------------------------------------
// Patrocinadores (por sede)
// ---------------------------------------------------------------------------

export const sponsorsKey = (companyId: string, branchId: string | null) => ['sponsors', companyId, branchId];

export function useSponsors(branchId: string | null) {
  const company = useCompany();
  return useQuery({
    queryKey: sponsorsKey(company.id, branchId),
    enabled: !!branchId,
    queryFn: async (): Promise<SponsorRow[]> => {
      const { data, error } = await supabase
        .from('sponsors')
        .select('*')
        .eq('branch_id', branchId as string)
        .order('sort_order')
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
}

type SponsorFields = Pick<SponsorRow, 'name' | 'description' | 'url' | 'image_path' | 'is_visible'>;

export function useSaveSponsor() {
  const company = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    /** Sin `id`: crea una copia por cada sede de `branchIds` (fase 05 §6). */
    mutationFn: async ({ id, branchIds, values }: { id?: string; branchIds: string[]; values: SponsorFields }) => {
      if (id) {
        const { data, error } = await supabase.from('sponsors').update(values).eq('id', id).select('id');
        if (error) throw error;
        if (data.length === 0) throw forbidden();
        return;
      }
      // La primera sede usa la imagen subida; las demás reciben su propia copia del archivo.
      const images = await Promise.all(
        branchIds.map((_, i) => (i === 0 || !values.image_path ? values.image_path : copyImage(values.image_path))),
      );
      const { error } = await supabase.from('sponsors').insert(
        branchIds.map((branchId, i) => ({
          ...values,
          image_path: images[i] ?? null,
          company_id: company.id,
          branch_id: branchId,
          sort_order: 999,
        })),
      );
      if (error) {
        await deleteImages(images.slice(1));
        throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sponsors', company.id] }),
  });
}

export function useDeleteSponsor() {
  const company = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('sponsors').delete().eq('id', id).select('id');
      if (error) throw error;
      if (data.length === 0) throw forbidden();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sponsors', company.id] }),
  });
}

// ---------------------------------------------------------------------------
// Redes sociales (empresa = branch_id null; sede = reemplaza a las de la empresa)
// ---------------------------------------------------------------------------

export const socialKey = (companyId: string) => ['social-links', companyId];

export function useSocialLinks() {
  const company = useCompany();
  return useQuery({
    queryKey: socialKey(company.id),
    queryFn: async (): Promise<SocialLinkRow[]> => {
      const { data, error } = await supabase
        .from('social_links')
        .select('*')
        .eq('company_id', company.id)
        .order('sort_order')
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveSocialLink() {
  const company = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      branchId,
      values,
    }: {
      id?: string;
      branchId: string | null;
      values: { network: SocialNetwork; label: string | null; url: string; is_visible: boolean };
    }) => {
      if (id) {
        const { data, error } = await supabase.from('social_links').update(values).eq('id', id).select('id');
        if (error) throw error;
        if (data.length === 0) throw forbidden();
        return;
      }
      const { error } = await supabase
        .from('social_links')
        .insert({ ...values, company_id: company.id, branch_id: branchId, sort_order: 999 });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: socialKey(company.id) }),
  });
}

export function useDeleteSocialLink() {
  const company = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('social_links').delete().eq('id', id).select('id');
      if (error) throw error;
      if (data.length === 0) throw forbidden();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: socialKey(company.id) }),
  });
}

/** Activar/ocultar una fila con interruptor (patrocinadores, redes). */
export function useToggleVisible(table: 'sponsors' | 'social_links', invalidateKey: unknown[]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, visible }: { id: string; visible: boolean }) => {
      const { data, error } = await supabase.from(table).update({ is_visible: visible }).eq('id', id).select('id');
      if (error) throw error;
      if (data.length === 0) throw forbidden();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invalidateKey }),
  });
}
