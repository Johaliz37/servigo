import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeftIcon, MinusIcon, PlusIcon, UserRoundSearchIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { formatCode, customerSchema, quoteBooking } from '@shared/booking';
import {
  buildAnswersSchema,
  defaultAnswers,
  fieldsForService,
  toAnswerRows,
  type Answers,
} from '@shared/booking-fields';
import { formatMoney } from '@shared/format';
import { PageHeader } from '@client/components/common/PageHeader';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@client/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@client/components/ui/form';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Textarea } from '@client/components/ui/textarea';
import { useCompany } from '@client/app/tenant-context';
import { toastError } from '@client/lib/errors';
import { useSelectedBranch } from '@client/features/admin/branch-context';
import { DynamicFields } from '@client/features/booking/DynamicFields';
import { PhoneField } from '@client/features/booking/PhoneField';
import { useBranchServices, useCompanyFields, useCreateAdminBooking, useCustomerSearch, useServiceAddons } from './api';
import { AdminSlotField } from './RescheduleDialog';
import { formatWhenShort } from './helpers';

type Choice = { startsAt: string; capacity: number | null; force: boolean } | null;

/**
 * Reserva manual `/admin/reservas/nueva` (fase 11 §3): los pasos del asistente público en una
 * sola página (sede y servicio, horario, cliente, productos, información adicional), sin
 * Turnstile. `create_booking_admin` revalida todo y guarda `source = 'admin'` y `created_by`.
 */
export function Component() {
  const company = useCompany();
  const navigate = useNavigate();
  const { branches, selectedId } = useSelectedBranch();
  const active = branches.filter((b) => b.isActive);
  const [branchId, setBranchId] = useState<string | undefined>(
    selectedId ?? (active.length === 1 ? active[0]?.id : undefined),
  );
  const [serviceId, setServiceId] = useState<string | undefined>();
  const [choice, setChoice] = useState<Choice>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<'confirmed' | 'pending'>('confirmed');
  const branch = active.find((b) => b.id === branchId);
  const tz = branch?.timezone ?? company.timezone;

  const services = useBranchServices(branchId);
  const service = services.data?.find((s) => s.id === serviceId);
  const addons = useServiceAddons(serviceId, branchId);
  const fieldsQuery = useCompanyFields();
  const fields = useMemo(
    () => (serviceId ? fieldsForService(fieldsQuery.data ?? [], serviceId) : []),
    [fieldsQuery.data, serviceId],
  );
  const create = useCreateAdminBooking();

  const schema = useMemo(() => z.object({ customer: customerSchema, answers: buildAnswersSchema(fields) }), [fields]);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    values: { customer: { name: '', phone: '', email: '', notes: '' }, answers: defaultAnswers(fields) },
    resetOptions: { keepDirtyValues: true },
  });

  const quote = service ? quoteBooking(service, addons.data ?? [], quantities, company.currency) : null;
  const money = (n: number) => formatMoney(n, company.currency, company.locale);

  async function onSubmit(values: z.output<typeof schema>) {
    if (!branchId || !serviceId || !choice) {
      toast.error('Elige la sede, el servicio y el horario');
      return;
    }
    try {
      const created = await create.mutateAsync({
        branch_id: branchId,
        service_id: serviceId,
        starts_at: choice.startsAt,
        capacity: choice.capacity ?? 0,
        force: choice.force,
        status,
        customer: values.customer,
        items: Object.entries(quantities)
          .filter(([, q]) => q > 0)
          .map(([product_id, quantity]) => ({ product_id, quantity })),
        answers: toAnswerRows(fields, values.answers as Answers).map((a) => ({ field_id: a.field_id, value: a.value })),
      });
      toast.success(`Reserva ${formatCode(created.code)} creada`);
      void navigate(`/admin/reservas?b=${created.id}`);
    } catch (error) {
      toastError(error);
      // El cupo se pudo ocupar mientras se llenaba el formulario: elegir otro.
      setChoice(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link to="/admin/reservas">
          <ArrowLeftIcon aria-hidden /> Reservas
        </Link>
      </Button>
      <PageHeader title="Nueva reserva" description="Para clientes que llaman o llegan sin reservar." />

      <Form {...form}>
        <form noValidate onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Sede y servicio</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="nb-branch">Sede</Label>
                <Select
                  value={branchId ?? ''}
                  onValueChange={(v) => {
                    setBranchId(v);
                    setServiceId(undefined);
                    setChoice(null);
                    setQuantities({});
                  }}
                >
                  <SelectTrigger id="nb-branch" className="w-full">
                    <SelectValue placeholder="Elige una sede" />
                  </SelectTrigger>
                  <SelectContent>
                    {active.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="nb-service">Servicio</Label>
                <Select
                  value={serviceId ?? ''}
                  disabled={!branchId}
                  onValueChange={(v) => {
                    setServiceId(v);
                    setChoice(null);
                    setQuantities({});
                  }}
                >
                  <SelectTrigger id="nb-service" className="w-full">
                    <SelectValue placeholder={services.isPending && branchId ? 'Cargando…' : 'Elige un servicio'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(services.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · {money(s.final_price)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {branchId && serviceId && (
            <Card>
              <CardHeader>
                <CardTitle>2. Fecha y hora</CardTitle>
              </CardHeader>
              <CardContent>
                <AdminSlotField
                  key={`${branchId}:${serviceId}`}
                  branchId={branchId}
                  serviceId={serviceId}
                  timezone={tz}
                  value={choice}
                  onChange={setChoice}
                />
                {choice && (
                  <p className="mt-3 text-sm font-medium" aria-live="polite">
                    Horario: {formatWhenShort(choice.startsAt, tz)}
                    {choice.force && ' (forzado)'}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>3. Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <CustomerPicker
                onPick={(c) => {
                  form.setValue('customer.name', c.name, { shouldDirty: true, shouldValidate: true });
                  form.setValue('customer.phone', c.phone, { shouldDirty: true, shouldValidate: true });
                  form.setValue('customer.email', c.email ?? '', { shouldDirty: true });
                }}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="customer.name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre completo</FormLabel>
                      <FormControl>
                        <Input autoComplete="off" {...field} />
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
                          value={field.value}
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
                      <FormLabel>Correo (opcional)</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="off" {...field} value={field.value ?? ''} />
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
                      <FormLabel>Notas del cliente (opcional)</FormLabel>
                      <FormControl>
                        <Textarea rows={1} {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {(addons.data?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>4. Productos</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-lg border">
                  {addons.data!.map((a) => {
                    const q = quantities[a.id] ?? 0;
                    return (
                      <li key={a.id} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{a.name}</p>
                          <p className="text-xs text-muted-foreground">{money(a.final_price)} c/u</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="size-8"
                            aria-label={`Quitar una unidad de ${a.name}`}
                            disabled={q === 0}
                            onClick={() => setQuantities((s) => ({ ...s, [a.id]: q - 1 }))}
                          >
                            <MinusIcon aria-hidden />
                          </Button>
                          <span className="w-8 text-center text-sm tabular-nums">{q}</span>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="size-8"
                            aria-label={`Añadir una unidad de ${a.name}`}
                            disabled={q >= a.max_quantity}
                            onClick={() => setQuantities((s) => ({ ...s, [a.id]: q + 1 }))}
                          >
                            <PlusIcon aria-hidden />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {fields.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Información adicional</CardTitle>
              </CardHeader>
              <CardContent>
                <DynamicFields fields={fields} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <RadioGroup
                value={status}
                onValueChange={(v) => setStatus(v as 'confirmed' | 'pending')}
                className="flex gap-4"
                aria-label="Estado inicial"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="st-confirmed" value="confirmed" />
                  <Label htmlFor="st-confirmed">Confirmada</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="st-pending" value="pending" />
                  <Label htmlFor="st-pending">Pendiente</Label>
                </div>
              </RadioGroup>
              <div className="flex items-center gap-4">
                {quote && (
                  <span className="text-sm">
                    Total{' '}
                    <strong className="tabular-nums" data-testid="new-booking-total">
                      {money(quote.total)}
                    </strong>
                  </span>
                )}
                <Button type="submit" disabled={create.isPending || !choice}>
                  Crear reserva
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  );
}

function CustomerPicker({ onPick }: { onPick: (c: { name: string; phone: string; email: string | null }) => void }) {
  const [term, setTerm] = useState('');
  const results = useCustomerSearch(term);
  return (
    <div className="space-y-2">
      <Label htmlFor="nb-customer-search" className="flex items-center gap-1.5">
        <UserRoundSearchIcon className="size-4" aria-hidden /> Buscar un cliente existente
      </Label>
      <Input
        id="nb-customer-search"
        type="search"
        placeholder="Nombre, teléfono o correo"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        autoComplete="off"
      />
      {(results.data?.length ?? 0) > 0 && (
        <ul className="divide-y rounded-lg border" aria-label="Clientes encontrados">
          {results.data!.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onPick(c);
                  setTerm('');
                }}
              >
                <span className="truncate font-medium">{c.name}</span>
                <span className="text-muted-foreground tabular-nums">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
