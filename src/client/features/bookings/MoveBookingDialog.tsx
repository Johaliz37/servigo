import { useEffect, useState } from 'react';
import { AlertTriangleIcon, CheckCircle2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@client/components/ui/alert';
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
import { Label } from '@client/components/ui/label';
import { toastError } from '@client/lib/errors';
import { slotAt, useReschedule } from './api';
import { formatWhenShort, useCanForce } from './helpers';

export interface MoveTarget {
  booking: {
    id: string;
    branch_id: string;
    service_id: string;
    customer_name: string;
    service_name: string;
    starts_at: string;
  };
  startsAt: string;
  timezone: string;
  /** Devuelve el evento a su sitio en el calendario si no se mueve. */
  revert: () => void;
}

/**
 * Arrastrar una reserva en el calendario = reprogramar (fase 11 §4): confirma, comprueba el cupo
 * con el motor (sin contar la propia reserva) y, si no hay, ofrece forzar a owner/admin.
 */
export function MoveBookingDialog({ target, onClose }: { target: MoveTarget | null; onClose: () => void }) {
  const canForce = useCanForce();
  const reschedule = useReschedule();
  const [check, setCheck] = useState<{ key: string; slot: { capacity: number } | null } | null>(null);
  const [force, setForce] = useState(false);
  const key = target ? `${target.booking.id}:${target.startsAt}` : '';

  useEffect(() => {
    if (!target) return;
    let live = true;
    slotAt({
      branchId: target.booking.branch_id,
      serviceId: target.booking.service_id,
      timezone: target.timezone,
      startsAt: target.startsAt,
      exclude: target.booking.id,
    })
      .then((slot) => live && setCheck({ key: `${target.booking.id}:${target.startsAt}`, slot }))
      .catch(() => live && setCheck({ key: `${target.booking.id}:${target.startsAt}`, slot: null }));
    return () => {
      live = false;
    };
  }, [target]);

  const result = check?.key === key ? check : null;
  const available = !!result?.slot;

  function close(moved: boolean) {
    if (!moved) target?.revert();
    setForce(false);
    onClose();
  }

  async function confirm() {
    if (!target) return;
    try {
      await reschedule.mutateAsync({
        id: target.booking.id,
        startsAt: target.startsAt,
        capacity: result?.slot?.capacity ?? null,
        force: !available && force,
      });
      toast.success(`Reserva movida al ${formatWhenShort(target.startsAt, target.timezone)}`);
      close(true);
    } catch (error) {
      toastError(error);
      close(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && close(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Reprogramar la reserva?</DialogTitle>
          {target && (
            <DialogDescription>
              {target.booking.customer_name} · {target.booking.service_name}: del{' '}
              {formatWhenShort(target.booking.starts_at, target.timezone)} al{' '}
              <strong>{formatWhenShort(target.startsAt, target.timezone)}</strong>.
            </DialogDescription>
          )}
        </DialogHeader>
        {!result ? (
          <p className="text-sm text-muted-foreground">Comprobando el cupo…</p>
        ) : available ? (
          <Alert>
            <CheckCircle2Icon aria-hidden />
            <AlertDescription>Ese horario está disponible.</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertTriangleIcon aria-hidden />
              <AlertDescription>Ese horario está lleno o fuera de la disponibilidad de la sede.</AlertDescription>
            </Alert>
            {canForce && (
              <div className="flex items-center gap-2">
                <Checkbox id="move-force" checked={force} onCheckedChange={(v) => setForce(v === true)} />
                <Label htmlFor="move-force">Forzar fuera de disponibilidad</Label>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button disabled={!result || (!available && !force) || reschedule.isPending} onClick={() => void confirm()}>
            Reprogramar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
