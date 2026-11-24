import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangleIcon } from 'lucide-react';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { toast } from 'sonner';
import { brandContrast, companyProfileSchema, type CompanyProfile, type CompanyProfileInput } from '@shared/content';
import { readableForeground } from '@shared/color';
import { Alert, AlertDescription, AlertTitle } from '@client/components/ui/alert';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/components/ui/card';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Textarea } from '@client/components/ui/textarea';
import { PageHeader } from '@client/components/common/PageHeader';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { TimezoneCombobox } from '@client/components/common/TimezoneCombobox';
import { ImageUploader } from '@client/components/media/ImageUploader';
import { messageOf } from '@client/lib/errors';
import { cleanupReplaced, mediaUrl } from '@client/lib/media';
import { RequireAction } from '@client/features/admin/RequireAction';
import { useCompanyRecord, useUpdateCompany, type CompanyRow } from '@client/features/content/api';

const CURRENCIES = ['COP', 'MXN', 'PEN', 'USD', 'CLP', 'ARS', 'EUR'];
const LOCALES: [string, string][] = [
  ['es-CO', 'Español (Colombia)'],
  ['es-MX', 'Español (México)'],
  ['es-PE', 'Español (Perú)'],
  ['es-CL', 'Español (Chile)'],
  ['es-AR', 'Español (Argentina)'],
  ['es-EC', 'Español (Ecuador)'],
  ['es-ES', 'Español (España)'],
  ['en-US', 'English (US)'],
];

const IMAGE_FIELDS = ['logo_path', 'favicon_path', 'hero_image_path'] as const;

function toForm(row: CompanyRow): CompanyProfileInput {
  const seo = (row.seo ?? {}) as Record<string, unknown>;
  return {
    name: row.name,
    legal_name: row.legal_name ?? '',
    tax_id: row.tax_id ?? '',
    contact_email: row.contact_email ?? '',
    contact_phone: row.contact_phone ?? '',
    whatsapp: row.whatsapp ?? '',
    timezone: row.timezone,
    currency: row.currency,
    locale: row.locale,
    primary_color: row.primary_color,
    secondary_color: row.secondary_color,
    logo_path: row.logo_path,
    favicon_path: row.favicon_path,
    hero_image_path: row.hero_image_path,
    seo: {
      title: typeof seo.title === 'string' ? seo.title : '',
      description: typeof seo.description === 'string' ? seo.description : '',
      image_path: typeof seo.image_path === 'string' ? seo.image_path : null,
    },
  };
}

export function Component() {
  return (
    <RequireAction action="company.edit">
      <CompanyProfile />
    </RequireAction>
  );
}

function CompanyProfile() {
  const record = useCompanyRecord();
  if (record.isPending) return <FullPageSpinner />;
  if (record.isError) throw record.error;
  return <ProfileForm row={record.data} />;
}

function ProfileForm({ row }: { row: CompanyRow }) {
  const update = useUpdateCompany();
  const form = useForm<CompanyProfileInput, unknown, CompanyProfile>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: toForm(row),
  });

  // Si llega una versión nueva de la fila (otra pestaña), se recarga el formulario.
  useEffect(() => form.reset(toForm(row)), [row, form]);

  async function submit(values: CompanyProfile) {
    try {
      const saved = await update.mutateAsync({ patch: values });
      await cleanupReplaced(
        [...IMAGE_FIELDS.map((f) => row[f]), toForm(row).seo.image_path],
        [...IMAGE_FIELDS.map((f) => saved[f]), values.seo.image_path],
      );
      toast.success('Cambios guardados. El sitio público ya los muestra.');
    } catch (error) {
      toast.error(messageOf(error));
    }
  }

  return (
    <>
      <PageHeader title="Empresa" description="Datos, marca y cómo se ve tu sitio al compartirlo." />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} className="max-w-3xl space-y-6" noValidate>
          <Card>
            <CardHeader>
              <CardTitle>Datos</CardTitle>
              <CardDescription>Se muestran en el sitio y en las reservas.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="name" label="Nombre comercial" className="sm:col-span-2" />
              <TextField control={form.control} name="legal_name" label="Razón social" />
              <TextField control={form.control} name="tax_id" label="NIT / identificación" />
              <TextField control={form.control} name="contact_email" label="Correo de contacto" type="email" />
              <TextField control={form.control} name="contact_phone" label="Teléfono" type="tel" />
              <TextField
                control={form.control}
                name="whatsapp"
                label="WhatsApp"
                type="tel"
                description="Con indicativo, p. ej. +57 300 123 4567"
              />
              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Zona horaria</FormLabel>
                    <FormControl>
                      <TimezoneCombobox value={field.value} onChange={(z) => field.onChange(z ?? 'America/Bogota')} />
                    </FormControl>
                    <FormDescription>Las sedes la usan salvo que definan la suya.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Moneda</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="locale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Idioma y formato</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {LOCALES.map(([value, text]) => (
                          <SelectItem key={value} value={value}>
                            {text}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Formato de fechas y precios.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Marca</CardTitle>
              <CardDescription>Logo, colores e imagen principal del sitio.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <ImageField control={form.control} name="logo_path" label="Logo" aspect={1} />
                <ImageField
                  control={form.control}
                  name="favicon_path"
                  label="Ícono de pestaña"
                  aspect={1}
                  hint="Cuadrado y simple: se ve muy pequeño."
                />
              </div>
              <ImageField
                control={form.control}
                name="hero_image_path"
                label="Imagen principal"
                aspect={16 / 9}
                hint="Portada del inicio del sitio (16:9)."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <ColorField control={form.control} name="primary_color" label="Color primario" />
                <ColorField control={form.control} name="secondary_color" label="Color secundario" />
              </div>
              <BrandPreview control={form.control} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Al compartir</CardTitle>
              <CardDescription>Título, descripción e imagen en buscadores, WhatsApp y redes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <TextField control={form.control} name="seo.title" label="Título" description="Hasta 70 caracteres." />
              <FormField
                control={form.control}
                name="seo.description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción</FormLabel>
                    <FormControl>
                      <Textarea rows={3} {...field} />
                    </FormControl>
                    <FormDescription>Hasta 160 caracteres.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <ImageField
                control={form.control}
                name="seo.image_path"
                label="Imagen para compartir"
                aspect={1.91}
                hint="Horizontal (1200 × 630 aprox.)."
              />
            </CardContent>
          </Card>

          <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur">
            <Button
              type="button"
              variant="outline"
              disabled={!form.formState.isDirty || form.formState.isSubmitting}
              onClick={() => form.reset(toForm(row))}
            >
              Descartar
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
}

type Ctl = Control<CompanyProfileInput, unknown, CompanyProfile>;
type TextName = 'name' | 'legal_name' | 'tax_id' | 'contact_email' | 'contact_phone' | 'whatsapp' | 'seo.title';

function TextField({
  control,
  name,
  label,
  description,
  type = 'text',
  className,
}: {
  control: Ctl;
  name: TextName;
  label: string;
  description?: string;
  type?: string;
  className?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={type} {...field} value={field.value ?? ''} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ImageField({
  control,
  name,
  label,
  aspect,
  hint,
}: {
  control: Ctl;
  name: 'logo_path' | 'favicon_path' | 'hero_image_path' | 'seo.image_path';
  label: string;
  aspect?: number;
  hint?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <ImageUploader
            value={field.value ?? null}
            onChange={field.onChange}
            entity="company"
            label={label}
            aspect={aspect}
            hint={hint}
          />
        </FormItem>
      )}
    />
  );
}

function ColorField({
  control,
  name,
  label,
}: {
  control: Ctl;
  name: 'primary_color' | 'secondary_color';
  label: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`${label} (selector)`}
              value={field.value ?? '#000000'}
              onChange={(e) => field.onChange(e.target.value.toUpperCase())}
              className="h-9 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
            />
            <FormControl>
              <Input
                value={field.value ?? ''}
                placeholder="#1F4E79"
                maxLength={7}
                onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value.toUpperCase())}
              />
            </FormControl>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Vista previa en vivo del encabezado y el botón con los colores elegidos (sin guardar). */
function BrandPreview({ control }: { control: Ctl }) {
  const [primary, secondary, name, logo] = useWatch({
    control,
    name: ['primary_color', 'secondary_color', 'name', 'logo_path'],
  });
  const valid = (c: string | null | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null);
  const p = valid(primary) ?? '#171717';
  const s = valid(secondary);
  const contrast = brandContrast(valid(primary));
  const logoUrl = mediaUrl(logo);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Vista previa</p>
      <div className="overflow-hidden rounded-lg border bg-white text-neutral-900">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="size-8 rounded object-contain" />
          ) : (
            <span
              className="flex size-8 items-center justify-center rounded font-semibold"
              style={{ background: p, color: readableForeground(p) }}
            >
              {(name || 'E').charAt(0).toUpperCase()}
            </span>
          )}
          <span className="font-semibold">{name || 'Tu empresa'}</span>
          <span className="ml-auto text-sm font-medium" style={{ color: p }}>
            Acerca de
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-5">
          <span
            className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
            style={{ background: p, color: readableForeground(p) }}
          >
            Reservar
          </span>
          {s && (
            <span
              className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
              style={{ background: s, color: readableForeground(s) }}
            >
              Ver servicios
            </span>
          )}
          <span className="text-sm font-medium underline underline-offset-4" style={{ color: p }}>
            Consultar mi reserva
          </span>
        </div>
      </div>
      {contrast && !contrast.passesAA && (
        <Alert>
          <AlertTriangleIcon aria-hidden />
          <AlertTitle>Este color se ve poco sobre fondo blanco</AlertTitle>
          <AlertDescription>
            Contraste {contrast.onWhite.toFixed(1)}:1 (mínimo recomendado 3:1). Los botones se leen bien, pero los
            enlaces y títulos en este color costarán de ver. Prueba un tono más oscuro.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
