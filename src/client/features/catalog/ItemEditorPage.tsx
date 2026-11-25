import { useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeftIcon, Trash2Icon } from 'lucide-react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { toast } from 'sonner';
import {
  catalogItemSchema,
  emptyCatalogItem,
  KIND_LABELS,
  recordToForm,
  toCatalogPayload,
  type CatalogItemInput,
  type CatalogItemValues,
  type CatalogKind,
  type CatalogRecord,
} from '@shared/catalog';
import { thumbPath } from '@shared/content';
import { Button } from '@client/components/ui/button';
import { Form } from '@client/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@client/components/ui/tabs';
import { ConfirmDialog } from '@client/components/common/ConfirmDialog';
import { NotFoundPage } from '@client/components/common/RouteError';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { RequireAction } from '@client/features/admin/RequireAction';
import { useBranchesAdmin, type BranchRow } from '@client/features/content/api';
import { useCatalogItem, useSaveCatalogItem, type CatalogListRow } from './api';
import { DeleteItemDialog } from './DeleteItemDialog';
import {
  BranchesSection,
  DetailsSection,
  DiscountsSection,
  GeneralSection,
  PhotosSection,
  ProductsSection,
  type ItemForm,
} from './item-sections';

export function ServiceEditorPage() {
  return (
    <RequireAction action="catalog.edit">
      <ItemEditor kind="service" />
    </RequireAction>
  );
}

export function ProductEditorPage() {
  return (
    <RequireAction action="catalog.edit">
      <ItemEditor kind="product" />
    </RequireAction>
  );
}

function ItemEditor({ kind }: { kind: CatalogKind }) {
  const { id } = useParams();
  const itemId = id && id !== 'nuevo' ? id : null;
  const item = useCatalogItem(itemId);
  const branches = useBranchesAdmin();

  if ((itemId && item.isPending) || branches.isPending) return <FullPageSpinner />;
  if (item.isError) throw item.error;
  if (branches.isError) throw branches.error;
  // Un id de otra empresa (RLS) o de otro tipo se trata como inexistente.
  if (itemId && (!item.data || item.data.kind !== kind)) return <NotFoundPage />;

  return <ItemFormView key={itemId ?? 'new'} kind={kind} record={item.data ?? null} branches={branches.data} />;
}

type TabId = 'general' | 'details' | 'photos' | 'discounts' | 'products' | 'branches';

const TAB_FIELDS: Record<TabId, (keyof CatalogItemInput)[]> = {
  general: [
    'name',
    'reference',
    'short_description',
    'description',
    'price',
    'duration_minutes',
    'buffer_before_minutes',
    'buffer_after_minutes',
    'capacity',
    'stock',
  ],
  details: ['details'],
  photos: ['photos'],
  discounts: ['discounts'],
  products: ['products'],
  branches: ['branches'],
};

function tabsWithErrors(errors: FieldErrors<CatalogItemInput>): Set<TabId> {
  const result = new Set<TabId>();
  for (const [tab, fields] of Object.entries(TAB_FIELDS) as [TabId, (keyof CatalogItemInput)[]][]) {
    if (fields.some((f) => errors[f])) result.add(tab);
  }
  return result;
}

/** Sedes con catálogo propio: el ítem lleva una fila de disponibilidad por cada una. */
function withOwnBranches(values: CatalogItemInput, ownBranches: BranchRow[], isNew: boolean): CatalogItemInput {
  const current = new Map(values.branches.map((b) => [b.branch_id, b]));
  return {
    ...values,
    branches: ownBranches.map(
      (b) =>
        current.get(b.id) ?? {
          branch_id: b.id,
          // Nuevo: disponible en todas. Existente sin fila: no estaba disponible en esa sede.
          is_active: isNew,
          price_override: '',
        },
    ),
  };
}

function ItemFormView({
  kind,
  record,
  branches,
}: {
  kind: CatalogKind;
  record: CatalogRecord | null;
  branches: BranchRow[];
}) {
  const company = useCompany();
  const navigate = useNavigate();
  const save = useSaveCatalogItem();
  const labels = KIND_LABELS[kind];
  const ownBranches = useMemo(() => branches.filter((b) => b.own_catalog), [branches]);
  const defaults = useMemo(
    () =>
      withOwnBranches(record ? recordToForm(record, company.timezone) : emptyCatalogItem(kind), ownBranches, !record),
    [record, kind, ownBranches, company.timezone],
  );
  const form = useForm<CatalogItemInput, unknown, CatalogItemValues>({
    resolver: zodResolver(catalogItemSchema),
    defaultValues: defaults,
  }) as ItemForm;
  const [tab, setTab] = useState<TabId>('general');
  const [deleting, setDeleting] = useState(false);
  // Fotos guardadas en la BD: al guardar se borran del Storage las que ya no estén.
  const persistedPhotos = useRef<string[]>(record?.photos.map((p) => p.path) ?? []);
  // Al salir a propósito (tras crear o eliminar) no se pregunta por cambios sin guardar.
  const leaving = useRef(false);
  const errorTabs = tabsWithErrors(form.formState.errors);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !leaving.current &&
      form.formState.isDirty &&
      !save.isPending &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  async function submit(values: CatalogItemValues) {
    try {
      const payload = toCatalogPayload(values, {
        id: record?.id,
        companyId: company.id,
        timeZone: company.timezone,
        thumbPathOf: thumbPath,
      });
      const id = await save.mutateAsync({ payload, previousPhotos: persistedPhotos.current });
      persistedPhotos.current = payload.photos.map((p) => p.path);
      form.reset(form.getValues());
      toast.success(record ? 'Cambios guardados' : `${labels.one[0]?.toUpperCase()}${labels.one.slice(1)} creado`);
      if (!record) {
        leaving.current = true;
        navigate(`/admin/catalogo/${labels.path}/${id}`, { replace: true });
      }
    } catch (error) {
      toast.error(messageOf(error));
    }
  }

  function onInvalid(errors: FieldErrors<CatalogItemInput>) {
    const withErrors = tabsWithErrors(errors);
    const first = (Object.keys(TAB_FIELDS) as TabId[]).find((t) => withErrors.has(t));
    if (first && !withErrors.has(tab)) setTab(first);
    toast.error('Revisa los campos marcados.');
  }

  const tabs: { id: TabId; label: string; show: boolean }[] = [
    { id: 'general', label: 'General', show: true },
    { id: 'details', label: 'Detalles', show: true },
    { id: 'photos', label: 'Fotos', show: true },
    { id: 'discounts', label: 'Descuentos', show: true },
    { id: 'products', label: 'Productos', show: kind === 'service' },
    { id: 'branches', label: 'Sedes', show: ownBranches.length > 0 },
  ];

  const deleteTarget: CatalogListRow | null =
    record && deleting
      ? {
          id: record.id,
          kind: record.kind,
          name: record.name,
          reference: record.reference,
          price: record.price,
          duration_minutes: record.duration_minutes,
          is_active: record.is_active,
          is_featured: record.is_featured,
          allow_in_booking: record.allow_in_booking,
          sort_order: 0,
          catalog_item_photos: record.photos,
          discounts: [],
          branch_catalog_items: [],
        }
      : null;

  return (
    <>
      <div className="flex flex-col gap-3 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <Link
            to={`/admin/catalogo/${labels.path}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" aria-hidden /> {labels.many}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight break-words">
            {record ? record.name : `Nuevo ${labels.one}`}
          </h1>
        </div>
        {record && (
          <Button variant="outline" onClick={() => setDeleting(true)}>
            <Trash2Icon aria-hidden /> Eliminar
          </Button>
        )}
      </div>

      <Form {...form}>
        <form
          // handleSubmit dentro del evento: `submit` lee refs y no debe tocarse durante el render.
          onSubmit={(e) => void form.handleSubmit(submit, onInvalid)(e)}
          className="max-w-4xl space-y-6"
          noValidate
        >
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
            <div className="-mx-4 overflow-x-auto px-4 pb-1">
              <TabsList>
                {tabs
                  .filter((t) => t.show)
                  .map((t) => (
                    <TabsTrigger key={t.id} value={t.id} className="px-3">
                      {t.label}
                      {errorTabs.has(t.id) && (
                        <>
                          <span className="size-1.5 rounded-full bg-destructive" aria-hidden />
                          <span className="sr-only">(con errores)</span>
                        </>
                      )}
                    </TabsTrigger>
                  ))}
              </TabsList>
            </div>
            <TabsContent value="general" className="mt-4">
              <GeneralSection form={form} kind={kind} />
            </TabsContent>
            <TabsContent value="details" className="mt-4">
              <DetailsSection form={form} />
            </TabsContent>
            <TabsContent value="photos" className="mt-4">
              <PhotosSection form={form} persisted={persistedPhotos} />
            </TabsContent>
            <TabsContent value="discounts" className="mt-4">
              <DiscountsSection form={form} branches={branches} />
            </TabsContent>
            {kind === 'service' && (
              <TabsContent value="products" className="mt-4">
                <ProductsSection form={form} />
              </TabsContent>
            )}
            {ownBranches.length > 0 && (
              <TabsContent value="branches" className="mt-4">
                <BranchesSection form={form} branches={branches} />
              </TabsContent>
            )}
          </Tabs>

          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur">
            {form.formState.isDirty && (
              <p className="mr-auto text-sm text-muted-foreground" aria-live="polite">
                Cambios sin guardar
              </p>
            )}
            <Button variant="outline" asChild>
              <Link to={`/admin/catalogo/${labels.path}`}>Cancelar</Link>
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Guardando…' : record ? 'Guardar cambios' : `Crear ${labels.one}`}
            </Button>
          </div>
        </form>
      </Form>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => !open && blocker.state === 'blocked' && blocker.reset()}
        title="¿Salir sin guardar?"
        description="Los cambios de esta ficha se perderán."
        confirmLabel="Salir sin guardar"
        destructive
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
      <DeleteItemDialog
        item={deleteTarget}
        onOpenChange={(open) => !open && setDeleting(false)}
        onDeleted={() => {
          leaving.current = true;
          navigate(`/admin/catalogo/${labels.path}`, { replace: true });
        }}
      />
    </>
  );
}
