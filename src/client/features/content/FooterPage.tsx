import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { footerSchema, parseFooter, type Footer } from '@shared/content';
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
import { Switch } from '@client/components/ui/switch';
import { Textarea } from '@client/components/ui/textarea';
import { Markdown } from '@client/components/common/Markdown';
import { INLINE_ELEMENTS } from '@client/components/common/markdown-elements';
import { PageHeader } from '@client/components/common/PageHeader';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { RequireAction } from '@client/features/admin/RequireAction';
import { useCompanyRecord, useUpdateCompany } from './api';

type FormInput = z.input<typeof footerSchema>;

export function Component() {
  return (
    <RequireAction action="company.edit">
      <FooterScreen />
    </RequireAction>
  );
}

function FooterScreen() {
  const record = useCompanyRecord();
  if (record.isPending) return <FullPageSpinner />;
  if (record.isError) throw record.error;
  return <FooterForm initial={parseFooter(record.data.footer)} />;
}

function FooterForm({ initial }: { initial: Footer }) {
  const update = useUpdateCompany();
  const form = useForm<FormInput, unknown, Footer>({ resolver: zodResolver(footerSchema), defaultValues: initial });
  const links = useFieldArray({ control: form.control, name: 'links' });
  useEffect(() => form.reset(initial), [initial, form]);

  async function submit(values: Footer) {
    try {
      await update.mutateAsync({ patch: { footer: values }, purge: false });
      toast.success('Pie de página guardado');
    } catch (error) {
      toast.error(messageOf(error));
    }
  }

  return (
    <>
      <PageHeader title="Pie de página" description="Lo que aparece al final de todas las páginas de tu sitio." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-6" noValidate>
            <Card>
              <CardHeader>
                <CardTitle>Texto y dirección</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="text"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Texto</FormLabel>
                      <FormControl>
                        <Textarea rows={3} {...field} />
                      </FormControl>
                      <FormDescription>
                        Admite **negrita**, *cursiva* y enlaces: [texto](https://…). Máximo 500 caracteres.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dirección</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Enlaces</CardTitle>
                <CardDescription>Por ejemplo, políticas de privacidad o tu sitio web (máx. 10).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {links.fields.length === 0 && <p className="text-sm text-muted-foreground">Sin enlaces.</p>}
                <ul className="space-y-3">
                  {links.fields.map((link, index) => (
                    <li key={link.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1.5fr_auto]">
                      <FormField
                        control={form.control}
                        name={`links.${index}.label`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="sr-only">Texto del enlace {index + 1}</FormLabel>
                            <FormControl>
                              <Input placeholder="Texto" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`links.${index}.url`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="sr-only">URL del enlace {index + 1}</FormLabel>
                            <FormControl>
                              <Input placeholder="https://… o /ruta" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex items-start gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Subir enlace ${index + 1}`}
                          disabled={index === 0}
                          onClick={() => links.move(index, index - 1)}
                        >
                          <ArrowUpIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Bajar enlace ${index + 1}`}
                          disabled={index === links.fields.length - 1}
                          onClick={() => links.move(index, index + 1)}
                        >
                          <ArrowDownIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Quitar enlace ${index + 1}`}
                          onClick={() => links.remove(index)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={links.fields.length >= 10}
                  onClick={() => links.append({ label: '', url: '' })}
                >
                  <PlusIcon aria-hidden /> Añadir enlace
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Opciones</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(
                  [
                    ['show_socials', 'Mostrar redes sociales', 'Los íconos configurados en Redes sociales.'],
                    ['show_powered_by', 'Mostrar “Hecho con Servigo”', 'Un enlace discreto a Servigo.'],
                  ] as const
                ).map(([name, label, hint]) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem className="flex items-start justify-between gap-4 rounded-lg border p-3">
                        <div className="space-y-1">
                          <FormLabel>{label}</FormLabel>
                          <FormDescription>{hint}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ))}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </div>
          </form>
        </Form>
        <FooterPreview control={form.control} />
      </div>
    </>
  );
}

function FooterPreview({ control }: { control: ReturnType<typeof useForm<FormInput, unknown, Footer>>['control'] }) {
  const company = useCompany();
  const values = useWatch({ control });
  return (
    <aside aria-label="Vista previa" className="xl:sticky xl:top-20 xl:self-start">
      <p className="mb-2 text-sm font-medium">Vista previa</p>
      <div className="rounded-lg border bg-muted/40 px-5 py-6 text-sm text-muted-foreground">
        <div className="space-y-3">
          <p className="font-semibold text-foreground">{company.name}</p>
          {values.text ? <Markdown allowed={INLINE_ELEMENTS}>{values.text}</Markdown> : null}
          {values.address ? <p>{values.address}</p> : null}
          {values.links && values.links.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {values.links.map((l, i) => (
                <li key={i} className="underline underline-offset-4">
                  {l?.label || 'Enlace'}
                </li>
              ))}
            </ul>
          )}
          {values.show_socials !== false && <p className="text-xs">[ íconos de redes sociales ]</p>}
        </div>
        <div className="mt-6 flex flex-wrap justify-between gap-2 border-t pt-4 text-xs">
          <span>
            © {new Date().getFullYear()} {company.name}
          </span>
          {values.show_powered_by !== false && <span>Hecho con Servigo</span>}
        </div>
      </div>
    </aside>
  );
}
