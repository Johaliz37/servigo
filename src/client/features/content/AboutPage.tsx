import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { EyeOffIcon, InfoIcon } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { aboutSchema, type AboutValues } from '@shared/content';
import { Alert, AlertDescription } from '@client/components/ui/alert';
import { Button } from '@client/components/ui/button';
import { Card, CardContent } from '@client/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@client/components/ui/tabs';
import { Textarea } from '@client/components/ui/textarea';
import { Markdown } from '@client/components/common/Markdown';
import { PageHeader } from '@client/components/common/PageHeader';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { ImageUploader } from '@client/components/media/ImageUploader';
import { messageOf } from '@client/lib/errors';
import { cleanupReplaced } from '@client/lib/media';
import { RequireAction } from '@client/features/admin/RequireAction';
import { useAboutSections, useBranchesAdmin, useSaveAbout, type AboutRow } from './api';

type FormInput = z.input<typeof aboutSchema>;
const GENERAL = 'general';

export function Component() {
  return (
    <RequireAction action="company.edit">
      <About />
    </RequireAction>
  );
}

function About() {
  const sections = useAboutSections();
  const branches = useBranchesAdmin();
  const [tab, setTab] = useState(GENERAL);

  if (sections.isPending || branches.isPending) return <FullPageSpinner />;
  if (sections.isError) throw sections.error;
  if (branches.isError) throw branches.error;

  const byBranch = new Map(sections.data.map((s) => [s.branch_id ?? GENERAL, s]));
  const anyVisible = sections.data.some((s) => s.is_visible);

  return (
    <>
      <PageHeader
        title="Acerca de"
        description="Cuenta quiénes son. Hay una sección general y, si quieres, una distinta por sede."
      />
      {!anyVisible && (
        <Alert className="mb-4 max-w-3xl">
          <EyeOffIcon aria-hidden />
          <AlertDescription>
            Ninguna sección está visible: el enlace “Acerca de” no aparece en tu sitio.
          </AlertDescription>
        </Alert>
      )}
      <Tabs value={tab} onValueChange={setTab} className="max-w-3xl">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value={GENERAL}>General</TabsTrigger>
          {branches.data.map((b) => (
            <TabsTrigger key={b.id} value={b.id}>
              {b.name}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={GENERAL}>
          <AboutForm key={GENERAL} row={byBranch.get(GENERAL) ?? null} branchId={null} />
        </TabsContent>
        {branches.data.map((b) => (
          <TabsContent key={b.id} value={b.id}>
            <Alert className="mb-4">
              <InfoIcon aria-hidden />
              <AlertDescription>
                Se muestra en la página de {b.name}, aparte de la sección general. Si está oculta, no aparece en esa
                sede.
              </AlertDescription>
            </Alert>
            <AboutForm key={b.id} row={byBranch.get(b.id) ?? null} branchId={b.id} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

function toForm(row: AboutRow | null): FormInput {
  return {
    title: row?.title ?? '',
    body: row?.body ?? '',
    image_path: row?.image_path ?? null,
    is_visible: row?.is_visible ?? false,
  };
}

function AboutForm({ row, branchId }: { row: AboutRow | null; branchId: string | null }) {
  const save = useSaveAbout();
  const [preview, setPreview] = useState(false);
  const form = useForm<FormInput, unknown, AboutValues>({
    resolver: zodResolver(aboutSchema),
    defaultValues: toForm(row),
  });
  useEffect(() => form.reset(toForm(row)), [row, form]);
  const body = useWatch({ control: form.control, name: 'body' }) ?? '';

  async function submit(values: AboutValues) {
    try {
      await save.mutateAsync({ id: row?.id, branchId, values });
      await cleanupReplaced([row?.image_path], [values.image_path]);
      toast.success(values.is_visible ? 'Guardado y visible en el sitio' : 'Guardado (oculto para los clientes)');
    } catch (error) {
      toast.error(messageOf(error));
    }
  }

  return (
    <Card>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="is_visible"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="space-y-1">
                    <FormLabel>Visible para clientes</FormLabel>
                    <FormDescription>Apágalo para preparar el texto sin publicarlo.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título</FormLabel>
                  <FormControl>
                    <Input placeholder="Nuestra historia" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Texto</FormLabel>
                    <div className="flex gap-1 text-sm" role="group" aria-label="Modo del editor">
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
                    <div className="min-h-48 rounded-md border p-3">
                      {body.trim() ? (
                        <Markdown>{body}</Markdown>
                      ) : (
                        <p className="text-sm text-muted-foreground">Nada que mostrar todavía.</p>
                      )}
                    </div>
                  ) : (
                    <FormControl>
                      <Textarea rows={10} className="font-mono text-sm" {...field} />
                    </FormControl>
                  )}
                  <FormDescription>
                    Markdown: ## Subtítulo, **negrita**, *cursiva*, - listas y [enlaces](https://…).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="image_path"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Imagen</FormLabel>
                  <ImageUploader
                    value={field.value ?? null}
                    onChange={field.onChange}
                    entity="about"
                    label="Imagen"
                    aspect={4 / 3}
                  />
                </FormItem>
              )}
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
