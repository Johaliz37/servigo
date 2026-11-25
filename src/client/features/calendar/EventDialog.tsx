import { useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckIcon } from 'lucide-react';
import { useForm, useWatch, type FieldNamesMarkedBoolean } from 'react-hook-form';
import { z } from 'zod';
import { dayStartInstant, localDate, wallToInstant } from '@shared/availability';
import type { EventPatch, EventRow, OccurrenceRef } from '@shared/calendar';
import { formatInTimeZone } from '@shared/format';
import {
  buildRule,
  describeRule,
  parseRule,
  repeatOptions,
  WEEKDAY_CHIPS,
  WEEKDAY_NAMES,
  WEEKDAYS,
  type CustomRepeat,
  type RepeatPreset,
} from '@shared/recurrence';
import { Button } from '@client/components/ui/button';
import { Checkbox } from '@client/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@client/components/ui/form';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Switch } from '@client/components/ui/switch';
import { Textarea } from '@client/components/ui/textarea';
import { cn } from '@client/lib/utils';
import type { CalendarService } from './api';
import { addDays, EVENT_COLORS, KIND_COLORS, KIND_LABELS } from './model';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const POSITIVE = /^[1-9]\d*$/;

const schema = z
  .object({
    kind: z.enum(['open', 'closed']),
    title: z.string().trim().max(200, { error: 'Máximo 200 caracteres' }),
    notes: z.string().max(2000, { error: 'Máximo 2000 caracteres' }),
    color: z.string().nullable(),
    allDay: z.boolean(),
    startDate: z.iso.date({ error: 'Fecha no válida' }),
    startTime: z.string(),
    endDate: z.iso.date({ error: 'Fecha no válida' }),
    endTime: z.string(),
    repeat: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly', 'weekdays', 'custom']),
    freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
    interval: z.string().regex(POSITIVE, { error: 'Número entero mayor que 0' }),
    byDay: z.array(z.enum(WEEKDAYS)),
    endType: z.enum(['never', 'until', 'count']),
    until: z.string(),
    count: z.string(),
    servicesMode: z.enum(['all', 'some']),
    serviceIds: z.array(z.string()),
    capacity: z.string().refine((v) => v === '' || (POSITIVE.test(v) && Number(v) <= 1000), {
      error: 'Entre 1 y 1000, o vacío',
    }),
  })
  .superRefine((v, ctx) => {
    if (!v.allDay) {
      if (!TIME.test(v.startTime)) ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Hora no válida' });
      if (!TIME.test(v.endTime)) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Hora no válida' });
    }
    const start = v.allDay ? v.startDate : `${v.startDate}T${v.startTime}`;
    const end = v.allDay ? v.endDate : `${v.endDate}T${v.endTime}`;
    if (v.allDay ? end < start : end <= start) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'El fin debe ser posterior al inicio' });
    }
    if (v.repeat === 'custom') {
      if (v.endType === 'until' && !(v.until >= v.startDate)) {
        ctx.addIssue({ code: 'custom', path: ['until'], message: 'Debe ser igual o posterior al inicio' });
      }
      if (v.endType === 'count' && !(POSITIVE.test(v.count) && Number(v.count) <= 999)) {
        ctx.addIssue({ code: 'custom', path: ['count'], message: 'Entre 1 y 999' });
      }
      if (v.freq === 'WEEKLY' && v.byDay.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['byDay'], message: 'Elige al menos un día' });
      }
    }
    if (v.servicesMode === 'some' && v.serviceIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['serviceIds'], message: 'Elige al menos un servicio' });
    }
  });

type Values = z.infer<typeof schema>;

export type DialogTarget = { mode: 'create'; draft: EventRow } | { mode: 'edit'; row: EventRow; occ: OccurrenceRef };

export interface DialogResult {
  /** Fila completa resultante (para crear). */
  fields: EventPatch & Pick<EventRow, 'kind' | 'starts_at' | 'ends_at'>;
  /** Solo lo que el usuario cambió (para editar una ocurrencia). */
  changed: EventPatch;
  /** ¿Cambió la repetición? (entonces «Este evento» no aplica). */
  repeatChanged: boolean;
}

function toValues(row: EventRow, start: number, end: number): Values {
  const tz = row.timezone;
  const startDate = localDate(start, tz);
  const { preset, custom } = parseRule(row.rrule, startDate, tz);
  return {
    kind: row.kind,
    title: row.title,
    notes: row.notes ?? '',
    color: row.color,
    allDay: row.all_day,
    startDate,
    startTime: formatInTimeZone(start, tz, 'HH:mm'),
    endDate: row.all_day ? addDays(localDate(end, tz), -1) : localDate(end, tz),
    endTime: formatInTimeZone(end, tz, 'HH:mm'),
    repeat: preset,
    freq: custom.freq,
    interval: String(custom.interval),
    byDay: custom.byDay,
    endType: custom.end.type,
    until: custom.end.type === 'until' ? custom.end.date : addDays(startDate, 30),
    count: custom.end.type === 'count' ? String(custom.end.count) : '10',
    servicesMode: row.service_ids?.length ? 'some' : 'all',
    serviceIds: row.service_ids ?? [],
    capacity: row.capacity_override ? String(row.capacity_override) : '',
  };
}

function customOf(v: Values): CustomRepeat {
  return {
    freq: v.freq,
    interval: Number(v.interval),
    byDay: v.byDay,
    end:
      v.endType === 'until'
        ? { type: 'until', date: v.until }
        : v.endType === 'count'
          ? { type: 'count', count: Number(v.count) }
          : { type: 'never' },
  };
}

function toResult(v: Values, tz: string, dirty: Partial<FieldNamesMarkedBoolean<Values>>): DialogResult {
  const at = (date: string, time: string) =>
    new Date(wallToInstant(Date.parse(`${date}T${time}:00Z`), tz)).toISOString();
  const starts_at = v.allDay ? new Date(dayStartInstant(v.startDate, tz)).toISOString() : at(v.startDate, v.startTime);
  const ends_at = v.allDay
    ? new Date(dayStartInstant(addDays(v.endDate, 1), tz)).toISOString()
    : at(v.endDate, v.endTime);
  const fields: DialogResult['fields'] = {
    kind: v.kind,
    title: v.title.trim(),
    notes: v.notes.trim() || null,
    color: v.color,
    all_day: v.allDay,
    starts_at,
    ends_at,
    rrule: buildRule(v.repeat as RepeatPreset, customOf(v), v.startDate, tz),
    service_ids: v.servicesMode === 'all' ? null : v.serviceIds,
    capacity_override: v.capacity ? Number(v.capacity) : null,
  };
  const repeatChanged = !!(
    dirty.repeat ||
    (v.repeat === 'custom' &&
      (dirty.freq || dirty.interval || dirty.byDay || dirty.endType || dirty.until || dirty.count))
  );
  const timesChanged = !!(dirty.allDay || dirty.startDate || dirty.startTime || dirty.endDate || dirty.endTime);
  const changed: EventPatch = {};
  if (dirty.kind) changed.kind = fields.kind;
  if (dirty.title) changed.title = fields.title;
  if (dirty.notes) changed.notes = fields.notes;
  if (dirty.color) changed.color = fields.color;
  if (timesChanged) Object.assign(changed, { all_day: fields.all_day, starts_at, ends_at });
  if (repeatChanged) changed.rrule = fields.rrule;
  if (dirty.servicesMode || dirty.serviceIds) changed.service_ids = fields.service_ids;
  if (dirty.capacity) changed.capacity_override = fields.capacity_override;
  return { fields, changed, repeatChanged };
}

/** Diálogo completo del evento («Más opciones»). */
export function EventDialog({
  target,
  services,
  onClose,
  onSubmit,
}: {
  target: DialogTarget | null;
  services: CalendarService[];
  onClose: () => void;
  onSubmit: (result: DialogResult) => Promise<boolean>;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {target && (
          <DialogBody
            key={target.mode === 'edit' ? target.row.id : target.draft.id}
            target={target}
            services={services}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  target,
  services,
  onClose,
  onSubmit,
}: {
  target: DialogTarget;
  services: CalendarService[];
  onClose: () => void;
  onSubmit: (result: DialogResult) => Promise<boolean>;
}) {
  const row = target.mode === 'edit' ? target.row : target.draft;
  const tz = row.timezone;
  const defaults = useMemo(
    () =>
      target.mode === 'edit'
        ? toValues(target.row, target.occ.start, target.occ.end)
        : toValues(target.draft, Date.parse(target.draft.starts_at), Date.parse(target.draft.ends_at)),
    [target],
  );
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });
  const v = useWatch({ control: form.control }) as Values;

  async function submit(values: Values) {
    const ok = await onSubmit(toResult(values, tz, form.formState.dirtyFields));
    if (ok) onClose();
  }

  const preview =
    v.repeat === 'none' ? null : describeRule(buildRule(v.repeat, customOf(v), v.startDate, tz), v.startDate, tz);

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(submit)(e)} noValidate>
        <DialogHeader className="border-b p-4 sm:p-6">
          <DialogTitle>{target.mode === 'edit' ? 'Editar horario' : 'Nuevo horario'}</DialogTitle>
          <DialogDescription>Las horas están en la zona de la sede ({tz}).</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 p-4 sm:p-6">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Título</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={`Añade un título (p. ej. ${KIND_LABELS[v.kind]})`}
                    className="text-base"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="kind"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo</FormLabel>
                <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-2 gap-2">
                  {(['open', 'closed'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={field.value === kind}
                      onClick={() => field.onChange(kind)}
                      className={cn(
                        'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                        field.value === kind ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-muted',
                      )}
                    >
                      <span className="size-3 rounded-full" style={{ background: KIND_COLORS[kind] }} aria-hidden />
                      {KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="allDay"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3">
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel>Todo el día</FormLabel>
              </FormItem>
            )}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Inicio</legend>
              <div className="flex gap-2">
                <DateTimeInput form={form} name="startDate" type="date" label="Fecha de inicio" />
                {!v.allDay && <DateTimeInput form={form} name="startTime" type="time" label="Hora de inicio" />}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Fin</legend>
              <div className="flex gap-2">
                <DateTimeInput form={form} name="endDate" type="date" label="Fecha de fin" />
                {!v.allDay && <DateTimeInput form={form} name="endTime" type="time" label="Hora de fin" />}
              </div>
            </fieldset>
          </div>

          <FormField
            control={form.control}
            name="repeat"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Repetir</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {repeatOptions(v.startDate || defaults.startDate).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {preview && (
                  <p className="text-sm text-muted-foreground" data-testid="rrule-text">
                    {preview}
                  </p>
                )}
              </FormItem>
            )}
          />

          {v.repeat === 'custom' && <CustomRepeatFields form={form} values={v} />}

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Aplica a</legend>
            <FormField
              control={form.control}
              name="servicesMode"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full" aria-label="Servicios a los que aplica">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los servicios</SelectItem>
                    <SelectItem value="some">Solo algunos servicios</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {v.servicesMode === 'some' && (
              <FormField
                control={form.control}
                name="serviceIds"
                render={({ field }) => (
                  <FormItem>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {services.map((s) => (
                        <Label key={s.id} className="flex items-center gap-2 font-normal">
                          <Checkbox
                            checked={field.value.includes(s.id)}
                            onCheckedChange={(on) =>
                              field.onChange(on ? [...field.value, s.id] : field.value.filter((x) => x !== s.id))
                            }
                          />
                          {s.name}
                        </Label>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </fieldset>

          {v.kind === 'open' && (
            <FormField
              control={form.control}
              name="capacity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capacidad en esta ventana (opcional)</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="numeric" placeholder="La del servicio" className="w-40" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Color</FormLabel>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
                  <ColorSwatch
                    color={KIND_COLORS[v.kind]}
                    label="Color del tipo"
                    selected={field.value === null}
                    onSelect={() => field.onChange(null)}
                  />
                  {EVENT_COLORS.map((c) => (
                    <ColorSwatch
                      key={c.value}
                      color={c.value}
                      label={c.label}
                      selected={field.value === c.value}
                      onSelect={() => field.onChange(c.value)}
                    />
                  ))}
                </div>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notas</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={3} placeholder="Solo las ve tu equipo" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <DialogFooter className="border-t p-4 sm:px-6">
          <Button type="button" variant="outline" onClick={onClose} disabled={form.formState.isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

type FormApi = ReturnType<typeof useForm<Values>>;

function DateTimeInput({
  form,
  name,
  type,
  label,
}: {
  form: FormApi;
  name: 'startDate' | 'startTime' | 'endDate' | 'endTime';
  type: 'date' | 'time';
  label: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={type === 'date' ? 'flex-1' : 'w-28'}>
          <FormLabel className="sr-only">{label}</FormLabel>
          <FormControl>
            <Input {...field} type={type} step={type === 'time' ? 300 : undefined} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function CustomRepeatFields({ form, values }: { form: FormApi; values: Values }) {
  return (
    <fieldset className="space-y-4 rounded-lg border p-4" aria-label="Repetición personalizada">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">Repetir cada</span>
        <FormField
          control={form.control}
          name="interval"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input {...field} inputMode="numeric" className="w-16" aria-label="Intervalo" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="freq"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-32" aria-label="Frecuencia">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DAILY">{values.interval === '1' ? 'día' : 'días'}</SelectItem>
                <SelectItem value="WEEKLY">{values.interval === '1' ? 'semana' : 'semanas'}</SelectItem>
                <SelectItem value="MONTHLY">{values.interval === '1' ? 'mes' : 'meses'}</SelectItem>
                <SelectItem value="YEARLY">{values.interval === '1' ? 'año' : 'años'}</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {values.freq === 'WEEKLY' && (
        <FormField
          control={form.control}
          name="byDay"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Se repite el</FormLabel>
              <div className="flex gap-1.5">
                {WEEKDAYS.map((d) => {
                  const on = field.value.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      aria-label={WEEKDAY_NAMES[d]}
                      onClick={() => field.onChange(on ? field.value.filter((x) => x !== d) : [...field.value, d])}
                      className={cn(
                        'size-8 rounded-full text-xs font-medium transition-colors',
                        on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70',
                      )}
                    >
                      {WEEKDAY_CHIPS[d]}
                    </button>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <FormField
        control={form.control}
        name="endType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Termina</FormLabel>
            <div className="space-y-2" role="radiogroup" aria-label="Termina">
              {(['never', 'until', 'count'] as const).map((type) => (
                <div key={type} className="flex min-h-9 items-center gap-3">
                  <Label className="flex w-24 items-center gap-2 font-normal">
                    <input
                      type="radio"
                      name="endType"
                      className="accent-primary"
                      checked={field.value === type}
                      onChange={() => field.onChange(type)}
                    />
                    {type === 'never' ? 'Nunca' : type === 'until' ? 'El' : 'Tras'}
                  </Label>
                  {type === 'until' && (
                    <FormField
                      control={form.control}
                      name="until"
                      render={({ field: f }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...f} type="date" disabled={field.value !== 'until'} aria-label="Termina el" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {type === 'count' && (
                    <FormField
                      control={form.control}
                      name="count"
                      render={({ field: f }) => (
                        <FormItem className="flex items-center gap-2">
                          <FormControl>
                            <Input
                              {...f}
                              inputMode="numeric"
                              className="w-20"
                              disabled={field.value !== 'count'}
                              aria-label="Número de veces"
                            />
                          </FormControl>
                          <span className="text-sm text-muted-foreground">veces</span>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              ))}
            </div>
          </FormItem>
        )}
      />
    </fieldset>
  );
}

function ColorSwatch({
  color,
  label,
  selected,
  onSelect,
}: {
  color: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className="flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      style={{ background: color }}
    >
      {selected && <CheckIcon className="size-4 text-white" aria-hidden />}
    </button>
  );
}
