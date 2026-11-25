import { useMemo, useState, type RefObject } from 'react';
import { AlertTriangleIcon, CheckIcon, PlusIcon, StarIcon, Trash2Icon, type LucideIcon } from 'lucide-react';
import { useFieldArray, useWatch, type FieldPath, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import {
  discountFormSchema,
  discountToRow,
  MAX_DETAILS,
  MAX_DISCOUNTS,
  MAX_PHOTOS,
  type CatalogItemInput,
  type CatalogItemValues,
  type CatalogKind,
} from '@shared/catalog';
import { formatMoney } from '@shared/format';
import { DISCOUNT_STATUS_LABELS, discountStatus, effectivePrice, type DiscountStatus } from '@shared/pricing';
import { Alert, AlertDescription } from '@client/components/ui/alert';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@client/components/ui/command';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@client/components/ui/form';
import { Input } from '@client/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@client/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Switch } from '@client/components/ui/switch';
import { Textarea } from '@client/components/ui/textarea';
import { Markdown } from '@client/components/common/Markdown';
import { SortableList } from '@client/components/common/SortableList';
import { ImageUploader } from '@client/components/media/ImageUploader';
import { useCompany } from '@client/app/tenant-context';
import { deleteImages, mediaUrl } from '@client/lib/media';
import { cn } from '@client/lib/utils';
import type { BranchRow } from '@client/features/content/api';
import { useProductOptions } from './api';

export type ItemForm = UseFormReturn<CatalogItemInput, unknown, CatalogItemValues>;
type Name = FieldPath<CatalogItemInput>;

/** Los `<input type="number">` trabajan con texto; el esquema lo convierte a número. */
const asText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Reordenar un field array con los ids que entrega SortableList (un solo movimiento). */
function moveByIds(ids: string[], fields: { id: string }[], move: (from: number, to: number) => void) {
  const first = fields.findIndex((f, i) => f.id !== ids[i]);
  if (first < 0) return;
  let last = fields.length - 1;
  while (last > first && fields[last]?.id === ids[last]) last--;
  if (ids[last] === fields[first]?.id) move(first, last);
  else move(last, first);
}

function TextField({
  form,
  name,
  label,
  description,
  placeholder,
  type = 'text',
  inputMode,
  suffix,
  className,
}: {
  form: ItemForm;
  name: Name;
  label: string;
  description?: string;
  placeholder?: string;
  type?: 'text' | 'number';
  inputMode?: 'decimal' | 'numeric';
  suffix?: string;
  className?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <div className="flex items-center gap-2">
            <FormControl>
              <Input
                type={type}
                inputMode={inputMode}
                placeholder={placeholder}
                min={type === 'number' ? 0 : undefined}
                step={inputMode === 'decimal' ? 'any' : undefined}
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                value={asText(field.value)}
                onChange={(e) => field.onChange(e.target.value)}
              />
            </FormControl>
            {suffix && <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span>}
          </div>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SwitchField({ form, name, label, hint }: { form: ItemForm; name: Name; label: string; hint: string }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <FormLabel>{label}</FormLabel>
            <FormDescription>{hint}</FormDescription>
          </div>
          <FormControl>
            <Switch checked={field.value === true} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

function SectionEmpty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      <Icon className="size-6" aria-hidden />
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

export function GeneralSection({ form, kind }: { form: ItemForm; kind: CatalogKind }) {
  const company = useCompany();
  const [preview, setPreview] = useState(false);
  const description = useWatch({ control: form.control, name: 'description' });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardContent className="grid items-start gap-4 sm:grid-cols-2">
          <TextField form={form} name="name" label="Nombre" className="sm:col-span-2" />
          <TextField
            form={form}
            name="reference"
            label="Referencia (opcional)"
            placeholder={kind === 'service' ? 'SRV-001' : 'PRD-001'}
            description="Código interno único, p. ej. SKU."
          />
          <TextField
            form={form}
            name="price"
            label={`Precio (${company.currency})`}
            type="number"
            inputMode="decimal"
            placeholder="0"
          />
          <TextField
            form={form}
            name="short_description"
            label="Descripción corta"
            description="Una línea que se ve en el listado del sitio (máx. 200)."
            className="sm:col-span-2"
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <div className="flex items-center justify-between gap-2">
                  <FormLabel>Descripción larga</FormLabel>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={preview ? 'ghost' : 'secondary'}
                      aria-pressed={!preview}
                      onClick={() => setPreview(false)}
                    >
                      Escribir
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={preview ? 'secondary' : 'ghost'}
                      aria-pressed={preview}
                      onClick={() => setPreview(true)}
                    >
                      Vista previa
                    </Button>
                  </div>
                </div>
                {preview ? (
                  <div className="min-h-32 rounded-md border p-3">
                    {description ? (
                      <Markdown>{description}</Markdown>
                    ) : (
                      <p className="text-sm text-muted-foreground">Sin descripción.</p>
                    )}
                  </div>
                ) : (
                  <FormControl>
                    <Textarea rows={6} {...field} value={asText(field.value)} />
                  </FormControl>
                )}
                <FormDescription>
                  Admite Markdown: **negrita**, *cursiva*, listas con «-» y enlaces [texto](https://…).
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </CardContent>
      </Card>

      {kind === 'service' ? (
        <Card>
          <CardHeader>
            <CardTitle>Tiempo y capacidad</CardTitle>
            <CardDescription>Se usan para calcular los horarios disponibles.</CardDescription>
          </CardHeader>
          <CardContent className="grid items-start gap-4 sm:grid-cols-2">
            <TextField
              form={form}
              name="duration_minutes"
              label="Duración"
              type="number"
              inputMode="numeric"
              suffix="min"
            />
            <TextField
              form={form}
              name="capacity"
              label="Capacidad simultánea"
              type="number"
              inputMode="numeric"
              description="Cuántas reservas a la misma hora (p. ej. sillas o cabinas)."
            />
            <TextField
              form={form}
              name="buffer_before_minutes"
              label="Preparación antes"
              type="number"
              inputMode="numeric"
              suffix="min"
            />
            <TextField
              form={form}
              name="buffer_after_minutes"
              label="Limpieza después"
              type="number"
              inputMode="numeric"
              suffix="min"
              description="Tiempo bloqueado que el cliente no ve."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Venta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SwitchField
              form={form}
              name="allow_in_booking"
              label="Se puede añadir dentro de una reserva"
              hint="Aparece como opción al reservar los servicios a los que lo asocies."
            />
            <TextField
              form={form}
              name="stock"
              label="Stock (opcional)"
              type="number"
              inputMode="numeric"
              description="Déjalo vacío si no llevas inventario. Con 0 no se ofrece en las reservas."
              className="max-w-xs"
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Visibilidad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SwitchField
            form={form}
            name="is_active"
            label="Activo"
            hint="Si está inactivo no se muestra ni se reserva."
          />
          <SwitchField
            form={form}
            name="is_featured"
            label="Destacado"
            hint="Se muestra primero en la página principal del sitio."
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalles
// ---------------------------------------------------------------------------

export function DetailsSection({ form }: { form: ItemForm }) {
  const details = useFieldArray({ control: form.control, name: 'details' });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Detalles</CardTitle>
        <CardDescription>
          Lista de lo que incluye o sus características, p. ej. «Incluye: toalla caliente».
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {details.fields.length === 0 ? (
          <SectionEmpty icon={PlusIcon} text="Sin detalles." />
        ) : (
          <SortableList
            items={details.fields}
            label={(item) => `detalle ${details.fields.findIndex((f) => f.id === item.id) + 1}`}
            onReorder={(ids) => moveByIds(ids, details.fields, details.move)}
            renderItem={(item, handle) => {
              const index = details.fields.findIndex((f) => f.id === item.id);
              return (
                <div className="flex items-start gap-2 rounded-lg border bg-card p-2" data-testid="detail-row">
                  <div className="pt-0.5">{handle}</div>
                  <div className="grid flex-1 items-start gap-2 sm:grid-cols-[1fr_1fr]">
                    <TextField
                      form={form}
                      name={`details.${index}.label`}
                      label={`Detalle ${index + 1}`}
                      placeholder="Incluye"
                    />
                    <TextField
                      form={form}
                      name={`details.${index}.value`}
                      label="Valor (opcional)"
                      placeholder="Toalla caliente"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-6"
                    aria-label={`Quitar detalle ${index + 1}`}
                    onClick={() => details.remove(index)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            }}
          />
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={details.fields.length >= MAX_DETAILS}
          onClick={() => details.append({ label: '', value: '' }, { shouldFocus: true })}
        >
          <PlusIcon aria-hidden /> Añadir detalle
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

export function PhotosSection({ form, persisted }: { form: ItemForm; persisted: RefObject<string[]> }) {
  const photos = useFieldArray({ control: form.control, name: 'photos' });
  const values = useWatch({ control: form.control, name: 'photos' });
  const full = photos.fields.length >= MAX_PHOTOS;
  const coverIndex = Math.max(
    0,
    (values ?? []).findIndex((p) => p?.is_cover),
  );

  function setCover(index: number) {
    photos.fields.forEach((_, i) => form.setValue(`photos.${i}.is_cover`, i === index, { shouldDirty: true }));
  }

  function remove(index: number) {
    const path = values?.[index]?.path;
    photos.remove(index);
    // Subida en esta sesión y nunca guardada: se borra ya. Las guardadas, al guardar la ficha.
    if (path && !persisted.current.includes(path)) void deleteImages([path]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fotos</CardTitle>
        <CardDescription>
          Hasta {MAX_PHOTOS}. Arrástralas para ordenarlas; la portada es la que se ve en los listados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {photos.fields.length > 0 && (
          <SortableList
            items={photos.fields}
            label={(item) => `foto ${photos.fields.findIndex((f) => f.id === item.id) + 1}`}
            onReorder={(ids) => moveByIds(ids, photos.fields, photos.move)}
            renderItem={(item, handle) => {
              const index = photos.fields.findIndex((f) => f.id === item.id);
              const isCover = index === coverIndex;
              return (
                <div className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-2" data-testid="photo-row">
                  <div className="flex items-center gap-2">
                    {handle}
                    <img
                      src={mediaUrl(item.path, 'thumb') ?? ''}
                      alt=""
                      className="aspect-[4/3] w-24 rounded-md border object-cover"
                    />
                  </div>
                  <div className="min-w-48 flex-1">
                    <TextField
                      form={form}
                      name={`photos.${index}.alt`}
                      label="Texto alternativo"
                      placeholder="Describe lo que se ve en la foto"
                    />
                  </div>
                  <div className="flex items-center gap-1 sm:mt-6">
                    <Button
                      type="button"
                      size="sm"
                      variant={isCover ? 'secondary' : 'ghost'}
                      aria-pressed={isCover}
                      onClick={() => setCover(index)}
                    >
                      <StarIcon aria-hidden className={cn(isCover && 'fill-current')} />
                      {isCover ? 'Portada' : 'Usar de portada'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar foto ${index + 1}`}
                      onClick={() => remove(index)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>
              );
            }}
          />
        )}
        {full ? (
          <p className="text-sm text-muted-foreground">Llegaste al máximo de {MAX_PHOTOS} fotos.</p>
        ) : (
          <ImageUploader
            value={null}
            entity="catalog"
            aspect={4 / 3}
            label="Foto"
            hint={`${photos.fields.length} de ${MAX_PHOTOS}. Recorte 4:3, se comprime a WebP.`}
            onChange={(path) => {
              if (path) photos.append({ path, alt: '', is_cover: photos.fields.length === 0 }, { shouldFocus: false });
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Descuentos
// ---------------------------------------------------------------------------

const STATUS_VARIANT: Record<DiscountStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  scheduled: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  expired: 'bg-muted text-muted-foreground',
  inactive: 'bg-muted text-muted-foreground',
};

function todayPlus(days: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + days * 86_400_000))
    .split('-');
  return parts.join('-');
}

export function DiscountsSection({ form, branches }: { form: ItemForm; branches: BranchRow[] }) {
  const company = useCompany();
  const discounts = useFieldArray({ control: form.control, name: 'discounts', keyName: 'key' });
  const values = useWatch({ control: form.control, name: 'discounts' });
  const priceInput = useWatch({ control: form.control, name: 'price' });
  const [now] = useState(() => new Date());
  const price = Number(priceInput);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Descuentos</CardTitle>
        <CardDescription>
          Con fecha límite. Si hay varios vigentes, se aplica el que más ahorra. Las fechas son en la zona de la empresa
          ({company.timezone.replace(/_/g, ' ')}).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {discounts.fields.length === 0 && <SectionEmpty icon={PlusIcon} text="Sin descuentos." />}
        {discounts.fields.map((field, index) => {
          const value = values?.[index];
          const parsed = discountFormSchema.safeParse(value);
          const status = parsed.success ? discountStatus(discountToRow(parsed.data, company.timezone), now) : null;
          const preview =
            parsed.success && Number.isFinite(price) && price > 0
              ? effectivePrice(
                  { price },
                  {
                    discount: { ...discountToRow(parsed.data, company.timezone), id: 'preview' },
                    currency: company.currency,
                  },
                )
              : null;
          return (
            <div key={field.key} className="space-y-3 rounded-lg border p-3" data-testid="discount-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Descuento {index + 1}</span>
                  {status && (
                    <Badge variant="secondary" className={STATUS_VARIANT[status]}>
                      {DISCOUNT_STATUS_LABELS[status]}
                    </Badge>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Quitar descuento ${index + 1}`}
                  onClick={() => discounts.remove(index)}
                >
                  <Trash2Icon aria-hidden /> Quitar
                </Button>
              </div>
              <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <TextField
                  form={form}
                  name={`discounts.${index}.label`}
                  label="Etiqueta (opcional)"
                  placeholder="Promo de temporada"
                />
                <FormField
                  control={form.control}
                  name={`discounts.${index}.type`}
                  render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Tipo</FormLabel>
                      <Select value={f.value} onValueChange={f.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="percent">Porcentaje (%)</SelectItem>
                          <SelectItem value="fixed">Valor fijo ({company.currency})</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <TextField
                  form={form}
                  name={`discounts.${index}.value`}
                  label="Valor"
                  type="number"
                  inputMode="decimal"
                  suffix={value?.type === 'percent' ? '%' : company.currency}
                />
                <FormField
                  control={form.control}
                  name={`discounts.${index}.starts_on`}
                  render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Desde (opcional)</FormLabel>
                      <FormControl>
                        <Input type="date" {...f} value={f.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`discounts.${index}.ends_on`}
                  render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Fecha límite</FormLabel>
                      <FormControl>
                        <Input type="date" {...f} value={f.value ?? ''} />
                      </FormControl>
                      <FormDescription>Incluye todo ese día.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`discounts.${index}.branch_id`}
                  render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Sede</FormLabel>
                      <Select value={f.value ?? 'all'} onValueChange={(v) => f.onChange(v === 'all' ? null : v)}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="all">Todas las sedes</SelectItem>
                          {branches.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <FormField
                  control={form.control}
                  name={`discounts.${index}.is_active`}
                  render={({ field: f }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl>
                        <Switch checked={f.value} onCheckedChange={f.onChange} />
                      </FormControl>
                      <FormLabel className="!mt-0">Activo</FormLabel>
                    </FormItem>
                  )}
                />
                {preview && (
                  <p className="text-sm" data-testid="discount-preview">
                    <span className="text-muted-foreground">Precio con este descuento: </span>
                    <s className="text-muted-foreground">
                      {formatMoney(preview.base, company.currency, company.locale)}
                    </s>{' '}
                    <strong className="tabular-nums">
                      {formatMoney(preview.final, company.currency, company.locale)}
                    </strong>
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={discounts.fields.length >= MAX_DISCOUNTS}
          onClick={() =>
            discounts.append({
              label: '',
              type: 'percent',
              value: '10',
              starts_on: '',
              ends_on: todayPlus(7, company.timezone),
              branch_id: null,
              is_active: true,
            })
          }
        >
          <PlusIcon aria-hidden /> Añadir descuento
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Productos del servicio
// ---------------------------------------------------------------------------

export function ProductsSection({ form }: { form: ItemForm }) {
  const options = useProductOptions();
  const products = useFieldArray({ control: form.control, name: 'products' });
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map((options.data ?? []).map((p) => [p.id, p])), [options.data]);
  const selected = new Set(products.fields.map((f) => f.product_id));
  const available = (options.data ?? []).filter((p) => p.is_active && !selected.has(p.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Productos que se ofrecen al reservar</CardTitle>
        <CardDescription>
          El cliente podrá añadirlos a la reserva de este servicio. Solo se muestran los que tengan activo «Se puede
          añadir dentro de una reserva».
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {products.fields.length === 0 ? (
          <SectionEmpty icon={PlusIcon} text="Ningún producto asociado." />
        ) : (
          <SortableList
            items={products.fields}
            label={(item) => byId.get(item.product_id)?.name ?? 'producto'}
            onReorder={(ids) => moveByIds(ids, products.fields, products.move)}
            renderItem={(item, handle) => {
              const index = products.fields.findIndex((f) => f.id === item.id);
              const product = byId.get(item.product_id);
              const warning = !product
                ? 'Producto no encontrado.'
                : !product.is_active
                  ? 'Producto inactivo: no se mostrará al reservar.'
                  : !product.allow_in_booking
                    ? 'No tiene «Se puede añadir dentro de una reserva»: no se mostrará al reservar.'
                    : null;
              return (
                <div
                  className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-2"
                  data-testid="product-row"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    {handle}
                    <div className="min-w-0 pt-1.5">
                      <p className="truncate font-medium">{product?.name ?? '—'}</p>
                      {warning && (
                        <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          {warning}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="w-36">
                    <TextField
                      form={form}
                      name={`products.${index}.max_quantity`}
                      label="Máx. por reserva"
                      type="number"
                      inputMode="numeric"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="sm:mt-6"
                    aria-label={`Quitar ${product?.name ?? 'producto'}`}
                    onClick={() => products.remove(index)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            }}
          />
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={options.isPending}>
              <PlusIcon aria-hidden /> Añadir producto
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput placeholder="Buscar producto…" />
              <CommandList>
                <CommandEmpty>
                  {(options.data ?? []).length === 0 ? 'Aún no tienes productos.' : 'No hay más productos activos.'}
                </CommandEmpty>
                <CommandGroup>
                  {available.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.name} ${p.reference ?? ''}`}
                      onSelect={() => {
                        products.append({ product_id: p.id, max_quantity: '1' });
                        setOpen(false);
                        if (!p.allow_in_booking)
                          toast.warning(`«${p.name}» no se mostrará al reservar hasta que lo permitas.`);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{p.name}</p>
                        {!p.allow_in_booking && (
                          <p className="text-xs text-muted-foreground">No se muestra al reservar</p>
                        )}
                      </div>
                      <CheckIcon className="size-4 opacity-0" aria-hidden />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sedes (solo si alguna tiene catálogo propio)
// ---------------------------------------------------------------------------

export function BranchesSection({ form, branches }: { form: ItemForm; branches: BranchRow[] }) {
  const company = useCompany();
  const rows = useWatch({ control: form.control, name: 'branches' });
  const index = new Map((rows ?? []).map((r, i) => [r?.branch_id, i]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sedes</CardTitle>
        <CardDescription>
          Las sedes con catálogo propio eligen qué ofrecen y pueden tener su propio precio. Las demás incluyen todo el
          catálogo activo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {branches.map((b) => {
          const i = index.get(b.id);
          return (
            <div
              key={b.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              data-testid="branch-row"
            >
              <div className="min-w-40 flex-1">
                <p className="font-medium">{b.name}</p>
                {!b.is_active && <p className="text-xs text-muted-foreground">Sede inactiva</p>}
              </div>
              {i === undefined ? (
                <Badge variant="secondary">Incluido automáticamente</Badge>
              ) : (
                <>
                  <FormField
                    control={form.control}
                    name={`branches.${i}.is_active`}
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2">
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="!mt-0">Disponible en esta sede</FormLabel>
                      </FormItem>
                    )}
                  />
                  <div className="w-44">
                    <TextField
                      form={form}
                      name={`branches.${i}.price_override`}
                      label={`Precio en la sede (${company.currency})`}
                      type="number"
                      inputMode="decimal"
                      placeholder="El general"
                    />
                  </div>
                </>
              )}
            </div>
          );
        })}
        <Alert>
          <AlertTriangleIcon aria-hidden />
          <AlertDescription>
            Para elegir el catálogo de una sede de una vez, ve a Sedes → «Catálogo de la sede».
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
