import { useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { customerSchema } from '@shared/booking';
import { consentLabel, PRIVACY_PATH } from '@shared/privacy';
import { buildAnswersSchema, defaultAnswers, type BookingField } from '@shared/booking-fields';
import { Button } from '@client/components/ui/button';
import { Checkbox } from '@client/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@client/components/ui/form';
import { Input } from '@client/components/ui/input';
import { Textarea } from '@client/components/ui/textarea';
import { DynamicFields } from './DynamicFields';
import type { BookingDraft } from './draft';
import { PhoneField } from './PhoneField';

function detailsSchema(fields: readonly BookingField[], requireEmail: boolean, terms: boolean) {
  return z.object({
    customer: customerSchema.superRefine((c, ctx) => {
      if (requireEmail && !c.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Escribe tu correo' });
    }),
    answers: buildAnswersSchema(fields),
    accept_terms: z.boolean().refine((v) => !terms || v, { error: 'Debes aceptar los términos para reservar' }),
    privacy_consent: z
      .boolean()
      .refine((v) => v, { error: 'Debes autorizar el tratamiento de tus datos para reservar' }),
  });
}

export type DetailsValues = z.output<ReturnType<typeof detailsSchema>>;

/**
 * Paso 4 (fase 10 §1): nombre, teléfono (E.164), correo, notas, información adicional
 * (`DynamicFields` con `buildAnswersSchema`, D25), términos si la empresa los tiene y la
 * autorización de datos, siempre obligatoria (Ley 1581, D31).
 */
export function DetailsStep({
  fields,
  requireEmail,
  termsText,
  companyName,
  draft,
  onSubmit,
}: {
  fields: readonly BookingField[];
  requireEmail: boolean;
  termsText: string;
  companyName: string;
  draft: BookingDraft;
  onSubmit: (values: Pick<BookingDraft, 'customer' | 'answers' | 'accept_terms' | 'privacy_consent'>) => void;
}) {
  const hasTerms = termsText.trim().length > 0;
  const schema = useMemo(() => detailsSchema(fields, requireEmail, hasTerms), [fields, requireEmail, hasTerms]);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      customer: draft.customer,
      answers: { ...defaultAnswers(fields), ...draft.answers },
      accept_terms: draft.accept_terms,
      privacy_consent: draft.privacy_consent,
    },
  });

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(() =>
          // Se guarda lo escrito (no lo transformado): el Worker valida de nuevo al enviar.
          onSubmit(form.getValues() as Pick<BookingDraft, 'customer' | 'answers' | 'accept_terms' | 'privacy_consent'>),
        )}
        className="space-y-5"
      >
        <FormField
          control={form.control}
          name="customer.name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre completo</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} autoComplete="name" maxLength={160} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="customer.phone"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>Teléfono</FormLabel>
              <FormControl>
                <PhoneField
                  value={field.value || undefined}
                  onChange={(v) => field.onChange(v ?? '')}
                  onBlur={field.onBlur}
                  name={field.name}
                  invalid={!!fieldState.error}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="customer.email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Correo {requireEmail ? '' : <span className="font-normal text-muted-foreground">(opcional)</span>}
              </FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} type="email" autoComplete="email" inputMode="email" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="customer.notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Notas <span className="font-normal text-muted-foreground">(opcional)</span>
              </FormLabel>
              <FormControl>
                <Textarea {...field} value={field.value ?? ''} rows={3} maxLength={1000} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {fields.length > 0 && (
          <fieldset className="space-y-4 border-t pt-5">
            <legend className="mb-1 font-medium">Información adicional</legend>
            <DynamicFields fields={fields} />
          </fieldset>
        )}

        {hasTerms && (
          <FormField
            control={form.control}
            name="accept_terms"
            render={({ field }) => (
              <FormItem className="space-y-2 rounded-lg border p-4">
                <p className="max-h-40 overflow-y-auto text-sm whitespace-pre-line text-muted-foreground">
                  {termsText}
                </p>
                <div className="flex items-start gap-3">
                  <FormControl>
                    <Checkbox checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} />
                  </FormControl>
                  <FormLabel className="leading-snug font-normal">Acepto los términos y condiciones</FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="privacy_consent"
          render={({ field }) => (
            <FormItem className="space-y-2">
              <div className="flex items-start gap-3">
                <FormControl>
                  <Checkbox checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} />
                </FormControl>
                <FormLabel className="leading-snug font-normal">{consentLabel(companyName)}</FormLabel>
              </div>
              <a
                href={PRIVACY_PATH}
                target="_blank"
                rel="noopener"
                className="ml-7 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Leer la política de privacidad
              </a>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" size="lg" className="w-full sm:w-auto">
          Continuar
        </Button>
      </form>
    </Form>
  );
}
