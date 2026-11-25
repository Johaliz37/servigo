import { useState } from 'react';
import { CalendarIcon, XIcon } from 'lucide-react';
import { useFormContext } from 'react-hook-form';
import { formatAnswer, type AnswerValue, type BookingField, type FieldAnswer } from '@shared/booking-fields';
import { Button } from '@client/components/ui/button';
import { Calendar } from '@client/components/ui/calendar';
import { Checkbox } from '@client/components/ui/checkbox';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@client/components/ui/form';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@client/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Textarea } from '@client/components/ui/textarea';
import { cn } from '@client/lib/utils';

/** Opción "sin respuesta" de un select opcional (Radix no admite value vacío). */
const NONE = '__none__';

function RequiredMark() {
  return (
    <>
      <span aria-hidden className="text-destructive">
        *
      </span>
      <span className="sr-only">(obligatorio)</span>
    </>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function fromDay(day: unknown): Date | undefined {
  const m = typeof day === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

/**
 * Campos de información adicional dentro de un formulario de react-hook-form (fase 07 §3).
 * Cada respuesta vive en `${name}.${field.id}`; valida con `buildAnswersSchema(fields)`.
 * Lo usan la vista previa del constructor, la reserva (fase 10) y la gestión (fase 11).
 */
export function DynamicFields({
  fields,
  name = 'answers',
  className,
}: {
  fields: readonly BookingField[];
  name?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-5', className)}>
      {fields.map((f) => (
        <DynamicField key={f.id} field={f} path={`${name}.${f.id}`} />
      ))}
    </div>
  );
}

function DynamicField({ field: def, path }: { field: BookingField; path: string }) {
  const { control } = useFormContext();
  const help = def.help_text ? <FormDescription>{def.help_text}</FormDescription> : null;

  return (
    <FormField
      control={control}
      name={path}
      render={({ field }) => {
        // Check: la etiqueta va al lado de la casilla.
        if (def.type === 'checkbox') {
          return (
            <FormItem className="flex flex-row items-start gap-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value === true}
                  onCheckedChange={(v) => field.onChange(v === true)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  className="mt-0.5"
                />
              </FormControl>
              <div className="space-y-1">
                <FormLabel className="leading-snug font-normal">
                  {def.label} {def.required && <RequiredMark />}
                </FormLabel>
                {help}
                <FormMessage />
              </div>
            </FormItem>
          );
        }

        const value = field.value as unknown;
        return (
          <FormItem>
            <FormLabel>
              {def.label} {def.required && <RequiredMark />}
            </FormLabel>
            {def.type === 'text' && (
              <FormControl>
                <Input
                  {...field}
                  value={typeof value === 'string' ? value : ''}
                  placeholder={def.placeholder ?? undefined}
                  maxLength={def.validation.maxLength}
                />
              </FormControl>
            )}
            {def.type === 'textarea' && (
              <FormControl>
                <Textarea
                  {...field}
                  rows={3}
                  value={typeof value === 'string' ? value : ''}
                  placeholder={def.placeholder ?? undefined}
                  maxLength={def.validation.maxLength}
                />
              </FormControl>
            )}
            {def.type === 'number' && (
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  className="max-w-48"
                  value={value === undefined || value === null ? '' : String(value)}
                  placeholder={def.placeholder ?? undefined}
                  min={def.validation.min}
                  max={def.validation.max}
                />
              </FormControl>
            )}
            {def.type === 'select' && (
              <Select
                value={typeof value === 'string' && value ? value : def.required ? '' : NONE}
                onValueChange={(v) => field.onChange(v === NONE ? '' : v)}
              >
                <FormControl>
                  <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full sm:max-w-sm">
                    <SelectValue placeholder={def.placeholder || 'Elige una opción'} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {!def.required && <SelectItem value={NONE}>Sin respuesta</SelectItem>}
                  {def.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {def.type === 'radio' && (
              <FormControl>
                <RadioGroup
                  ref={field.ref}
                  value={typeof value === 'string' ? value : ''}
                  onValueChange={field.onChange}
                  className="gap-2"
                >
                  {def.options.map((o) => (
                    <div key={o.value} className="flex items-center gap-2">
                      <RadioGroupItem value={o.value} id={`${path}-${o.value}`} />
                      <Label htmlFor={`${path}-${o.value}`} className="font-normal">
                        {o.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </FormControl>
            )}
            {def.type === 'multiselect' && (
              <FormControl>
                <div role="group" ref={field.ref} tabIndex={-1} className="space-y-2 outline-none">
                  {def.options.map((o) => {
                    const list = Array.isArray(value) ? (value as string[]) : [];
                    const checked = list.includes(o.value);
                    return (
                      <div key={o.value} className="flex items-center gap-2">
                        <Checkbox
                          id={`${path}-${o.value}`}
                          checked={checked}
                          onCheckedChange={(v) =>
                            field.onChange(v === true ? [...list, o.value] : list.filter((x) => x !== o.value))
                          }
                        />
                        <Label htmlFor={`${path}-${o.value}`} className="font-normal">
                          {o.label}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </FormControl>
            )}
            {def.type === 'date' && (
              <DateInput
                value={value}
                onChange={field.onChange}
                fieldRef={field.ref}
                placeholder={def.placeholder}
                clearable={!def.required}
              />
            )}
            {help}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

function DateInput({
  value,
  onChange,
  fieldRef,
  placeholder,
  clearable,
}: {
  value: unknown;
  onChange: (v: string) => void;
  fieldRef: (el: HTMLButtonElement | null) => void;
  placeholder: string | null;
  clearable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = fromDay(value);
  const thisYear = new Date().getFullYear();
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <FormControl>
            <Button
              ref={fieldRef}
              type="button"
              variant="outline"
              className={cn('w-full justify-start font-normal sm:w-56', !selected && 'text-muted-foreground')}
            >
              <CalendarIcon aria-hidden />
              {selected ? formatAnswer({ type: 'date', value: toDay(selected) }) : placeholder || 'Elige una fecha'}
            </Button>
          </FormControl>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            captionLayout="dropdown"
            startMonth={new Date(thisYear - 100, 0)}
            endMonth={new Date(thisYear + 5, 11)}
            onSelect={(d) => {
              onChange(d ? toDay(d) : '');
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {clearable && selected && (
        <Button type="button" variant="ghost" size="icon" aria-label="Quitar fecha" onClick={() => onChange('')}>
          <XIcon />
        </Button>
      )}
    </div>
  );
}

/**
 * Respuestas guardadas en modo lectura (confirmación de la reserva y detalle en el panel).
 * `fields` (opcional) aporta los textos actuales de las opciones; sin ellos se muestra el value.
 */
export function AnswersView({
  answers,
  fields = [],
  className,
}: {
  answers: readonly Pick<FieldAnswer, 'field_id' | 'label' | 'type' | 'value'>[];
  fields?: readonly BookingField[];
  className?: string;
}) {
  if (answers.length === 0) return null;
  return (
    <dl className={cn('grid gap-3 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]', className)}>
      {answers.map((a, i) => {
        const options = fields.find((f) => f.id === a.field_id)?.options ?? [];
        return (
          <div key={a.field_id ?? i} className="contents">
            <dt className="text-muted-foreground">{a.label}</dt>
            <dd className="font-medium break-words whitespace-pre-line">
              {formatAnswer({ type: a.type, value: a.value as AnswerValue }, options)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
