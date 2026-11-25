import { useState, type ReactNode } from 'react';
import { CheckIcon, ChevronLeftIcon, MinusIcon, PackageIcon, PlusIcon, SparklesIcon } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { quoteBooking, formatBookingDate, type BookingForm, type Quote } from '@shared/booking';
import { fieldsForService, toBookingField } from '@shared/booking-fields';
import { bookingPath, branchPath, formatDuration, type PublicItem } from '@shared/public-site';
import { Button } from '@client/components/ui/button';
import { Skeleton } from '@client/components/ui/skeleton';
import { useCompany } from '@client/app/tenant-context';
import { ApiRequestError } from '@client/lib/api-error';
import { messageOf } from '@client/lib/messages';
import { cn } from '@client/lib/utils';
import { isNotFound, usePublicBranch } from '@client/features/public/api';
import { useDocumentTitle, useMoney } from '@client/features/public/hooks';
import { ItemPrice, PublicImg, PublicNotFound, QueryError } from '@client/features/public/ui';
import { createBooking, saveToken, useBookingForm } from './api';
import { DateStep } from './DateStep';
import { DetailsStep } from './DetailsStep';
import { STEP_LABELS, stepsFor, useDraft, type StepId } from './draft';
import { Turnstile } from './Turnstile';

// ---------------------------------------------------------------------------
// Barra de progreso y resumen
// ---------------------------------------------------------------------------

function Progress({ steps, current }: { steps: StepId[]; current: StepId }) {
  const index = steps.indexOf(current);
  return (
    <nav aria-label="Pasos de la reserva" className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Paso {index + 1} de {steps.length} · <span className="font-medium text-foreground">{STEP_LABELS[current]}</span>
      </p>
      <ol className="flex gap-1.5">
        {steps.map((s, i) => (
          <li key={s} className="flex-1">
            <span
              aria-current={s === current ? 'step' : undefined}
              className={cn('block h-1.5 rounded-full', i <= index ? 'bg-primary' : 'bg-muted')}
            >
              <span className="sr-only">
                {STEP_LABELS[s]}
                {i < index ? ' (hecho)' : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function SummaryBody({ form, slot, quote }: { form: BookingForm; slot: string | null; quote: Quote }) {
  const money = useMoney();
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-medium">{form.service.name}</p>
        <p className="text-muted-foreground">
          {form.branch.name}
          {form.service.duration_minutes ? ` · ${formatDuration(form.service.duration_minutes)}` : ''}
        </p>
        {slot && <p className="mt-1 first-letter:uppercase">{formatBookingDate(slot, form.branch.timezone)}</p>}
      </div>
      <dl className="space-y-1 border-t pt-3">
        <div className="flex justify-between gap-3">
          <dt>Servicio</dt>
          <dd className="tabular-nums">{money(quote.service)}</dd>
        </div>
        {quote.lines.map((l) => (
          <div key={l.id} className="flex justify-between gap-3">
            <dt className="min-w-0 truncate">
              {l.quantity} × {l.name}
            </dt>
            <dd className="tabular-nums">{money(l.lineTotal)}</dd>
          </div>
        ))}
        {quote.discount > 0 && (
          <div className="flex justify-between gap-3 text-primary">
            <dt>Ahorras</dt>
            <dd className="tabular-nums">−{money(quote.discount)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums" data-testid="booking-total">
            {money(quote.total)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">Se paga en la sede.</p>
    </div>
  );
}

/** Resumen: lateral en escritorio, plegable abajo en móvil (fase 10 §1). */
function Summary(props: { form: BookingForm; slot: string | null; quote: Quote }) {
  const money = useMoney();
  return (
    <>
      <aside aria-label="Resumen de la reserva" className="hidden lg:block">
        <div className="sticky top-24 rounded-xl border p-5">
          <h2 className="mb-3 font-semibold">Tu reserva</h2>
          <SummaryBody {...props} />
        </div>
      </aside>
      <details className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur lg:hidden">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3 font-medium">
          <span>Tu reserva</span>
          <span className="tabular-nums">{money(props.quote.total)}</span>
        </summary>
        <div className="max-h-[50svh] overflow-y-auto px-4 pb-4">
          <SummaryBody {...props} />
        </div>
      </details>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pasos 1 y 3
// ---------------------------------------------------------------------------

function ServiceStep({ services, branchSlug }: { services: PublicItem[]; branchSlug: string }) {
  if (!services.length) {
    return <p className="text-muted-foreground">Esta sede todavía no tiene servicios para reservar.</p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {services.map((s) => (
        <li key={s.id}>
          <Link
            to={`${bookingPath(branchSlug, s.id)}?step=fecha`}
            className="flex h-full gap-3 rounded-xl border p-3 transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
              {s.cover ? (
                <PublicImg
                  path={s.cover.path}
                  alt=""
                  width={64}
                  height={64}
                  sizes="64px"
                  className="size-full object-cover"
                />
              ) : (
                <SparklesIcon aria-hidden className="m-auto mt-5 size-6 text-muted-foreground" />
              )}
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block font-medium">{s.name}</span>
              {s.duration_minutes && (
                <span className="block text-sm text-muted-foreground">{formatDuration(s.duration_minutes)}</span>
              )}
              <ItemPrice item={s} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ProductsStep({
  form,
  quantities,
  onChange,
  onNext,
}: {
  form: BookingForm;
  quantities: Record<string, number>;
  onChange: (q: Record<string, number>) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground">Añade productos a tu reserva (opcional). Se pagan en la sede.</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {form.addons.map((a) => {
          const qty = quantities[a.id] ?? 0;
          const set = (n: number) => onChange({ ...quantities, [a.id]: Math.max(0, Math.min(a.max_quantity, n)) });
          return (
            <li key={a.id} className={cn('flex gap-3 rounded-xl border p-3', qty > 0 && 'border-primary')}>
              <span className="size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                {a.cover ? (
                  <PublicImg
                    path={a.cover.path}
                    alt=""
                    width={80}
                    height={80}
                    sizes="80px"
                    className="size-full object-cover"
                  />
                ) : (
                  <PackageIcon aria-hidden className="m-auto mt-7 size-6 text-muted-foreground" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="font-medium">{a.name}</p>
                {a.short_description && <p className="text-sm text-muted-foreground">{a.short_description}</p>}
                <ItemPrice item={a} />
                <div className="mt-auto flex items-center gap-2 pt-1" role="group" aria-label={`Cantidad de ${a.name}`}>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-8"
                    onClick={() => set(qty - 1)}
                    disabled={qty === 0}
                    aria-label={`Quitar una unidad de ${a.name}`}
                  >
                    <MinusIcon aria-hidden />
                  </Button>
                  <output className="w-6 text-center tabular-nums" aria-live="polite">
                    {qty}
                  </output>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-8"
                    onClick={() => set(qty + 1)}
                    disabled={qty >= a.max_quantity}
                    aria-label={`Añadir una unidad de ${a.name}`}
                  >
                    <PlusIcon aria-hidden />
                  </Button>
                  <span className="text-xs text-muted-foreground">máx. {a.max_quantity}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Button size="lg" onClick={onNext} className="w-full sm:w-auto">
        Continuar
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function Shell({ children, back }: { children: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 pb-28 lg:pb-10">
      {back && (
        <Link
          to={back.to}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon aria-hidden className="size-4" />
          {back.label}
        </Link>
      )}
      {children}
    </div>
  );
}

/** Asistente de reserva `/s/:sede/reservar/:servicio?` (fase 10 §1). */
export function Component() {
  const { branchSlug = '', serviceId } = useParams();
  const slug = branchSlug.toLowerCase();
  const company = useCompany();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const branch = usePublicBranch(slug);
  const form = useBookingForm(slug, serviceId);
  const { draft, update, clear } = useDraft(company.id, slug, serviceId);
  const [notice, setNotice] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(`Reservar · ${company.name}`);

  const date = params.get('date');
  const slot = params.get('slot');
  const steps = stepsFor((form.data?.addons.length ?? 0) > 0);
  const requested = (params.get('step') as StepId | null) ?? (serviceId ? 'fecha' : 'servicio');
  // Sin hora no se puede avanzar más allá de la fecha (p. ej. al recargar con la URL a medias).
  let step: StepId = steps.includes(requested) ? requested : 'fecha';
  if (!serviceId) step = 'servicio';
  else if (step === 'servicio') step = 'fecha';
  else if (step !== 'fecha' && !slot) step = 'fecha';

  const go = (next: StepId, extra: Record<string, string | null> = {}) => {
    const p = new URLSearchParams(params);
    p.set('step', next);
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p);
    window.scrollTo({ top: 0 });
  };
  const nextOf = (s: StepId) => steps[steps.indexOf(s) + 1]!;
  const prevOf = (s: StepId) => steps[Math.max(0, steps.indexOf(s) - 1)]!;

  if (branch.isPending || (serviceId && form.isPending)) {
    return (
      <Shell>
        <Skeleton className="mb-6 h-8 w-64" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </Shell>
    );
  }
  if (branch.isError) {
    return isNotFound(branch.error) ? (
      <PublicNotFound title="Esta sede no existe" message="Revisa el enlace o elige una sede desde el inicio." />
    ) : (
      <QueryError error={branch.error} onRetry={() => void branch.refetch()} />
    );
  }
  if (serviceId && form.isError) {
    return isNotFound(form.error) ? (
      <PublicNotFound
        title="Este servicio no se puede reservar"
        message="Puede que ya no se ofrezca en esta sede. Elige otro servicio."
      />
    ) : (
      <QueryError error={form.error} onRetry={() => void form.refetch()} />
    );
  }

  const b = branch.data!;
  if (step === 'servicio' || !form.data) {
    return (
      <Shell back={{ to: branchPath(slug), label: b.branch.name }}>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight sm:text-3xl">Reservar en {b.branch.name}</h1>
        <div className="mb-6 max-w-md">
          <Progress steps={stepsFor(false)} current="servicio" />
        </div>
        <ServiceStep services={b.services} branchSlug={slug} />
      </Shell>
    );
  }

  const data = form.data;
  const fields = fieldsForService(data.fields.map(toBookingField), data.service.id);
  const quote = quoteBooking(data.service, data.addons, draft.quantities, company.currency);

  async function submit() {
    if (!turnstile || !slot || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createBooking({
        branch_slug: slug,
        service_id: data.service.id,
        starts_at: slot,
        customer: draft.customer,
        items: Object.entries(draft.quantities)
          .filter(([, q]) => q > 0)
          .map(([product_id, quantity]) => ({ product_id, quantity })),
        answers: draft.answers,
        accept_terms: draft.accept_terms,
        turnstile,
      });
      saveToken(company.id, created.code, created.token);
      clear();
      void navigate(`/reserva/${created.code}?t=${encodeURIComponent(created.token)}&nueva=1`, { replace: true });
    } catch (err) {
      setSubmitting(false);
      setTurnstile(null);
      if (err instanceof ApiRequestError && err.status === 409) {
        // El horario se ocupó: volver a la fecha conservando el resto (fase 10 §1).
        setNotice(err.message);
        go('fecha', { slot: null });
        return;
      }
      setError(messageOf(err));
    }
  }

  const titles: Record<StepId, string> = {
    servicio: 'Elige el servicio',
    fecha: 'Elige fecha y hora',
    productos: 'Añade productos',
    datos: 'Tus datos',
    confirmar: 'Revisa y confirma',
  };
  const back =
    step === 'fecha'
      ? { to: `${bookingPath(slug)}?step=servicio`, label: 'Cambiar de servicio' }
      : {
          to: `?${new URLSearchParams({ ...Object.fromEntries(params), step: prevOf(step) }).toString()}`,
          label: 'Atrás',
        };

  return (
    <Shell back={back}>
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <div className="space-y-4">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{titles[step]}</h1>
            <Progress steps={steps} current={step} />
          </div>

          {step === 'fecha' && (
            <>
              <DateStep
                branchId={data.branch.id}
                serviceId={data.service.id}
                timezone={data.branch.timezone}
                date={date}
                slot={slot}
                notice={notice}
                onPick={(d, s) => {
                  if (s) {
                    setNotice(null);
                    go(nextOf('fecha'), { date: d, slot: s });
                  } else {
                    const p = new URLSearchParams(params);
                    p.set('date', d);
                    p.delete('slot');
                    setParams(p, { replace: true });
                  }
                }}
              />
            </>
          )}

          {step === 'productos' && (
            <ProductsStep
              form={data}
              quantities={draft.quantities}
              onChange={(quantities) => update({ quantities })}
              onNext={() => go(nextOf('productos'))}
            />
          )}

          {step === 'datos' && (
            <DetailsStep
              fields={fields}
              requireEmail={data.settings.require_email}
              termsText={data.settings.terms_text}
              draft={draft}
              onSubmit={(values) => {
                update(values);
                go('confirmar');
              }}
            />
          )}

          {step === 'confirmar' && (
            <div className="space-y-5">
              <div className="rounded-xl border p-5 lg:hidden">
                <SummaryBody form={data} slot={slot} quote={quote} />
              </div>
              <dl className="grid gap-x-6 gap-y-2 rounded-xl border p-5 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">Nombre</dt>
                <dd>{draft.customer.name}</dd>
                <dt className="text-muted-foreground">Teléfono</dt>
                <dd>{draft.customer.phone}</dd>
                {draft.customer.email && (
                  <>
                    <dt className="text-muted-foreground">Correo</dt>
                    <dd>{draft.customer.email}</dd>
                  </>
                )}
                {draft.customer.notes && (
                  <>
                    <dt className="text-muted-foreground">Notas</dt>
                    <dd className="whitespace-pre-line">{draft.customer.notes}</dd>
                  </>
                )}
              </dl>
              <p className="text-sm text-muted-foreground">
                {data.settings.auto_confirm
                  ? 'Tu reserva quedará confirmada al instante.'
                  : 'La empresa confirmará tu reserva. Te daremos un código para consultarla.'}
              </p>
              <Turnstile onToken={setTurnstile} action="booking" />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                size="lg"
                className="w-full sm:w-auto"
                onClick={() => void submit()}
                disabled={!turnstile || submitting}
              >
                {submitting ? 'Reservando…' : turnstile ? 'Confirmar reserva' : 'Verificando…'}
                {!submitting && turnstile && <CheckIcon aria-hidden />}
              </Button>
            </div>
          )}
        </div>
        <Summary form={data} slot={slot} quote={quote} />
      </div>
    </Shell>
  );
}
