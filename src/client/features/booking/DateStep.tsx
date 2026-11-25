import { useMemo, useState } from 'react';
import { es } from 'react-day-picker/locale';
import { AlertCircleIcon, GlobeIcon } from 'lucide-react';
import { localDate, type DaySlots } from '@shared/availability';
import { DAY_PART_LABELS, dayPart, formatTime } from '@shared/booking';
import { Alert, AlertDescription } from '@client/components/ui/alert';
import { Calendar } from '@client/components/ui/calendar';
import { Skeleton } from '@client/components/ui/skeleton';
import { cn } from '@client/lib/utils';
import { useMonthSlots } from './api';
import { monthRange } from './month';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};

/**
 * Paso 2 (fase 10 §1): calendario del mes con los días sin cupo deshabilitados (una consulta
 * a `/api/public/slots` por mes) y horas en chips por franja, en la zona de la sede.
 */
export function DateStep({
  branchId,
  serviceId,
  timezone,
  date,
  slot,
  onPick,
  notice,
}: {
  branchId: string;
  serviceId: string;
  timezone: string;
  date: string | null;
  slot: string | null;
  onPick: (date: string, slot: string | null) => void;
  notice: string | null;
}) {
  // «Hoy» en la sede, fijado al montar (el paso no dura días abierto).
  const [today] = useState(() => localDate(Date.now(), timezone));
  const [month, setMonth] = useState((date ?? today).slice(0, 7));
  const range = monthRange(month);
  const slots = useMonthSlots(branchId, serviceId, range.from < today ? today : range.from, range.to);
  return (
    <SlotPicker
      timezone={timezone}
      today={today}
      month={month}
      onMonthChange={setMonth}
      slots={slots}
      date={date}
      slot={slot}
      onPick={onPick}
      notice={notice}
    />
  );
}

/** Lo que el selector necesita de la consulta de cupos (pública o del panel). */
export interface SlotsQueryLike {
  data: { days: DaySlots[] } | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
}

/**
 * Calendario + horas por franja. Lo usan el asistente público y el panel (reserva manual y
 * reprogramar, fase 11), cada uno con su fuente de cupos.
 */
export function SlotPicker({
  timezone,
  today,
  month,
  onMonthChange,
  slots,
  date,
  slot,
  onPick,
  notice,
}: {
  timezone: string;
  /** Primer día elegible ('YYYY-MM-DD', zona de la sede). */
  today: string;
  month: string;
  onMonthChange: (month: string) => void;
  slots: SlotsQueryLike;
  date: string | null;
  slot: string | null;
  onPick: (date: string, slot: string | null) => void;
  notice: string | null;
}) {
  const byDate = useMemo(() => new Map((slots.data?.days ?? []).map((d) => [d.date, d.slots])), [slots.data]);
  const daySlots = date ? (byDate.get(date) ?? []) : [];
  const groups = (['morning', 'afternoon', 'evening'] as const)
    .map((part) => ({ part, slots: daySlots.filter((s) => dayPart(s.start, timezone) === part) }))
    .filter((g) => g.slots.length > 0);

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Al cambiar de mes se ven los días del anterior, atenuados, hasta que llegan los nuevos.
  const loadingMonth = slots.isPlaceholderData;

  return (
    <div className="space-y-5">
      {notice && (
        <Alert variant="destructive" role="alert">
          <AlertCircleIcon aria-hidden />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {browserTz !== timezone && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <GlobeIcon aria-hidden className="size-4 shrink-0" />
          Las horas están en la hora de la sede ({timezone.replace('_', ' ')}).
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-[auto_1fr]">
        <div
          className={cn('self-start overflow-hidden rounded-xl border', loadingMonth && 'opacity-60')}
          aria-busy={slots.isFetching}
        >
          <Calendar
            mode="single"
            locale={es}
            month={fromYmd(`${month}-01`)}
            onMonthChange={(m) => onMonthChange(ymd(m).slice(0, 7))}
            startMonth={fromYmd(today)}
            selected={date ? fromYmd(date) : undefined}
            onSelect={(d) => d && onPick(ymd(d), null)}
            disabled={(d) => {
              const key = ymd(d);
              return key < today || slots.isPending || !byDate.has(key);
            }}
            className="mx-auto"
          />
        </div>

        <div className="min-w-0 space-y-4" aria-live="polite">
          {slots.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-24" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-9 w-20" />
                ))}
              </div>
            </div>
          ) : slots.isError ? (
            <p className="text-sm text-destructive">No pudimos cargar los horarios. Intenta de nuevo.</p>
          ) : !date ? (
            <p className="text-sm text-muted-foreground">
              {byDate.size ? 'Elige un día para ver las horas disponibles.' : 'No hay horarios disponibles este mes.'}
            </p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ese día ya no tiene horarios. Elige otro.</p>
          ) : (
            groups.map((g) => (
              <fieldset key={g.part} className="space-y-2">
                <legend className="mb-2 text-sm font-medium">{DAY_PART_LABELS[g.part]}</legend>
                <div className="flex flex-wrap gap-2">
                  {g.slots.map((s) => {
                    const active = s.start === slot;
                    const few = s.capacity > 1 && s.remaining <= 2;
                    return (
                      <button
                        key={s.start}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onPick(date, s.start)}
                        className={cn(
                          'flex min-w-20 flex-col items-center rounded-lg border px-3 py-2 text-sm font-medium tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                          active ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary',
                        )}
                      >
                        {formatTime(s.start, timezone)}
                        {few && (
                          <span className={cn('text-[11px] font-normal', active ? '' : 'text-muted-foreground')}>
                            {s.remaining === 1 ? 'Queda 1 cupo' : `Quedan ${s.remaining} cupos`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
