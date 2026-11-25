import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ClipboardListIcon,
  CopyIcon,
  FilesIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  buildAnswersSchema,
  defaultAnswers,
  FIELD_TYPE_INFO,
  FIELD_TYPES,
  fieldsForService,
  type BookingField,
  type FieldType,
} from '@shared/booking-fields';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@client/components/ui/alert-dialog';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/components/ui/dropdown-menu';
import { Form } from '@client/components/ui/form';
import { Label } from '@client/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Switch } from '@client/components/ui/switch';
import { EmptyState } from '@client/components/common/EmptyState';
import { PageHeader } from '@client/components/common/PageHeader';
import { SortableList } from '@client/components/common/SortableList';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { cn } from '@client/lib/utils';
import { RequireAction } from '@client/features/admin/RequireAction';
import { DynamicFields } from '@client/features/booking/DynamicFields';
import { useReorder } from '@client/features/content/api';
import {
  fieldsKey,
  useBookingFields,
  useCopyFields,
  useDeleteField,
  useDuplicateField,
  useFieldHasAnswers,
  useServiceOptions,
  useToggleField,
} from './api';
import { FieldEditorSheet } from './FieldEditorSheet';
import { FIELD_ICONS } from './field-icons';

export function Component() {
  return (
    <RequireAction action="forms.edit">
      <FormsBuilder />
    </RequireAction>
  );
}

const GENERAL = 'general';

function FormsBuilder() {
  const company = useCompany();
  const fields = useBookingFields();
  const services = useServiceOptions();
  const [params, setParams] = useSearchParams();
  const reorder = useReorder('booking_fields', fieldsKey(company.id));
  const toggle = useToggleField();
  const duplicate = useDuplicateField();
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<{ field: BookingField } | { type: FieldType } | null>(null);
  const [deleting, setDeleting] = useState<BookingField | null>(null);
  const [copying, setCopying] = useState(false);

  const all = useMemo(() => fields.data ?? [], [fields.data]);
  const serviceList = services.data ?? [];
  const requested = params.get('servicio');
  const serviceId = requested && serviceList.some((s) => s.id === requested) ? requested : null;
  const service = serviceList.find((s) => s.id === serviceId) ?? null;
  const scopeName = service ? `Servicio: ${service.name}` : 'Campos generales (todas las reservas)';
  // Se muestran en el orden de la caché (ya viene por sort_order): así el arrastre se ve al instante.
  const scoped = all.filter((f) => f.service_id === serviceId);
  const countFor = (id: string | null) => all.filter((f) => f.service_id === id).length;

  if (fields.isPending || services.isPending) return <FullPageSpinner />;
  if (fields.isError) throw fields.error;
  if (services.isError) throw services.error;

  function selectScope(id: string | null) {
    setParams(id ? { servicio: id } : {}, { replace: true });
  }

  return (
    <>
      <PageHeader
        title="Información adicional"
        description="Lo que el cliente responde al reservar: preguntas para todas las reservas o solo para un servicio."
      />

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] 2xl:grid-cols-[14rem_minmax(0,1fr)_minmax(0,24rem)]">
        {/* Alcance: generales o un servicio */}
        <nav aria-label="Grupos de campos" className="lg:sticky lg:top-20 lg:self-start">
          <div className="lg:hidden">
            <Label htmlFor="forms-scope" className="mb-2">
              Campos de
            </Label>
            <Select value={serviceId ?? GENERAL} onValueChange={(v) => selectScope(v === GENERAL ? null : v)}>
              <SelectTrigger id="forms-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GENERAL}>Generales ({countFor(null)})</SelectItem>
                {serviceList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({countFor(s.id)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="hidden space-y-4 lg:block">
            <ScopeButton active={serviceId === null} count={countFor(null)} onClick={() => selectScope(null)}>
              Campos generales
            </ScopeButton>
            <div className="space-y-1">
              <p className="px-2 text-xs font-medium text-muted-foreground">Por servicio</p>
              {serviceList.length === 0 && <p className="px-2 text-sm text-muted-foreground">Aún no hay servicios.</p>}
              {serviceList.map((s) => (
                <ScopeButton
                  key={s.id}
                  active={serviceId === s.id}
                  count={countFor(s.id)}
                  onClick={() => selectScope(s.id)}
                >
                  {s.name}
                  {!s.is_active && <span className="text-xs text-muted-foreground"> (inactivo)</span>}
                </ScopeButton>
              ))}
            </div>
          </div>
        </nav>

        {/* Constructor */}
        <section aria-labelledby="builder-title" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="builder-title" className="text-lg font-semibold">
                {service ? service.name : 'Campos generales'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {service
                  ? 'Se piden después de los generales, solo al reservar este servicio.'
                  : 'Se piden en todas las reservas, antes de los del servicio.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setCopying(true)}>
                <FilesIcon aria-hidden /> Copiar de…
              </Button>
              <Button onClick={() => setPicking(true)}>
                <PlusIcon aria-hidden /> Añadir campo
              </Button>
            </div>
          </div>

          {scoped.length === 0 ? (
            <EmptyState
              icon={ClipboardListIcon}
              title={service ? `${service.name} no tiene campos propios` : 'Sin campos generales'}
              description={
                service
                  ? 'Al reservarlo solo se piden los campos generales.'
                  : 'Añade preguntas como «¿Cómo nos conociste?» o «Acepto las políticas».'
              }
            />
          ) : (
            <SortableList
              items={scoped}
              label={(f) => f.label}
              disabled={reorder.isPending}
              onReorder={(ids) => reorder.mutate(ids, { onError: (e) => toast.error(messageOf(e)) })}
              renderItem={(f, handle) => {
                const Icon = FIELD_ICONS[f.type];
                return (
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-lg border bg-card p-3',
                      !f.is_active && 'opacity-70',
                    )}
                    data-testid="field-card"
                  >
                    {handle}
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-medium hover:underline"
                        onClick={() => setEditing({ field: f })}
                      >
                        {f.label}
                      </button>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{FIELD_TYPE_INFO[f.type].label}</span>
                        {f.options.length > 0 && <span>· {f.options.length} opciones</span>}
                        {f.required && <Badge variant="outline">Obligatorio</Badge>}
                        {!f.is_active && <Badge variant="secondary">Inactivo</Badge>}
                      </div>
                    </div>
                    <Switch
                      checked={f.is_active}
                      aria-label={`${f.label} activo`}
                      onCheckedChange={(active) =>
                        toggle.mutate({ id: f.id, active }, { onError: (e) => toast.error(messageOf(e)) })
                      }
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Acciones de ${f.label}`}>
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing({ field: f })}>
                          <PencilIcon aria-hidden /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            duplicate.mutate(f, {
                              onSuccess: () => toast.success('Campo duplicado'),
                              onError: (e) => toast.error(messageOf(e)),
                            })
                          }
                        >
                          <CopyIcon aria-hidden /> Duplicar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(f)}>
                          <Trash2Icon aria-hidden /> Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              }}
            />
          )}
        </section>

        {/* Vista previa: lo que verá el cliente (mismo componente del sitio). */}
        <aside
          aria-label="Vista previa"
          className="lg:col-start-2 2xl:sticky 2xl:top-20 2xl:col-start-auto 2xl:self-start"
        >
          <Preview all={all} serviceId={serviceId} serviceName={service?.name ?? null} />
        </aside>
      </div>

      <TypePicker
        open={picking}
        onOpenChange={setPicking}
        onPick={(type) => {
          setPicking(false);
          setEditing({ type });
        }}
      />
      <FieldEditorSheet target={editing} serviceId={serviceId} scopeName={scopeName} onClose={() => setEditing(null)} />
      <DeleteFieldDialog field={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
      <CopyFieldsDialog
        open={copying}
        onOpenChange={setCopying}
        target={serviceId}
        sources={[
          { id: null, name: 'Campos generales', count: all.filter((f) => f.service_id === null && f.is_active).length },
          ...serviceList.map((s) => ({
            id: s.id,
            name: s.name,
            count: all.filter((f) => f.service_id === s.id && f.is_active).length,
          })),
        ].filter((s) => s.id !== serviceId && s.count > 0)}
      />
    </>
  );
}

function ScopeButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
        active && 'bg-muted font-medium',
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}</span>
    </button>
  );
}

function Preview({
  all,
  serviceId,
  serviceName,
}: {
  all: BookingField[];
  serviceId: string | null;
  serviceName: string | null;
}) {
  const fields = fieldsForService(all, serviceId);
  // Otra configuración de campos = otro formulario (estado limpio).
  const signature = JSON.stringify(fields);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vista previa</CardTitle>
        <CardDescription>
          {serviceName
            ? `Así lo verá quien reserve «${serviceName}»: generales y luego los del servicio.`
            : 'Así lo verá quien reserve un servicio sin campos propios.'}{' '}
          Solo campos activos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No se pedirá información adicional.</p>
        ) : (
          <PreviewForm key={signature} fields={fields} />
        )}
      </CardContent>
    </Card>
  );
}

function PreviewForm({ fields }: { fields: BookingField[] }) {
  // Misma forma que el formulario de reserva: las respuestas viven en `answers`.
  const schema = useMemo(() => z.object({ answers: buildAnswersSchema(fields) }), [fields]);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { answers: defaultAnswers(fields) },
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => toast.success('Todo correcto: así se enviaría la reserva.'))}
        className="space-y-5"
        noValidate
        data-testid="fields-preview"
      >
        <DynamicFields fields={fields} />
        <Button type="submit" variant="secondary" className="w-full">
          Probar validación
        </Button>
      </form>
    </Form>
  );
}

function TypePicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (type: FieldType) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>¿Qué tipo de campo?</DialogTitle>
          <DialogDescription>Elige cómo responderá el cliente. El tipo no se puede cambiar después.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-2 overflow-y-auto sm:grid-cols-2">
          {FIELD_TYPES.map((type) => {
            const Icon = FIELD_ICONS[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => onPick(type)}
                className="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span>
                  <span className="block font-medium">{FIELD_TYPE_INFO[type].label}</span>
                  <span className="block text-sm text-muted-foreground">{FIELD_TYPE_INFO[type].description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Eliminar: si ya tiene respuestas, se ofrece inactivarlo (la BD tampoco deja borrarlo). */
function DeleteFieldDialog({
  field,
  onOpenChange,
}: {
  field: BookingField | null;
  onOpenChange: (open: boolean) => void;
}) {
  const hasAnswers = useFieldHasAnswers(field?.id ?? null);
  const remove = useDeleteField();
  const toggle = useToggleField();
  const pending = remove.isPending || toggle.isPending;

  function run(promise: Promise<unknown>, ok: string) {
    promise.then(
      () => {
        toast.success(ok);
        onOpenChange(false);
      },
      (e: unknown) => toast.error(messageOf(e)),
    );
  }

  return (
    <AlertDialog open={!!field} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar «{field?.label}»?</AlertDialogTitle>
          <AlertDialogDescription>
            {hasAnswers.isPending
              ? 'Comprobando si ya tiene respuestas…'
              : hasAnswers.data
                ? 'Este campo ya tiene respuestas en reservas, así que no se puede eliminar. Puedes inactivarlo: deja de pedirse y las respuestas se conservan.'
                : 'Deja de pedirse en las reservas nuevas. No se puede deshacer.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          {hasAnswers.data ? (
            <Button
              disabled={pending || !field?.is_active}
              onClick={() => field && run(toggle.mutateAsync({ id: field.id, active: false }), 'Campo inactivado')}
            >
              {field?.is_active ? 'Inactivar' : 'Ya está inactivo'}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={pending || hasAnswers.isPending || hasAnswers.isError}
              onClick={() => field && run(remove.mutateAsync(field.id), 'Campo eliminado')}
            >
              Eliminar
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CopyFieldsDialog({
  open,
  onOpenChange,
  target,
  sources,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: string | null;
  sources: { id: string | null; name: string; count: number }[];
}) {
  const copy = useCopyFields();
  const [source, setSource] = useState<string>('');
  const selected = sources.find((s) => (s.id ?? GENERAL) === source) ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (copy.isPending) return;
        onOpenChange(o);
        if (!o) setSource('');
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copiar campos</DialogTitle>
          <DialogDescription>
            Se añaden al final, como copias independientes. Solo se copian los activos.
          </DialogDescription>
        </DialogHeader>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay otros grupos con campos activos para copiar.</p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="copy-source">Copiar de</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger id="copy-source" className="w-full">
                <SelectValue placeholder="Elige de dónde copiar" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id ?? GENERAL} value={s.id ?? GENERAL}>
                    {s.name} ({s.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={copy.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={!selected || copy.isPending}
            onClick={() =>
              selected &&
              copy.mutate(
                { from: selected.id, to: target },
                {
                  onSuccess: (n) => {
                    toast.success(`Se copiaron ${n as number} campos`);
                    onOpenChange(false);
                    setSource('');
                  },
                  onError: (e) => toast.error(messageOf(e)),
                },
              )
            }
          >
            {copy.isPending ? 'Copiando…' : 'Copiar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
