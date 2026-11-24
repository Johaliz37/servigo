import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { toast } from 'sonner';
import { branchSchema, parseBranchHeader, type BranchInput, type BranchValues } from '@shared/content';
import { slugify } from '@shared/format';
import { Button } from '@client/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@client/components/ui/form';
import { Input } from '@client/components/ui/input';
import { Separator } from '@client/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@client/components/ui/sheet';
import { Switch } from '@client/components/ui/switch';
import { TimezoneCombobox } from '@client/components/common/TimezoneCombobox';
import { ImageUploader } from '@client/components/media/ImageUploader';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { ROOT_DOMAIN } from '@client/lib/platform';
import { cleanupReplaced, mediaUrl } from '@client/lib/media';
import { useSaveBranch, type BranchRow } from '@client/features/content/api';

const EMPTY: BranchInput = {
  name: '',
  slug: '',
  address: '',
  city: '',
  phone: '',
  whatsapp: '',
  email: '',
  maps_url: '',
  timezone: null,
  cover_image_path: null,
  header: { title: '', subtitle: '', image_path: null, overlay_opacity: 0.4 },
  own_availability: false,
  own_catalog: false,
  show_sponsors: true,
};

function toForm(b: BranchRow | null): BranchInput {
  if (!b) return EMPTY;
  return {
    name: b.name,
    slug: b.slug,
    address: b.address ?? '',
    city: b.city ?? '',
    phone: b.phone ?? '',
    whatsapp: b.whatsapp ?? '',
    email: b.email ?? '',
    maps_url: b.maps_url ?? '',
    timezone: b.timezone,
    cover_image_path: b.cover_image_path,
    header: parseBranchHeader(b.header),
    own_availability: b.own_availability,
    own_catalog: b.own_catalog,
    show_sponsors: b.show_sponsors,
  };
}

/** Alta y edición de una sede (fase 05 §4). El formulario se monta de nuevo en cada apertura. */
export function BranchSheet({
  branch,
  open,
  nextSortOrder,
  onOpenChange,
}: {
  branch: BranchRow | null;
  open: boolean;
  nextSortOrder: number;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {open && (
          <BranchSheetBody
            key={branch?.id ?? 'new'}
            branch={branch}
            nextSortOrder={nextSortOrder}
            onBusy={setBusy}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function BranchSheetBody({
  branch,
  nextSortOrder,
  onBusy,
  onClose,
}: {
  branch: BranchRow | null;
  nextSortOrder: number;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
}) {
  const company = useCompany();
  const save = useSaveBranch();
  const [slugTouched, setSlugTouched] = useState(!!branch);
  const form = useForm<BranchInput, unknown, BranchValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: toForm(branch),
  });

  async function submit(values: BranchValues) {
    onBusy(true);
    try {
      const saved = await save.mutateAsync({ id: branch?.id, values, sortOrder: nextSortOrder });
      if (branch) {
        await cleanupReplaced(
          [branch.cover_image_path, parseBranchHeader(branch.header).image_path],
          [saved.cover_image_path, values.header.image_path],
        );
      }
      if (values.own_catalog && !branch?.own_catalog) {
        toast.success(`${values.name} guardada. Se copiaron los servicios y productos activos a su catálogo.`);
      } else {
        toast.success(`${values.name} guardada`);
      }
      onClose();
    } catch (error) {
      // Slug repetido en la empresa → mensaje en el campo.
      const code = (error as { code?: string }).code;
      if (code === '23505') form.setError('slug', { message: 'Otra sede ya usa esta dirección' });
      else form.setError('root', { message: messageOf(error) });
    } finally {
      onBusy(false);
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{branch ? `Editar ${branch.name}` : 'Nueva sede'}</SheetTitle>
        <SheetDescription>
          Los clientes eligen la sede al entrar a tu sitio ({company.slug}.{ROOT_DOMAIN}).
        </SheetDescription>
      </SheetHeader>
      <Form {...form}>
        <form id="branch-form" onSubmit={form.handleSubmit(submit)} className="space-y-6 px-4" noValidate>
          <section className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(e) => {
                        field.onChange(e);
                        if (!slugTouched) form.setValue('slug', slugify(e.target.value, 64), { shouldValidate: false });
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dirección en el sitio</FormLabel>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <span className="shrink-0">/s/</span>
                    <FormControl>
                      <Input
                        {...field}
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(e) => {
                          setSlugTouched(true);
                          field.onChange(e.target.value.toLowerCase());
                        }}
                      />
                    </FormControl>
                  </div>
                  <FormDescription>Minúsculas, números y guiones. Única en tu empresa.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Text control={form.control} name="address" label="Dirección" />
              <Text control={form.control} name="city" label="Ciudad" />
              <Text control={form.control} name="phone" label="Teléfono" type="tel" />
              <Text control={form.control} name="whatsapp" label="WhatsApp" type="tel" />
              <Text control={form.control} name="email" label="Correo" type="email" />
              <Text
                control={form.control}
                name="maps_url"
                label="Enlace de Google Maps"
                placeholder="https://maps.app.goo.gl/…"
              />
            </div>
            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Zona horaria</FormLabel>
                  <FormControl>
                    <TimezoneCombobox
                      value={field.value}
                      onChange={field.onChange}
                      allowEmpty
                      emptyLabel={`La de la empresa (${company.timezone.replace(/_/g, ' ')})`}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          <Separator />

          <section className="space-y-4">
            <h3 className="font-medium">Imágenes</h3>
            <FormField
              control={form.control}
              name="cover_image_path"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Portada</FormLabel>
                  <ImageUploader
                    value={field.value}
                    onChange={field.onChange}
                    entity="branches"
                    label="Portada"
                    aspect={16 / 9}
                    hint="Se muestra en el selector de sedes del inicio (16:9)."
                  />
                </FormItem>
              )}
            />
            <HeaderFields control={form.control} />
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="font-medium">Funcionamiento</h3>
            <Toggle
              control={form.control}
              name="own_availability"
              label="Disponibilidad propia"
              hint="Si está apagado, esta sede usa el horario general de la empresa."
            />
            <Toggle
              control={form.control}
              name="own_catalog"
              label="Catálogo propio"
              hint="Si está apagado, se ofrecen todos los servicios y productos activos. Al encenderlo la primera vez se copian todos para que partas de ahí."
            />
            <Toggle
              control={form.control}
              name="show_sponsors"
              label="Mostrar sección de patrocinadores"
              hint="En la página de esta sede, si tiene patrocinadores visibles."
            />
          </section>

          {form.formState.errors.root && (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}
        </form>
      </Form>
      <SheetFooter className="flex-row justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={form.formState.isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" form="branch-form" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Guardando…' : 'Guardar sede'}
        </Button>
      </SheetFooter>
    </>
  );
}

type Ctl = Control<BranchInput, unknown, BranchValues>;

function Text({
  control,
  name,
  label,
  type = 'text',
  placeholder,
}: {
  control: Ctl;
  name: 'address' | 'city' | 'phone' | 'whatsapp' | 'email' | 'maps_url';
  label: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={type} placeholder={placeholder} {...field} value={field.value ?? ''} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function Toggle({
  control,
  name,
  label,
  hint,
}: {
  control: Ctl;
  name: 'own_availability' | 'own_catalog' | 'show_sponsors';
  label: string;
  hint: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <FormLabel>{label}</FormLabel>
            <FormDescription>{hint}</FormDescription>
          </div>
          <FormControl>
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

/** Encabezado de la página de la sede: imagen, título, subtítulo y velo, con vista previa. */
function HeaderFields({ control }: { control: Ctl }) {
  const header = useWatch({ control, name: 'header' });
  const name = useWatch({ control, name: 'name' });
  const image = mediaUrl(header?.image_path ?? null);
  const opacity = Number(header?.overlay_opacity ?? 0.4);

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <p className="text-sm font-medium">Encabezado de la página de la sede</p>
      <FormField
        control={control}
        name="header.image_path"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Imagen del encabezado</FormLabel>
            <ImageUploader
              value={field.value ?? null}
              onChange={field.onChange}
              entity="branches"
              label="Imagen del encabezado"
              aspect={16 / 9}
            />
          </FormItem>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="header.title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Título</FormLabel>
              <FormControl>
                <Input placeholder={name || 'Nombre de la sede'} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="header.subtitle"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subtítulo</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={control}
        name="header.overlay_opacity"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Oscurecer imagen ({Math.round(opacity * 100)} %)</FormLabel>
            <FormControl>
              <input
                type="range"
                min={0}
                max={0.9}
                step={0.05}
                value={Number(field.value ?? 0.4)}
                onChange={(e) => field.onChange(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </FormControl>
            <FormDescription>Ayuda a que el texto se lea sobre la imagen.</FormDescription>
          </FormItem>
        )}
      />
      <div
        aria-label="Vista previa del encabezado"
        className="relative flex aspect-[16/6] items-end overflow-hidden rounded-md bg-neutral-800 text-white"
      >
        {image && <img src={image} alt="" className="absolute inset-0 size-full object-cover" />}
        <div className="absolute inset-0 bg-black" style={{ opacity }} />
        <div className="relative p-4">
          <p className="text-lg font-semibold">{header?.title || name || 'Nombre de la sede'}</p>
          {header?.subtitle && <p className="text-sm text-white/85">{header.subtitle}</p>}
        </div>
      </div>
    </div>
  );
}
