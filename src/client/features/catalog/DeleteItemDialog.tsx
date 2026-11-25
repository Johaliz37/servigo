import { useState } from 'react';
import { toast } from 'sonner';
import { KIND_LABELS } from '@shared/catalog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@client/components/ui/alert-dialog';
import { Button } from '@client/components/ui/button';
import { messageOf } from '@client/lib/errors';
import { useDeleteItem, useItemHasBookings, useToggleItemActive, type CatalogListRow } from './api';

/**
 * Eliminar un ítem: solo si no tiene reservas. Si las tiene, ofrece inactivarlo (la BD también
 * lo impide: trigger `catalog_items_block_delete_with_bookings`).
 */
export function DeleteItemDialog({
  item,
  onOpenChange,
  onDeleted,
}: {
  item: CatalogListRow | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const hasBookings = useItemHasBookings(item);
  const remove = useDeleteItem();
  const toggle = useToggleItemActive();
  const [pending, setPending] = useState(false);
  const label = item ? KIND_LABELS[item.kind].one : '';

  async function run(action: () => Promise<void>, message: string) {
    setPending(true);
    try {
      await action();
      toast.success(message);
      onOpenChange(false);
    } catch (error) {
      toast.error(messageOf(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={!!item} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar «{item?.name}»?</AlertDialogTitle>
          <AlertDialogDescription>
            {hasBookings.isPending
              ? 'Comprobando si tiene reservas…'
              : hasBookings.data
                ? `Este ${label} tiene reservas, así que no se puede eliminar. Puedes inactivarlo: deja de ofrecerse pero se conserva el historial.`
                : `Se eliminan también sus fotos, detalles y descuentos. No se puede deshacer.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          {hasBookings.data ? (
            <Button
              disabled={pending || !item?.is_active}
              onClick={() => item && void run(() => toggle.mutateAsync({ id: item.id, active: false }), 'Inactivado')}
            >
              {item?.is_active ? 'Inactivar' : 'Ya está inactivo'}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={pending || hasBookings.isPending || hasBookings.isError}
              onClick={() =>
                item &&
                void run(async () => {
                  await remove.mutateAsync(item);
                  onDeleted?.();
                }, 'Eliminado')
              }
            >
              {pending ? 'Eliminando…' : 'Eliminar'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
