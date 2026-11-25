import type { BookingStatus } from '@shared/availability';
import { STATUS_LABELS } from '@shared/booking';
import { cn } from '@client/lib/utils';

const STATUS_CLASSES: Record<BookingStatus, string> = {
  pending: 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
  confirmed: 'border-sky-300 bg-sky-100 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200',
  completed:
    'border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
  cancelled:
    'border-zinc-300 bg-zinc-100 text-zinc-700 line-through dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
  no_show: 'border-rose-300 bg-rose-100 text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200',
};

export function StatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
