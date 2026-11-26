import { useState } from 'react';
import { ExternalLinkIcon, RotateCcwIcon } from 'lucide-react';
import { toast } from 'sonner';
import { parseFooter } from '@shared/content';
import { MAX_PRIVACY_LENGTH, PRIVACY_PATH, privacyTemplate } from '@shared/privacy';
import { Alert, AlertDescription, AlertTitle } from '@client/components/ui/alert';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/components/ui/card';
import { Label } from '@client/components/ui/label';
import { Textarea } from '@client/components/ui/textarea';
import { Markdown } from '@client/components/common/Markdown';
import { PageHeader } from '@client/components/common/PageHeader';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { messageOf } from '@client/lib/errors';
import { RequireAction } from '@client/features/admin/RequireAction';
import { useCompanyRecord, useUpdateCompany, type CompanyRow } from './api';

export function Component() {
  return (
    <RequireAction action="company.edit">
      <PrivacyScreen />
    </RequireAction>
  );
}

function PrivacyScreen() {
  const record = useCompanyRecord();
  if (record.isPending) return <FullPageSpinner />;
  if (record.isError) throw record.error;
  return <PrivacyForm key={record.data.privacy_updated_at ?? 'template'} record={record.data} />;
}

const templateFor = (r: CompanyRow) =>
  privacyTemplate({
    name: r.name,
    email: r.contact_email,
    phone: r.contact_phone,
    address: parseFooter(r.footer).address || null,
  });

/**
 * Política de privacidad (fase 13, D31). Sin texto propio, el sitio muestra la plantilla con
 * los datos de contacto actuales; al guardar, el texto queda fijo hasta volver a la plantilla.
 */
function PrivacyForm({ record }: { record: CompanyRow }) {
  const update = useUpdateCompany();
  const usingTemplate = record.privacy_policy === null;
  const [text, setText] = useState(record.privacy_policy ?? templateFor(record));
  const tooLong = text.length > MAX_PRIVACY_LENGTH;

  async function save(policy: string | null) {
    try {
      await update.mutateAsync({
        patch: { privacy_policy: policy, privacy_updated_at: new Date().toISOString() },
        purge: false,
      });
      toast.success(policy === null ? 'Ahora se usa la plantilla' : 'Política guardada');
    } catch (error) {
      toast.error(messageOf(error));
    }
  }

  return (
    <>
      <PageHeader
        title="Política de privacidad"
        description="Cómo tratas los datos de tus clientes. Se publica en tu sitio y se enlaza en cada reserva."
        actions={
          <Button variant="outline" asChild>
            <a href={PRIVACY_PATH} target="_blank" rel="noopener">
              <ExternalLinkIcon aria-hidden /> Ver en el sitio
            </a>
          </Button>
        }
      />
      <Alert className="mb-6">
        <AlertTitle>{usingTemplate ? 'Estás usando la plantilla' : 'Usas un texto propio'}</AlertTitle>
        <AlertDescription>
          La plantilla sigue la Ley 1581 de 2012 (Colombia) y toma el nombre, correo, teléfono y dirección de tu
          empresa. Es una guía: revísala con tu asesor y ajústala a lo que de verdad haces con los datos.
        </AlertDescription>
      </Alert>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Texto</CardTitle>
            <CardDescription>Markdown: ## Subtítulo, **negrita**, - listas y [enlaces](https://…).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="privacy-text" className="sr-only">
                Texto de la política
              </Label>
              <Textarea
                id="privacy-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={22}
                aria-invalid={tooLong || undefined}
                aria-describedby="privacy-count"
                className="font-mono text-sm"
              />
              <p id="privacy-count" className={tooLong ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                {text.length.toLocaleString('es-CO')} / {MAX_PRIVACY_LENGTH.toLocaleString('es-CO')} caracteres
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save(text.trim())} disabled={update.isPending || tooLong || !text.trim()}>
                {update.isPending ? 'Guardando…' : 'Guardar'}
              </Button>
              {!usingTemplate && (
                <Button variant="outline" onClick={() => void save(null)} disabled={update.isPending}>
                  <RotateCcwIcon aria-hidden /> Volver a la plantilla
                </Button>
              )}
              {usingTemplate && text !== templateFor(record) && (
                <Button variant="ghost" onClick={() => setText(templateFor(record))}>
                  Descartar cambios
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Vista previa</CardTitle>
          </CardHeader>
          <CardContent>
            <Markdown className="text-sm">{text}</Markdown>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
