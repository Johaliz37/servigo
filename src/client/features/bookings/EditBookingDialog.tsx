import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { customerSchema } from '@shared/booking';
import { editQuote } from '@shared/booking-admin';
import {
  buildAnswersSchema,
  defaultAnswers,
  fieldsForService,
  toAnswerRows,
  type Answers,
} from '@shared/booking-fields';
import { formatMoney } from '@shared/format';
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
import { Separator } from '@client/components/ui/separator';
import { Textarea } from '@client/components/ui/textarea';
import { useCompany } from '@client/app/tenant-context';
import { toastError } from '@client/lib/errors';
import { DynamicFields } from '@client/features/booking/DynamicFields';
import { PhoneField } from '@client/features/booking/PhoneField';
import {
  useBranchServices,
  useCompanyFields,
  useServiceAddons,
  useUpdateBooking,
  type AdminBooking,
  type UpdatePayload,
} from './api';

/**
 * Editar una reserva (fase 11 §2): datos del cliente, productos y respuestas. Los productos
 * que ya tenía conservan su precio salvo «Recalcular con precios actuales». Solo se envía lo
 * que cambió: una reserva vieja sin un campo obligatorio nuevo se puede editar igual.
 */
export function EditBookingDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: AdminBooking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar reserva</DialogTitle>
          <DialogDescription>
            {booking.service_name} · {booking.customer_name}
          </DialogDescription>
        </DialogHeader>
        {open && <EditForm booking={booking} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ booking, onDone }: { booking: AdminBooking; onDone: () => void }) {
  const company = useCompany();
  const fieldsQuery = useCompanyFields();
  const addonsQuery = useServiceAddons(booking.service_id, booking.branch_id);
  const servicesQuery = useBranchServices(booking.branch_id);
  const update = useUpdateBooking();
  const fields = useMemo(
    () => fieldsForService(fieldsQuery.data ?? [], booking.service_id),
    [fieldsQuery.data, booking.service_id],
  );

  const initialQuantities = useMemo(
    () => Object.fromEntries(booking.items.flatMap((i) => (i.product_id ? [[i.product_id, i.quantity]] : []))),
    [booking.items],
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(initialQuantities);
  const [reprice, setReprice] = useState(false);

  const schema = useMemo(() => z.object({ customer: customerSchema, answers: buildAnswersSchema(fields) }), [fields]);
  const initialAnswers = useMemo(() => {
    const out: Record<string, unknown> = { ...defaultAnswers(fields) };
    for (const a of booking.answers) if (a.field_id) out[a.field_id] = a.value;
    return out;
  }, [fields, booking.answers]);

  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    values: {
      customer: {
        name: booking.customer_name,
        phone: booking.customer_phone,
        email: booking.customer_email ?? '',
        notes: booking.customer_notes ?? '',
      },
      answers: initialAnswers,
    },
    resetOptions: { keepDirtyValues: true },
  });

  const service = servicesQuery.data?.find((s) => s.id === booking.service_id) ?? null;
  // Productos que se pueden elegir: los complementos actuales y los que ya tenía.
  const options = useMemo(() => {
    const list = (addonsQuery.data ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      max: a.max_quantity,
      price: a.final_price,
    }));
    for (const i of booking.items) {
      if (i.product_id && !list.some((a) => a.id === i.product_id)) {
        list.push({ id: i.product_id, name: i.name, max: i.quantity, price: i.line_total / i.quantity });
      }
    }
    return list;
  }, [addonsQuery.data, booking.items]);

  const quote = editQuote({
    currency: booking.currency,
    service: { price: booking.service_price, discount: booking.service_discount },
    currentService: service,
    items: booking.items,
    addons: addonsQuery.data ?? [],
    quantities,
    reprice,
  });
  const itemsChanged =
    JSON.stringify(
      Object.entries(quantities)
        .filter(([, q]) => q > 0)
        .sort(),
    ) !== JSON.stringify(Object.entries(initialQuantities).sort());
  const money = (n: number) => formatMoney(n, booking.currency, company.locale);

  async function onSubmit(values: z.output<typeof schema>) {
    const dirty = form.formState.dirtyFields;
    const payload: UpdatePayload = {};
    if (dirty.customer) payload.customer = values.customer;
    if (dirty.answers) {
      payload.answers = toAnswerRows(fields, values.answers as Answers).map((a) => ({
        field_id: a.field_id,
        value: a.value,
      }));
    }
    if (itemsChanged) {
      payload.items = Object.entries(quantities)
        .filter(([, q]) => q > 0)
        .map(([product_id, quantity]) => ({ product_id, quantity }));
    }
    if (reprice) payload.reprice = true;
    if (Object.keys(payload).length === 0) {
      onDone();
      return;
    }
    try {
      await update.mutateAsync({ booking, payload });
      toast.success('Reserva actualizada');
      onDone();
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Form {...form}>
      <form noValidate onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6">
        <section className="space-y-4" aria-labelledby="edit-customer">
          <h3 id="edit-customer" className="font-medium">
            Cliente
          </h3>
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
                <FormItem className="sm:col-span-2">
                  <FormLabel>Notas del cliente</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <Separator />

        <section className="space-y-3" aria-labelledby="edit-items">
          <h3 id="edit-items" className="font-medium">
            Productos
          </h3>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este servicio no tiene productos complementarios.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {options.map((o) => {
                const q = quantities[o.id] ?? 0;
                return (
                  <li key={o.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{o.name}</p>
                      <p className="text-xs text-muted-foreground">{money(o.price)} c/u</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label={`Quitar una unidad de ${o.name}`}
                        disabled={q === 0}
                        onClick={() => setQuantities((s) => ({ ...s, [o.id]: Math.max(0, q - 1) }))}
                      >
                        <MinusIcon aria-hidden />
                      </Button>
                      <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">
                        {q}
                      </span>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label={`Añadir una unidad de ${o.name}`}
                        disabled={q >= Math.max(o.max, initialQuantities[o.id] ?? 0)}
                        onClick={() => setQuantities((s) => ({ ...s, [o.id]: q + 1 }))}
                      >
                        <PlusIcon aria-hidden />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-start gap-2">
            <Checkbox id="reprice" checked={reprice} onCheckedChange={(v) => setReprice(v === true)} />
            <div className="grid gap-1">
              <Label htmlFor="reprice">Recalcular con precios actuales</Label>
              <p className="text-xs text-muted-foreground">
                Si no lo marcas, el servicio y los productos que ya tenía conservan el precio con que se reservó.
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-3 text-sm">
            <dt>Servicio</dt>
            <dd className="text-right tabular-nums">{money(quote.servicePrice - quote.serviceDiscount)}</dd>
            <dt>Productos</dt>
            <dd className="text-right tabular-nums">{money(quote.lines.reduce((s, l) => s + l.lineTotal, 0))}</dd>
            <dt className="font-medium">Total</dt>
            <dd className="text-right font-medium tabular-nums" data-testid="edit-total">
              {money(quote.total)}
              {quote.total !== booking.total && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">(antes {money(booking.total)})</span>
              )}
            </dd>
          </dl>
        </section>

        {fields.length > 0 && (
          <>
            <Separator />
            <section className="space-y-3" aria-labelledby="edit-answers">
              <h3 id="edit-answers" className="font-medium">
                Información adicional
              </h3>
              <DynamicFields fields={fields} />
            </section>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancelar
          </Button>
          <Button type="submit" disabled={update.isPending}>
            Guardar cambios
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
