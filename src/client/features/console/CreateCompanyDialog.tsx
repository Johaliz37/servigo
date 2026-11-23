import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2Icon, XCircleIcon } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { slugify } from '@shared/format';
import { createCompanySchema } from '@shared/schemas';
import { isValidSlug } from '@shared/tenant';
import { Button } from '@client/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/components/ui/dialog';
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
import { messageOf } from '@client/lib/errors';
import { ROOT_DOMAIN } from '@client/lib/platform';
import { checkSlug, useCreateCompany, type SlugStatus } from './api';

type Values = z.input<typeof createCompanySchema>;

// Zonas habituales de los clientes; se puede ampliar sin migración (la BD valida cualquier IANA).
const TIMEZONES = [
  'America/Bogota',
  'America/Mexico_City',
  'America/Lima',
  'America/Guayaquil',
  'America/Caracas',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Panama',
  'America/New_York',
  'Europe/Madrid',
];
const CURRENCIES = ['COP', 'MXN', 'PEN', 'USD', 'CLP', 'ARS', 'EUR'];

const SLUG_MESSAGES: Record<SlugStatus, string> = {
  available: 'Disponible',
  taken: 'Ya lo usa otra empresa',
  reserved: 'Reservado por Servigo o Roquintech',
  invalid: 'Formato no válido',
};

/** Estado del slug con validación en vivo (formato local + disponibilidad en la BD, con espera). */
function useSlugStatus(slug: string): SlugStatus | 'checking' | null {
  const [result, setResult] = useState<{ slug: string; status: SlugStatus } | null>(null);
  const valid = isValidSlug(slug);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkSlug(slug)
        .then((status) => !cancelled && setResult({ slug, status }))
        .catch(() => !cancelled && setResult(null));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, valid]);

  if (!slug) return null;
  if (!valid) return 'invalid';
  return result?.slug === slug ? result.status : 'checking';
}

export function CreateCompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateCompany();
  const [slugTouched, setSlugTouched] = useState(false);
  const form = useForm<Values, unknown, z.output<typeof createCompanySchema>>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: { name: '', slug: '', ownerEmail: '', timezone: 'America/Bogota', currency: 'COP' },
  });
  const slug = useWatch({ control: form.control, name: 'slug' });
  const slugStatus = useSlugStatus(slug.trim());

  async function submit(values: z.output<typeof createCompanySchema>) {
    try {
      // Si la verificación en vivo aún no terminó (debounce), se consulta ahora.
      const status = slugStatus === 'checking' ? await checkSlug(values.slug) : slugStatus;
      if (status !== 'available') {
        form.setError('slug', { message: SLUG_MESSAGES[status ?? 'invalid'] });
        return;
      }
      const result = await create.mutateAsync(values);
      const mail =
        result.emailSent === 'none'
          ? 'No se pudo enviar el correo al owner: reenvíalo desde la lista.'
          : `Invitación enviada a ${result.email}.`;
      (result.emailSent === 'none' ? toast.warning : toast.success)(`Empresa creada: ${result.url}. ${mail}`);
      form.reset();
      setSlugTouched(false);
      onOpenChange(false);
    } catch (error) {
      form.setError('root', { message: messageOf(error) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva empresa</DialogTitle>
          <DialogDescription>Se crea con una sede principal y se invita al owner por correo.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form id="create-company" onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
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
                        if (!slugTouched) form.setValue('slug', slugify(e.target.value));
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
                  <FormLabel>Subdominio</FormLabel>
                  <div className="flex items-center gap-2">
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
                    <span className="shrink-0 text-sm text-muted-foreground">.{ROOT_DOMAIN}</span>
                  </div>
                  {slugStatus && slugStatus !== 'checking' && (
                    <p
                      aria-live="polite"
                      className={`flex items-center gap-1 text-sm ${slugStatus === 'available' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}
                    >
                      {slugStatus === 'available' ? (
                        <CheckCircle2Icon className="size-4" aria-hidden />
                      ) : (
                        <XCircleIcon className="size-4" aria-hidden />
                      )}
                      {SLUG_MESSAGES[slugStatus]}
                    </p>
                  )}
                  {slugStatus === 'checking' && <p className="text-sm text-muted-foreground">Verificando…</p>}
                  <FormDescription>3 a 32 caracteres: minúsculas, números y guiones.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ownerEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Correo del owner</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Zona horaria</FormLabel>
                    <Select value={field.value ?? 'America/Bogota'} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz} value={tz}>
                            {tz.replace(/_/g, ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Moneda</FormLabel>
                    <Select value={field.value ?? 'COP'} onValueChange={field.onChange}>
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
                  </FormItem>
                )}
              />
            </div>
            {form.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
          </form>
        </Form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="create-company" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Creando…' : 'Crear empresa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
