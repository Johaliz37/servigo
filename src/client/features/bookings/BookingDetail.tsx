import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CalendarClockIcon, CopyIcon, MailIcon, MessageCircleIcon, PencilIcon, PhoneIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  allowedTransitions,
  canEdit,
  canReschedule,
  describeEvent,
  messageText,
  whatsappLink,
  MESSAGE_TEMPLATES,
  TRANSITION_LABELS,
  type TargetStatus,
} from '@shared/booking-admin';
import { formatCode } from '@shared/booking';
import { formatAnswer, parseOptions, type AnswerValue } from '@shared/booking-fields';
import { formatMoney } from '@shared/format';
import { Button } from '@client/components/ui/button';
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
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@client/components/ui/dropdown-menu';
import { Label } from '@client/components/ui/label';
import { Skeleton } from '@client/components/ui/skeleton';
import { Textarea } from '@client/components/ui/textarea';
import { useCompany } from '@client/app/tenant-context';
import { toastError } from '@client/lib/errors';
import {
  useAdminBooking,
  useBookingHistory,
  useChangeStatus,
  useCustomerBookings,
  useSaveInternalNotes,
  type AdminBooking,
} from './api';
import { EditBookingDialog } from './EditBookingDialog';
import { RescheduleDialog } from './RescheduleDialog';
import { formatWhenLong, formatWhenShort } from './helpers';
import { StatusBadge } from './status';

function Block({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Detalle de una reserva (fase 11 §2), en el panel lateral de la bandeja o en
 * `/admin/reservas/:id`. `onOpenBooking` abre otra reserva del mismo cliente.
 */
export function BookingDetail({ id, onOpenBooking }: { id: string; onOpenBooking?: (id: string) => void }) {
  const query = useAdminBooking(id);
  if (query.isPending) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (query.isError) return <p className="text-sm text-destructive">No pudimos cargar la reserva.</p>;
  if (!query.data)
    return <p className="text-sm text-muted-foreground">La reserva no existe o no tienes acceso a ella.</p>;
  return <Detail booking={query.data} onOpenBooking={onOpenBooking} />;
}

function Detail({
  booking,
  onOpenBooking,
}: {
  booking: AdminBooking;
  onOpenBooking?: ((id: string) => void) | undefined;
}) {
  const company = useCompany();
  const tz = booking.branch?.timezone ?? company.timezone;
  const money = (n: number) => formatMoney(n, booking.currency, company.locale);
  const change = useChangeStatus();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const transitions = allowedTransitions(booking.status, booking.starts_at);
  const code = formatCode(booking.code);
  const minutes = Math.round((Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60_000);

  async function transition(to: TargetStatus, reason?: string) {
    const { failed } = await change.mutateAsync({ ids: [booking.id], to, ...(reason ? { reason } : {}) });
    if (failed.length) toastError(failed[0]);
    else toast.success(`Reserva ${code}: ${TRANSITION_LABELS[to].toLowerCase()}`);
  }

  const context = {
    code: booking.code,
    customer_name: booking.customer_name,
    service_name: booking.service_name,
    when: formatWhenLong(booking.starts_at, tz),
    branch_name: booking.branch?.name ?? '',
    company_name: company.name,
  };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xl font-semibold tracking-wider" data-testid="detail-code">
            {code}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Copiar código"
            onClick={() => void navigator.clipboard?.writeText(code).then(() => toast.success('Código copiado'))}
          >
            <CopyIcon aria-hidden />
          </Button>
          <StatusBadge status={booking.status} />
          <span className="text-xs text-muted-foreground">
            {booking.source === 'admin' ? 'Creada en el panel' : 'Reserva web'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {transitions.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === 'cancelled' ? 'outline' : to === 'no_show' ? 'secondary' : 'default'}
              disabled={change.isPending}
              onClick={() => (to === 'cancelled' ? setCancelOpen(true) : void transition(to))}
            >
              {TRANSITION_LABELS[to]}
            </Button>
          ))}
          {canReschedule(booking.status) && (
            <Button size="sm" variant="outline" onClick={() => setRescheduleOpen(true)}>
              <CalendarClockIcon aria-hidden /> Reprogramar
            </Button>
          )}
          {canEdit(booking.status) && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <PencilIcon aria-hidden /> Editar
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <MessageCircleIcon aria-hidden /> WhatsApp
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Mensaje al cliente</DropdownMenuLabel>
              {MESSAGE_TEMPLATES.map((t) => (
                <DropdownMenuItem key={t.id} asChild>
                  <a
                    href={whatsappLink(booking.customer_phone, messageText(t.id, context))}
                    target="_blank"
                    rel="noopener"
                  >
                    {t.label}
                  </a>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem asChild>
                <a href={whatsappLink(booking.customer_phone)} target="_blank" rel="noopener">
                  Sin plantilla
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {booking.status === 'cancelled' && booking.cancel_reason && (
          <p className="text-sm text-muted-foreground">Motivo: {booking.cancel_reason}</p>
        )}
      </header>

      <Block title="Cliente">
        <div className="space-y-1 text-sm">
          <p className="font-medium">{booking.customer_name}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={`tel:${booking.customer_phone}`} className="inline-flex items-center gap-1 hover:underline">
              <PhoneIcon className="size-3.5" aria-hidden /> {booking.customer_phone}
            </a>
            <a
              href={whatsappLink(booking.customer_phone)}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 hover:underline"
            >
              <MessageCircleIcon className="size-3.5" aria-hidden /> WhatsApp
            </a>
            {booking.customer_email && (
              <a href={`mailto:${booking.customer_email}`} className="inline-flex items-center gap-1 hover:underline">
                <MailIcon className="size-3.5" aria-hidden /> {booking.customer_email}
              </a>
            )}
          </p>
        </div>
        <OtherBookings booking={booking} tz={tz} onOpenBooking={onOpenBooking} />
      </Block>

      <Block title="Servicio y horario">
        <div className="text-sm">
          <p className="font-medium">{booking.service_name}</p>
          <p>
            {formatWhenLong(booking.starts_at, tz)} · {minutes} min
          </p>
          <p className="text-muted-foreground">{booking.branch?.name}</p>
        </div>
      </Block>

      <Block title="Productos y totales">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt>{booking.service_name}</dt>
          <dd className="text-right tabular-nums">{money(booking.service_price)}</dd>
          {booking.items.map((i) => (
            <div key={i.id} className="contents">
              <dt>
                {i.quantity} × {i.name}
              </dt>
              <dd className="text-right tabular-nums">{money(i.unit_price * i.quantity)}</dd>
            </div>
          ))}
          {booking.discount_total > 0 && (
            <>
              <dt>Descuentos</dt>
              <dd className="text-right tabular-nums">−{money(booking.discount_total)}</dd>
            </>
          )}
          <dt className="font-medium">Total</dt>
          <dd className="text-right font-medium tabular-nums" data-testid="detail-total">
            {money(booking.total)}
          </dd>
        </dl>
      </Block>

      {booking.answers.length > 0 && (
        <Block title="Información adicional">
          <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
            {booking.answers.map((a) => (
              <div key={a.id} className="contents">
                <dt className="text-muted-foreground">{a.label}</dt>
                <dd className="break-words">
                  {formatAnswer({ type: a.type, value: a.value as AnswerValue }, parseOptions(a.field?.options))}
                </dd>
              </div>
            ))}
          </dl>
        </Block>
      )}

      {booking.customer_notes && (
        <Block title="Notas del cliente">
          <p className="text-sm whitespace-pre-wrap">{booking.customer_notes}</p>
        </Block>
      )}

      <InternalNotes booking={booking} />

      <History booking={booking} tz={tz} />

      <CancelDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        code={code}
        pending={change.isPending}
        onConfirm={async (reason) => {
          await transition('cancelled', reason);
          setCancelOpen(false);
        }}
      />
      <RescheduleDialog booking={booking} open={rescheduleOpen} onOpenChange={setRescheduleOpen} />
      <EditBookingDialog booking={booking} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

function OtherBookings({
  booking,
  tz,
  onOpenBooking,
}: {
  booking: AdminBooking;
  tz: string;
  onOpenBooking?: ((id: string) => void) | undefined;
}) {
  const query = useCustomerBookings(booking.customer_id);
  const others = (query.data ?? []).filter((b) => b.id !== booking.id);
  if (others.length === 0) return null;
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Otras reservas de este cliente ({others.length})</summary>
      <ul className="mt-2 space-y-1">
        {others.slice(0, 10).map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2">
            {onOpenBooking ? (
              <button type="button" className="truncate text-left hover:underline" onClick={() => onOpenBooking(b.id)}>
                {formatWhenShort(b.starts_at, b.branch?.timezone ?? tz)} · {b.service_name}
              </button>
            ) : (
              <Link to={`/admin/reservas/${b.id}`} className="truncate hover:underline">
                {formatWhenShort(b.starts_at, b.branch?.timezone ?? tz)} · {b.service_name}
              </Link>
            )}
            <StatusBadge status={b.status} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function InternalNotes({ booking }: { booking: AdminBooking }) {
  const [value, setValue] = useState(booking.internal_notes ?? '');
  const save = useSaveInternalNotes();
  const dirty = value.trim() !== (booking.internal_notes ?? '').trim();
  return (
    <Block title="Notas internas">
      <Label htmlFor={`notes-${booking.id}`} className="sr-only">
        Notas internas
      </Label>
      <Textarea
        id={`notes-${booking.id}`}
        rows={3}
        maxLength={2000}
        placeholder="Solo las ve tu equipo"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {dirty && (
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() =>
            void save
              .mutateAsync({ id: booking.id, notes: value })
              .then(() => toast.success('Notas guardadas'))
              .catch(toastError)
          }
        >
          Guardar notas
        </Button>
      )}
    </Block>
  );
}

function History({ booking, tz }: { booking: AdminBooking; tz: string }) {
  const query = useBookingHistory(booking.id);
  return (
    <Block title="Historial">
      {query.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <ol className="relative space-y-3 border-l pl-4 text-sm">
          {(query.data ?? []).map((e) => (
            <li key={e.id} className="relative">
              <span
                aria-hidden
                className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary"
              />
              <p>{describeEvent(e, (iso) => formatWhenShort(iso, tz))}</p>
              <p className="text-xs text-muted-foreground">
                {formatWhenShort(e.created_at, tz)} ·{' '}
                {e.actor_email ??
                  (e.action === 'created' && booking.source === 'web'
                    ? 'Cliente'
                    : e.payload.by === 'customer'
                      ? 'Cliente'
                      : 'Sistema')}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Block>
  );
}

export function CancelDialog({
  open,
  onOpenChange,
  code,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Código o «3 reservas». */
  code: string;
  pending: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason('');
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar {code}</DialogTitle>
          <DialogDescription>
            El horario queda libre otra vez y se devuelve el stock de los productos.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="cancel-reason">Motivo (opcional)</Label>
          <Textarea
            id="cancel-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej.: el cliente avisó que no puede asistir"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Volver
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => void onConfirm(reason.trim())}>
            Cancelar reserva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
