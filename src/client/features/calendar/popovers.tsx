import { useState, type ReactNode } from 'react';
import { CopyIcon, PencilIcon, RepeatIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { AvailabilityKind } from '@shared/availability';
import type { EventRow } from '@shared/calendar';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@client/components/ui/popover';
import { cn } from '@client/lib/utils';
import { describeRow, displayTitle, formatWhen, KIND_COLORS, KIND_LABELS } from './model';

export interface Point {
  x: number;
  y: number;
}

/** Popover anclado a un punto de la pantalla (donde se soltó la selección o se hizo clic). */
export function PointPopover({
  point,
  onClose,
  label,
  children,
}: {
  point: Point | null;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover open={!!point} onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <div
          aria-hidden
          className="pointer-events-none fixed size-px"
          style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
        />
      </PopoverAnchor>
      <PopoverContent
        role="dialog"
        aria-label={label}
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
        collisionPadding={16}
        onOpenAutoFocus={(e) => {
          // El foco va al primer campo (crear) o al contenido (detalle), no al botón cerrar.
          const target = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-autofocus]');
          if (target) {
            e.preventDefault();
            target.focus();
          }
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Creación rápida (como Google): título, tipo y «Más opciones». */
export function QuickCreate({
  when,
  defaultKind,
  onSave,
  onMore,
  onClose,
}: {
  when: string;
  defaultKind: AvailabilityKind;
  onSave: (title: string, kind: AvailabilityKind) => void;
  onMore: (title: string, kind: AvailabilityKind) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<AvailabilityKind>(defaultKind);
  return (
    <form
      className="space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(title.trim(), kind);
      }}
    >
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mt-2 -mr-2 size-8"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <XIcon />
        </Button>
      </div>
      <Input
        data-autofocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Añade un título"
        aria-label="Título"
        maxLength={200}
        className="rounded-none border-0 border-b px-0 text-lg shadow-none focus-visible:ring-0"
      />
      <div role="radiogroup" aria-label="Tipo" className="flex gap-2">
        {(['open', 'closed'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              kind === k ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{when}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onMore(title.trim(), kind)}>
          Más opciones
        </Button>
        <Button type="submit">Guardar</Button>
      </div>
    </form>
  );
}

/** Detalle de un horario: datos y acciones Editar, Duplicar, Eliminar. */
export function EventDetails({
  row,
  start,
  end,
  serviceNames,
  editable,
  onEdit,
  onDuplicate,
  onDelete,
  onClose,
}: {
  row: EventRow;
  start: number;
  end: number;
  serviceNames: string[] | null;
  editable: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="p-4">
      <div className="-mt-2 -mr-2 flex justify-end gap-1">
        {editable && (
          <>
            <Button variant="ghost" size="icon" className="size-8" onClick={onEdit} aria-label="Editar">
              <PencilIcon />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" onClick={onDuplicate} aria-label="Duplicar">
              <CopyIcon />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" onClick={onDelete} aria-label="Eliminar">
              <Trash2Icon />
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Cerrar">
          <XIcon />
        </Button>
      </div>
      <div className="flex gap-3 outline-none" data-autofocus tabIndex={-1}>
        <span
          className="mt-1.5 size-3.5 shrink-0 rounded"
          style={{ background: row.color ?? KIND_COLORS[row.kind] }}
          aria-hidden
        />
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg leading-tight font-medium break-words">{displayTitle(row)}</h2>
          <p className="text-sm">{formatWhen(start, end, row.all_day, row.timezone)}</p>
          {row.rrule && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <RepeatIcon className="size-3.5" aria-hidden /> {describeRow(row)}
            </p>
          )}
          {row.recurrence_parent_id && <p className="text-xs text-muted-foreground">Excepción de una serie</p>}
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="sr-only">Tipo</dt>
          <dd>
            <Badge variant="secondary">{KIND_LABELS[row.kind]}</Badge>
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Servicios:</dt>
          <dd>{serviceNames ? serviceNames.join(', ') : 'Todos'}</dd>
        </div>
        {row.capacity_override && (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Capacidad:</dt>
            <dd>{row.capacity_override}</dd>
          </div>
        )}
        {row.notes && <p className="pt-1 whitespace-pre-line text-muted-foreground">{row.notes}</p>}
      </dl>
    </div>
  );
}
