import { useState } from 'react';
import { toast } from 'sonner';
import { localDate } from '@shared/availability';
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
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { useCompany } from '@client/app/tenant-context';
import { toastError } from '@client/lib/errors';
import { SlotPicker } from '@client/features/booking/DateStep';
import { monthRange } from '@client/features/booking/month';
import { useAdminMonthSlots, useReschedule, type AdminBooking } from './api';
import { formatWhenShort, fromLocalInput, useCanForce } from './helpers';

/**
 * Selector de horario del panel: cupos del motor (sin antelación mínima) y, para owner/admin,
 * «Forzar fuera de disponibilidad» con fecha y hora libres. Lo usan reprogramar y la reserva
 * manual.
 */
export function AdminSlotField({
  branchId,
  serviceId,
  timezone,
  exclude,
  value,
  onChange,
  initialDate,
}: {
  branchId: string | undefined;
  serviceId: string | undefined;
  timezone: string;
  exclude?: string;
  value: { startsAt: string; capacity: number | null; force: boolean } | null;
  onChange: (value: { startsAt: string; capacity: number | null; force: boolean } | null) => void;
  initialDate?: string;
}) {
  const canForce = useCanForce();
  const [today] = useState(() => localDate(Date.now(), timezone));
  const [date, setDate] = useState<string | null>(initialDate && initialDate >= today ? initialDate : null);
  const [month, setMonth] = useState((date ?? today).slice(0, 7));
  const [force, setForce] = useState(false);
  const [forced, setForced] = useState('');
  const range = monthRange(month);
  const slots = useAdminMonthSlots({
    branchId,
    serviceId,
    timezone,
    from: range.from < today ? today : range.from,
    to: range.to,
    exclude,
  });

  return (
    <div className="space-y-4">
      {!force && (
        <SlotPicker
          timezone={timezone}
          today={today}
          month={month}
          onMonthChange={setMonth}
          slots={slots}
          date={date}
          slot={value && !value.force ? value.startsAt : null}
          onPick={(d, start) => {
            setDate(d);
            if (!start) return onChange(null);
            const s = slots.data?.days.flatMap((day) => day.slots).find((x) => x.start === start);
            onChange({ startsAt: start, capacity: s?.capacity ?? null, force: false });
          }}
          notice={null}
        />
      )}
      {canForce && (
        <div className="space-y-3 rounded-lg border border-dashed p-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="force-slot"
              checked={force}
              onCheckedChange={(v) => {
                setForce(v === true);
                onChange(null);
              }}
            />
            <div className="grid gap-1">
              <Label htmlFor="force-slot">Forzar fuera de disponibilidad</Label>
              <p className="text-xs text-muted-foreground">
                Para horarios llenos, fuera del horario de atención o en el pasado. Solo propietarios y administradores.
              </p>
            </div>
          </div>
          {force && (
            <div className="grid gap-1.5">
              <Label htmlFor="force-at">Fecha y hora (hora de la sede)</Label>
              <Input
                id="force-at"
                type="datetime-local"
                value={forced}
                onChange={(e) => {
                  setForced(e.target.value);
                  onChange(
                    e.target.value
                      ? { startsAt: fromLocalInput(e.target.value, timezone), capacity: null, force: true }
                      : null,
                  );
                }}
                className="w-fit"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RescheduleDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: AdminBooking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const company = useCompany();
  const tz = booking.branch?.timezone ?? company.timezone;
  const [choice, setChoice] = useState<{ startsAt: string; capacity: number | null; force: boolean } | null>(null);
  const reschedule = useReschedule();

  async function submit() {
    if (!choice) return;
    try {
      await reschedule.mutateAsync({ id: booking.id, ...choice });
      toast.success(`Reserva movida al ${formatWhenShort(choice.startsAt, tz)}`);
      onOpenChange(false);
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setChoice(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Reprogramar</DialogTitle>
          <DialogDescription>
            {booking.service_name} · ahora el {formatWhenShort(booking.starts_at, tz)}. Los horarios no cuentan esta
            reserva.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <AdminSlotField
            branchId={booking.branch_id}
            serviceId={booking.service_id}
            timezone={tz}
            exclude={booking.id}
            value={choice}
            onChange={setChoice}
            initialDate={localDate(Date.parse(booking.starts_at), tz)}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!choice || reschedule.isPending} onClick={() => void submit()}>
            {choice ? `Mover al ${formatWhenShort(choice.startsAt, tz)}` : 'Elige un horario'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
