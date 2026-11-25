import { zodResolver } from '@hookform/resolvers/zod';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { toast } from 'sonner';
import {
  editorToRow,
  emptyFieldEditor,
  FIELD_TYPE_INFO,
  fieldEditorSchema,
  fieldToEditor,
  isListType,
  MAX_OPTIONS,
  optionValue,
  TEXT_TYPES,
  type BookingField,
  type FieldEditorInput,
  type FieldEditorValues,
  type FieldType,
} from '@shared/booking-fields';
import { Badge } from '@client/components/ui/badge';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@client/components/ui/sheet';
import { Switch } from '@client/components/ui/switch';
import { SortableList } from '@client/components/common/SortableList';
import { messageOf } from '@client/lib/errors';
import { useSaveField } from './api';
import { FIELD_ICONS } from './field-icons';

type Target = { field: BookingField } | { type: FieldType };
type Name = FieldPath<FieldEditorInput>;

/** Panel lateral para crear o editar un campo. El cuerpo se monta en cada apertura. */
export function FieldEditorSheet({
  target,
  serviceId,
  scopeName,
  onClose,
}: {
  target: Target | null;
  serviceId: string | null;
  scopeName: string;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        {target && (
          <EditorBody
            key={'field' in target ? target.field.id : `new-${target.type}`}
            target={target}
            serviceId={serviceId}
            scopeName={scopeName}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function EditorBody({
  target,
  serviceId,
  scopeName,
  onClose,
}: {
  target: Target;
  serviceId: string | null;
  scopeName: string;
  onClose: () => void;
}) {
  const existing = 'field' in target ? target.field : null;
  const type = existing?.type ?? (target as { type: FieldType }).type;
  const save = useSaveField();
  const form = useForm<FieldEditorInput, unknown, FieldEditorValues>({
    resolver: zodResolver(fieldEditorSchema),
    defaultValues: existing ? fieldToEditor(existing) : emptyFieldEditor(type),
  });
  const Icon = FIELD_ICONS[type];
  const info = FIELD_TYPE_INFO[type];

  async function submit(values: FieldEditorValues) {
    // value estable: las opciones nuevas lo generan de su texto; las existentes lo conservan.
    const used: string[] = values.options.map((o) => o.value).filter(Boolean);
    const options = values.options.map((o) => {
      if (o.value) return o;
      const value = optionValue(o.label, used);
      used.push(value);
      return { ...o, value };
    });
    try {
      await save.mutateAsync({ id: existing?.id, serviceId, row: editorToRow({ ...values, options }) });
      toast.success(existing ? 'Campo guardado' : 'Campo añadido');
      onClose();
    } catch (error) {
      form.setError('root', { message: messageOf(error) });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-1 flex-col" noValidate>
        <SheetHeader className="border-b">
          <SheetTitle>{existing ? 'Editar campo' : 'Nuevo campo'}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Icon className="size-3.5" aria-hidden /> {info.label}
            </Badge>
            <span>{scopeName}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <TextField form={form} name="label" label="Pregunta o etiqueta" placeholder={examplePlaceholder(type)} />
          <TextField
            form={form}
            name="help_text"
            label="Texto de ayuda (opcional)"
            description="Se muestra debajo del campo."
          />
          {['text', 'textarea', 'number', 'select'].includes(type) && (
            <TextField
              form={form}
              name="placeholder"
              label="Texto de ejemplo (opcional)"
              description="Aparece dentro del campo vacío."
            />
          )}

          {isListType(type) && <OptionsEditor form={form} />}

          {TEXT_TYPES.includes(type) && (
            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">Validación</legend>
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <TextField form={form} name="minLength" label="Mínimo de caracteres" type="number" />
                <TextField form={form} name="maxLength" label="Máximo de caracteres" type="number" />
              </div>
              <TextField
                form={form}
                name="pattern"
                label="Formato (expresión regular, opcional)"
                placeholder="[A-Z]{3}[0-9]{3}"
                description="Para usuarios avanzados. Debe cubrir todo el valor; p. ej. [0-9]+ = solo números."
              />
              <TextField
                form={form}
                name="patternMessage"
                label="Mensaje si el formato no coincide"
                placeholder="Escribe la placa como ABC123"
              />
            </fieldset>
          )}
          {(type === 'number' || type === 'multiselect') && (
            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">Validación</legend>
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <TextField
                  form={form}
                  name="min"
                  label={type === 'number' ? 'Valor mínimo' : 'Mínimo de opciones'}
                  type="number"
                />
                <TextField
                  form={form}
                  name="max"
                  label={type === 'number' ? 'Valor máximo' : 'Máximo de opciones'}
                  type="number"
                />
              </div>
            </fieldset>
          )}

          <div className="space-y-3">
            <SwitchField
              form={form}
              name="required"
              label="Obligatorio"
              hint={
                type === 'checkbox'
                  ? 'El cliente debe marcar la casilla para reservar.'
                  : 'No se puede reservar sin responderlo.'
              }
            />
            <SwitchField form={form} name="is_active" label="Activo" hint="Si está inactivo no se pide al reservar." />
          </div>

          {form.formState.errors.root && (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}
        </div>

        <SheetFooter className="flex-row justify-end border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={form.formState.isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Guardando…' : existing ? 'Guardar campo' : 'Añadir campo'}
          </Button>
        </SheetFooter>
      </form>
    </Form>
  );
}

function examplePlaceholder(type: FieldType): string {
  switch (type) {
    case 'checkbox':
      return 'Acepto las políticas de cancelación';
    case 'radio':
      return 'Presión del masaje';
    case 'multiselect':
      return 'Zonas a trabajar';
    case 'select':
      return '¿Cómo nos conociste?';
    case 'number':
      return 'Número de personas';
    case 'date':
      return 'Fecha de nacimiento';
    default:
      return 'Placa del vehículo';
  }
}

type EditorForm = ReturnType<typeof useForm<FieldEditorInput, unknown, FieldEditorValues>>;

function TextField({
  form,
  name,
  label,
  description,
  placeholder,
  type = 'text',
}: {
  form: EditorForm;
  name: Name;
  label: string;
  description?: string;
  placeholder?: string;
  type?: 'text' | 'number';
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type={type}
              inputMode={type === 'number' ? 'numeric' : undefined}
              placeholder={placeholder}
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={field.value === undefined || field.value === null ? '' : String(field.value)}
              onChange={(e) => field.onChange(e.target.value)}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SwitchField({ form, name, label, hint }: { form: EditorForm; name: Name; label: string; hint: string }) {
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

/** Opciones de una lista: añadir, renombrar, reordenar y quitar. El value no cambia al renombrar. */
function OptionsEditor({ form }: { form: EditorForm }) {
  const options = useFieldArray({ control: form.control, name: 'options' });
  const error = form.formState.errors.options;

  function onReorder(ids: string[]) {
    const from = options.fields.findIndex((f, i) => f.id !== ids[i]);
    if (from < 0) return;
    let to = options.fields.length - 1;
    while (to > from && options.fields[to]?.id === ids[to]) to--;
    if (ids[to] === options.fields[from]?.id) options.move(from, to);
    else options.move(to, from);
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Opciones</legend>
      {options.fields.length > 0 && (
        <SortableList
          items={options.fields}
          label={(item) => `opción ${options.fields.findIndex((f) => f.id === item.id) + 1}`}
          onReorder={onReorder}
          renderItem={(item, handle) => {
            const index = options.fields.findIndex((f) => f.id === item.id);
            return (
              <div className="flex items-start gap-1" data-testid="option-row">
                {handle}
                <FormField
                  control={form.control}
                  name={`options.${index}.label`}
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel className="sr-only">Opción {index + 1}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={`Opción ${index + 1}`} />
                      </FormControl>
                      {item.value && (
                        <FormDescription className="text-xs">
                          Valor guardado: <code>{item.value}</code>
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar opción ${index + 1}`}
                  onClick={() => options.remove(index)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            );
          }}
        />
      )}
      {error?.message && <p className="text-sm text-destructive">{error.message}</p>}
      {error?.root?.message && <p className="text-sm text-destructive">{error.root.message}</p>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={options.fields.length >= MAX_OPTIONS}
        onClick={() => options.append({ value: '', label: '' }, { shouldFocus: true })}
      >
        <PlusIcon aria-hidden /> Añadir opción
      </Button>
      <p className="text-xs text-muted-foreground">Renombrar una opción no afecta las reservas que ya la eligieron.</p>
    </fieldset>
  );
}
