import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { bookingSettingsSchema, parseBookingSettings, SLOT_STEPS, type BookingSettings } from '@shared/content';
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
import { Switch } from '@client/components/ui/switch';
import { Textarea } from '@client/components/ui/textarea';
import { PageHeader } from '@client/components/common/PageHeader';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { messageOf } from '@client/lib/errors';
import { RequireAction } from '@client/features/admin/RequireAction';
import { useCompanyRecord, useUpdateCompany } from '@client/features/content/api';

type FormValues = z.input<typeof bookingSettingsSchema>;

export function Component() {
  return (
    <RequireAction action="company.edit">
      <BookingSettingsScreen />
    </RequireAction>
  );
}

function BookingSettingsScreen() {
  const record = useCompanyRecord();
  if (record.isPending) return <FullPageSpinner />;
  if (record.isError) throw record.error;
  return <SettingsForm initial={parseBookingSettings(record.data.booking_settings)} />;
}

function SettingsForm({ initial }: { initial: BookingSettings }) {
  const update = useUpdateCompany();
  const form = useForm<FormValues, unknown, BookingSettings>({
    resolver: zodResolver(bookingSettingsSchema),
    defaultValues: initial,
  });
  useEffect(() => form.reset(initial), [initial, form]);
  const allowCancel = useWatch({ control: form.control, name: 'allow_customer_cancel' });

  async function submit(values: BookingSettings) {
    try {
      // No afecta lo que cachea el Worker del tenant: sin purga.
      await update.mutateAsync({ patch: { booking_settings: values }, purge: false });
      toast.success('Configuración de reservas guardada');
    } catch (error) {
      toast.error(messageOf(error));
    }
  }

  const number = (
    name: 'min_lead_minutes' | 'max_days_ahead' | 'cancel_limit_hours',
    label: string,
    hint: string,
    unit: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="flex items-center gap-2">
            <FormControl>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                className="w-28"
                {...field}
                value={field.value as number | string}
              />
            </FormControl>
            <span className="text-sm text-muted-foreground">{unit}</span>
          </div>
          <FormDescription>{hint}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const toggle = (name: 'auto_confirm' | 'allow_customer_cancel' | 'require_email', label: string, hint: string) => (
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
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  );

  return (
    <>
      <PageHeader title="Reservas" description="Reglas que aplican a todas las reservas en línea." />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} className="max-w-3xl space-y-6" noValidate>
          <Card>
            <CardHeader>
              <CardTitle>Confirmación y datos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {toggle(
                'auto_confirm',
                'Confirmar automáticamente',
                'Si está apagado, las reservas quedan pendientes hasta que las confirmes.',
              )}
              {toggle('require_email', 'Correo obligatorio', 'Pide el correo además del teléfono al reservar.')}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Horarios</CardTitle>
              <CardDescription>Cuándo se puede reservar.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {number('min_lead_minutes', 'Anticipación mínima', 'Tiempo mínimo entre ahora y la cita.', 'minutos')}
              {number('max_days_ahead', 'Reservar hasta', 'Cuántos días hacia adelante se ofrecen.', 'días')}
              <FormField
                control={form.control}
                name="slot_step_minutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Paso entre horarios</FormLabel>
                    <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                      <FormControl>
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SLOT_STEPS.map((s) => (
                          <SelectItem key={s} value={String(s)}>
                            Cada {s} min
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Ej.: cada 30 min → 9:00, 9:30, 10:00…</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cancelación</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {toggle(
                'allow_customer_cancel',
                'El cliente puede cancelar',
                'Desde “Mis reservas”, con su código y teléfono.',
              )}
              {allowCancel &&
                number(
                  'cancel_limit_hours',
                  'Hasta',
                  'Horas antes de la cita en que aún puede cancelar.',
                  'horas antes',
                )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Términos y condiciones</CardTitle>
              <CardDescription>El cliente los acepta al reservar. Déjalo vacío si no aplica.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="terms_text"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="sr-only">Términos y condiciones</FormLabel>
                    <FormControl>
                      <Textarea rows={6} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
}
