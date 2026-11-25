import { useEffect, useState } from 'react';
import {
  CalendarPlusIcon,
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  MapPinIcon,
  Share2Icon,
  XCircleIcon,
} from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  bookingIcs,
  formatBookingDate,
  formatCode,
  googleCalendarUrl,
  normalizeCode,
  STATUS_LABELS,
  whatsappBookingText,
  type BookingDetail,
  type CalendarEvent,
} from '@shared/booking';
import { formatAnswer } from '@shared/booking-fields';
import { mapsUrl, whatsappUrl } from '@shared/public-site';
import { SocialIcon } from '@client/components/common/SocialIcon';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { Skeleton } from '@client/components/ui/skeleton';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/messages';
import { cn } from '@client/lib/utils';
import { useDocumentTitle, useMoney } from '@client/features/public/hooks';
import { cancelBooking, readToken, saveToken, useBookingDetail } from './api';
import { LookupForm } from './LookupForm';
import { Turnstile } from './Turnstile';

function calendarEvent(b: BookingDetail, companyName: string, url: string): CalendarEvent {
  return {
    uid: `${b.code}@servigo.roquintech.com`,
    title: `${b.service_name} · ${companyName}`,
    start: b.starts_at,
    end: b.ends_at,
    location: [b.branch.name, b.branch.address, b.branch.city].filter(Boolean).join(', '),
    description: `Reserva ${formatCode(b.code)}. ${url}`,
    url,
  };
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const STATUS_STYLE: Record<BookingDetail['status'], string> = {
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  confirmed: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
  completed: 'bg-muted text-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
  no_show: 'bg-muted text-foreground',
};

function CancelBox({ booking, onDone }: { booking: BookingDetail; onDone: (b: BookingDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [turnstile, setTurnstile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!booking.can_cancel) return null;
  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <XCircleIcon aria-hidden /> Cancelar reserva
      </Button>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-destructive/40 p-4">
      <p className="font-medium">¿Cancelar esta reserva?</p>
      <p className="text-sm text-muted-foreground">
        El horario quedará libre para otras personas. No se puede deshacer.
      </p>
      <Turnstile onToken={setTurnstile} action="cancel" />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          disabled={!turnstile || busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            cancelBooking(booking.code, booking.token, turnstile!)
              .then(onDone)
              .catch((e: unknown) => {
                setError(messageOf(e));
                setTurnstile(null);
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Cancelando…' : 'Sí, cancelar'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          No, mantenerla
        </Button>
      </div>
    </div>
  );
}

function Detail({ booking: initial, isNew }: { booking: BookingDetail; isNew: boolean }) {
  const company = useCompany();
  const money = useMoney();
  const [booking, setBooking] = useState(initial);
  const [copied, setCopied] = useState(false);
  const b = booking;
  const tz = b.branch.timezone;
  const publicUrl = `${window.location.origin}/reserva/${b.code}`;
  const event = calendarEvent(b, company.name, publicUrl);
  const wa = whatsappUrl(
    b.branch.whatsapp,
    whatsappBookingText({ code: b.code, service_name: b.service_name, starts_at: b.starts_at, timezone: tz }),
  );
  const maps = mapsUrl(b.branch);
  const cancelled = b.status === 'cancelled';

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:py-12">
      {isNew && !cancelled && (
        <div role="status" className="flex items-center gap-3 rounded-xl bg-primary/10 p-4 text-primary">
          <CheckCircle2Icon aria-hidden className="size-6 shrink-0" />
          <p className="font-medium">
            {b.status === 'confirmed' ? '¡Listo! Tu reserva está confirmada.' : '¡Listo! Recibimos tu reserva.'}
          </p>
        </div>
      )}

      <section aria-labelledby="codigo" className="rounded-2xl border p-6 text-center">
        <p id="codigo" className="text-sm text-muted-foreground">
          Código de tu reserva
        </p>
        <p className="mt-1 font-mono text-4xl font-semibold tracking-widest" data-testid="booking-code">
          {formatCode(b.code)}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Badge className={cn('border-0', STATUS_STYLE[b.status])}>{STATUS_LABELS[b.status]}</Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void navigator.clipboard.writeText(formatCode(b.code)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
            }
          >
            <CopyIcon aria-hidden /> {copied ? 'Copiado' : 'Copiar código'}
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Guárdalo: con él y tu teléfono puedes consultar la reserva en «Mis reservas».
        </p>
      </section>

      <section aria-label="Detalle" className="space-y-4 rounded-2xl border p-6">
        <div>
          <h1 className="text-xl font-semibold">{b.service_name}</h1>
          <p className="mt-1 first-letter:uppercase">{formatBookingDate(b.starts_at, tz)}</p>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <MapPinIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">{b.branch.name}</p>
            {(b.branch.address || b.branch.city) && (
              <p className="text-muted-foreground">{[b.branch.address, b.branch.city].filter(Boolean).join(', ')}</p>
            )}
            {maps && (
              <a
                href={maps}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                Ver en el mapa
              </a>
            )}
          </div>
        </div>

        <dl className="space-y-1 border-t pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt>{b.service_name}</dt>
            <dd className="tabular-nums">{money(b.service_price - b.service_discount)}</dd>
          </div>
          {b.items.map((i) => (
            <div key={i.name} className="flex justify-between gap-3">
              <dt>
                {i.quantity} × {i.name}
              </dt>
              <dd className="tabular-nums">{money(i.line_total)}</dd>
            </div>
          ))}
          {b.discount_total > 0 && (
            <div className="flex justify-between gap-3 text-primary">
              <dt>Ahorras</dt>
              <dd className="tabular-nums">−{money(b.discount_total)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3 border-t pt-2 text-base font-semibold">
            <dt>Total a pagar en la sede</dt>
            <dd className="tabular-nums" data-testid="booking-detail-total">
              {money(b.total)}
            </dd>
          </div>
        </dl>

        {b.answers.length > 0 && (
          <dl className="grid gap-x-4 gap-y-1 border-t pt-4 text-sm sm:grid-cols-[auto_1fr]">
            {b.answers.map((a) => (
              <div key={a.label} className="contents">
                <dt className="text-muted-foreground">{a.label}</dt>
                <dd>{formatAnswer({ type: a.type, value: a.value as never }, a.options)}</dd>
              </div>
            ))}
          </dl>
        )}
        {b.customer_notes && (
          <p className="border-t pt-4 text-sm whitespace-pre-line">
            <span className="text-muted-foreground">Notas: </span>
            {b.customer_notes}
          </p>
        )}
      </section>

      {!cancelled && (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
              <CalendarPlusIcon aria-hidden /> Añadir a Google Calendar
            </a>
          </Button>
          <Button
            variant="outline"
            onClick={() => download(`reserva-${b.code}.ics`, bookingIcs(event), 'text/calendar')}
          >
            <DownloadIcon aria-hidden /> Descargar .ics
          </Button>
          {wa && (
            <Button asChild variant="outline">
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <SocialIcon network="whatsapp" /> Enviar por WhatsApp
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              const data = { title: event.title, text: `Mi reserva ${formatCode(b.code)}`, url: publicUrl };
              if (navigator.share) void navigator.share(data).catch(() => undefined);
              else void navigator.clipboard.writeText(publicUrl);
            }}
          >
            <Share2Icon aria-hidden /> Compartir
          </Button>
        </div>
      )}

      <CancelBox booking={b} onDone={setBooking} />

      <p className="text-center text-sm">
        <Link to={`/s/${b.branch.slug}`} className="text-primary underline-offset-4 hover:underline">
          Volver a {b.branch.name}
        </Link>
      </p>
    </div>
  );
}

/** `/reserva/:code` (fase 10 §3): con token muestra el detalle; sin él, pide el contacto. */
export function Component() {
  const { code: raw = '' } = useParams();
  const code = normalizeCode(raw);
  const company = useCompany();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('t') ?? readToken(company.id, code);
  const detail = useBookingDetail(code, token);
  useDocumentTitle(`Reserva ${formatCode(code)} · ${company.name}`);

  // Se recuerda el token en este navegador para volver sin el enlace.
  useEffect(() => {
    if (detail.data) saveToken(company.id, detail.data.code, detail.data.token);
  }, [detail.data, company.id]);

  if (token && detail.isPending) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-12" aria-busy="true" aria-label="Cargando">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (detail.data) {
    return <Detail booking={detail.data} isNew={params.get('nueva') === '1'} />;
  }

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-12">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Reserva {formatCode(code)}</h1>
        <p className="text-muted-foreground">
          {token
            ? 'El enlace venció o no es válido. Confirma tu teléfono o correo para verla.'
            : 'Para ver esta reserva, escribe el teléfono o el correo con que reservaste.'}
        </p>
      </div>
      <LookupForm
        mode="code"
        initialCode={code}
        hideCode
        onResults={(results) => {
          const found = results[0];
          if (found) void navigate(`/reserva/${found.code}?t=${encodeURIComponent(found.token)}`, { replace: true });
        }}
      />
    </div>
  );
}
