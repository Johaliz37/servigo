/**
 * Datos de la fase 06: catálogo de servicios y productos. Lecturas directas con RLS; el
 * guardado de la ficha va por la RPC transaccional `upsert_catalog_item`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { thumbPath } from '@shared/content';
import { copyName, type CatalogKind, type CatalogPayload, type CatalogRecord } from '@shared/catalog';
import type { Database, Json } from '@shared/database.types';
import { useCompany } from '@client/app/tenant-context';
import { copyImage, deleteImages } from '@client/lib/media';
import { supabase } from '@client/lib/supabase';

type Tables = Database['public']['Tables'];
export type DiscountRow = Tables['discounts']['Row'];

function forbidden(): Error {
  return Object.assign(new Error('forbidden'), { code: '42501' });
}

export const catalogKey = (companyId: string, kind?: CatalogKind) =>
  kind ? ['catalog', companyId, kind] : ['catalog', companyId];

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

const LIST_SELECT =
  'id, kind, name, reference, price, duration_minutes, is_active, is_featured, allow_in_booking, sort_order, ' +
  'catalog_item_photos (path, is_cover, sort_order), discounts (*), ' +
  'branch_catalog_items (branch_id, is_active, price_override)';

export interface CatalogListRow {
  id: string;
  kind: CatalogKind;
  name: string;
  reference: string | null;
  price: number;
  duration_minutes: number | null;
  is_active: boolean;
  is_featured: boolean;
  allow_in_booking: boolean;
  sort_order: number;
  catalog_item_photos: { path: string; is_cover: boolean; sort_order: number }[];
  discounts: DiscountRow[];
  branch_catalog_items: { branch_id: string; is_active: boolean; price_override: number | null }[];
}

export function coverOf(row: Pick<CatalogListRow, 'catalog_item_photos'>): string | null {
  const photos = [...row.catalog_item_photos].sort(
    (a, b) => Number(b.is_cover) - Number(a.is_cover) || a.sort_order - b.sort_order,
  );
  return photos[0]?.path ?? null;
}

export function useCatalogList(kind: CatalogKind) {
  const company = useCompany();
  return useQuery({
    queryKey: catalogKey(company.id, kind),
    queryFn: async (): Promise<CatalogListRow[]> => {
      const { data, error } = await supabase
        .from('catalog_items')
        .select(LIST_SELECT)
        .eq('company_id', company.id)
        .eq('kind', kind)
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data as unknown as CatalogListRow[];
    },
  });
}

/** Productos para asociar a un servicio (incluye inactivos para mostrarlos marcados). */
export function useProductOptions() {
  const company = useCompany();
  return useQuery({
    queryKey: ['catalog-product-options', company.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_items')
        .select('id, name, reference, price, is_active, allow_in_booking')
        .eq('company_id', company.id)
        .eq('kind', 'product')
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------------

const ITEM_SELECT =
  '*, details:catalog_item_details (label, value, sort_order), ' +
  'photos:catalog_item_photos (path, alt, is_cover, sort_order), ' +
  'discounts (id, label, type, value, starts_at, ends_at, branch_id, is_active), ' +
  'products:service_products!service_products_service_id_fkey (product_id, max_quantity, sort_order), ' +
  'branches:branch_catalog_items (branch_id, is_active, price_override)';

async function fetchItem(id: string): Promise<CatalogRecord | null> {
  const { data, error } = await supabase.from('catalog_items').select(ITEM_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as unknown as CatalogRecord | null;
}

export const itemKey = (id: string) => ['catalog-item', id];

export function useCatalogItem(id: string | null) {
  return useQuery({
    queryKey: itemKey(id ?? 'new'),
    enabled: !!id,
    queryFn: () => fetchItem(id as string),
  });
}

function useInvalidateCatalog() {
  const company = useCompany();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: catalogKey(company.id) }),
      queryClient.invalidateQueries({ queryKey: ['catalog-product-options', company.id] }),
      queryClient.invalidateQueries({ queryKey: ['branch-catalog', company.id] }),
    ]);
}

async function upsert(payload: CatalogPayload | Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_catalog_item', { p_payload: payload as unknown as Json });
  if (error) throw error;
  return data;
}

/** Guarda la ficha y, después, borra las fotos que se quitaron (00: los archivos se borran al guardar). */
export function useSaveCatalogItem() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: async ({ payload, previousPhotos }: { payload: CatalogPayload; previousPhotos: string[] }) => {
      const id = await upsert(payload);
      const kept = new Set(payload.photos.map((p) => p.path));
      await deleteImages(previousPhotos.filter((p) => !kept.has(p)));
      return id;
    },
    onSuccess: async (id) => {
      await Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: itemKey(id) })]);
    },
  });
}

export function useToggleItemActive() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from('catalog_items')
        .update({ is_active: active })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (data.length === 0) throw forbidden();
    },
    onSuccess: invalidate,
  });
}

/** ¿Hay reservas con este ítem? (no se puede borrar, solo inactivar). */
export function useItemHasBookings(item: { id: string; kind: CatalogKind } | null) {
  return useQuery({
    queryKey: ['item-has-bookings', item?.id],
    enabled: !!item,
    queryFn: async (): Promise<boolean> => {
      const target = item as { id: string; kind: CatalogKind };
      const query =
        target.kind === 'service'
          ? supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('service_id', target.id)
          : supabase.from('booking_items').select('id', { count: 'exact', head: true }).eq('product_id', target.id);
      const { count, error } = await query;
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
}

export function useDeleteItem() {
  const company = useCompany();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: async (item: Pick<CatalogListRow, 'id' | 'catalog_item_photos'>) => {
      const { data, error } = await supabase.from('catalog_items').delete().eq('id', item.id).select('id');
      if (error) throw error;
      if (data.length === 0) throw forbidden();
      await deleteImages(item.catalog_item_photos.map((p) => p.path));
    },
    onSuccess: (_data, item) => {
      // Fuera de la caché ya: al volver al listado (aún sin refrescar) no reaparece.
      queryClient.setQueriesData<CatalogListRow[]>({ queryKey: catalogKey(company.id) }, (rows) =>
        rows?.filter((r) => r.id !== item.id),
      );
      queryClient.removeQueries({ queryKey: itemKey(item.id) });
      return invalidate();
    },
  });
}

/** Copia la ficha completa (sin referencia, inactiva) con sus propias copias de las fotos. */
export function useDuplicateItem() {
  const company = useCompany();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      const item = await fetchItem(id);
      if (!item) throw forbidden();
      const photos = await Promise.all(
        item.photos.map(async (p) => {
          const path = await copyImage(p.path);
          return { path, thumb_path: thumbPath(path), alt: p.alt, is_cover: p.is_cover, sort_order: p.sort_order };
        }),
      );
      try {
        return await upsert({
          company_id: company.id,
          kind: item.kind,
          name: copyName(item.name),
          reference: null,
          short_description: item.short_description,
          description: item.description,
          price: item.price,
          duration_minutes: item.duration_minutes,
          buffer_before_minutes: item.buffer_before_minutes,
          buffer_after_minutes: item.buffer_after_minutes,
          capacity: item.capacity,
          allow_in_booking: item.allow_in_booking,
          stock: item.stock,
          is_active: false,
          is_featured: item.is_featured,
          details: [...item.details].sort((a, b) => a.sort_order - b.sort_order),
          photos: photos.sort((a, b) => a.sort_order - b.sort_order),
          // Sin id: la RPC crea descuentos nuevos.
          discounts: item.discounts.map((d) => ({ ...d, id: undefined })),
          products: [...item.products].sort((a, b) => a.sort_order - b.sort_order),
          branches: item.branches,
        });
      } catch (error) {
        await deleteImages(photos.map((p) => p.path));
        throw error;
      }
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Catálogo por sede (sedes con catálogo propio)
// ---------------------------------------------------------------------------

export function useBranchCatalog(branchId: string) {
  const company = useCompany();
  return useQuery({
    queryKey: ['branch-catalog', company.id, branchId],
    queryFn: async () => {
      const [items, rows] = await Promise.all([
        supabase
          .from('catalog_items')
          .select('id, kind, name, reference, price, is_active, sort_order')
          .eq('company_id', company.id)
          .order('kind')
          .order('sort_order')
          .order('name'),
        supabase.from('branch_catalog_items').select('item_id, is_active, price_override').eq('branch_id', branchId),
      ]);
      if (items.error) throw items.error;
      if (rows.error) throw rows.error;
      return { items: items.data, rows: rows.data };
    },
  });
}

/** Disponibilidad y precio de uno o varios ítems en la sede (upsert por sede + ítem). */
export function useSetBranchItems(branchId: string) {
  const company = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      rows: { item_id: string; is_active: boolean; price_override: number | null }[],
    ): Promise<void> => {
      if (rows.length === 0) return;
      const { data, error } = await supabase
        .from('branch_catalog_items')
        .upsert(
          rows.map((r) => ({ ...r, branch_id: branchId, company_id: company.id })),
          { onConflict: 'branch_id,item_id' },
        )
        .select('item_id');
      if (error) throw error;
      if (data.length !== rows.length) throw forbidden();
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['branch-catalog', company.id, branchId] }),
        queryClient.invalidateQueries({ queryKey: catalogKey(company.id) }),
      ]),
  });
}
