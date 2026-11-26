import { useState, type ReactNode } from 'react';
import { TableIcon } from 'lucide-react';
import type { BookingStatus } from '@shared/availability';
import { STATUS_LABELS } from '@shared/booking';
import { heatmapGrid, type HeatCell } from '@shared/dashboard';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/components/ui/card';
import { Skeleton } from '@client/components/ui/skeleton';
import { cn } from '@client/lib/utils';

/**
 * Tarjeta de gráfica con «Ver tabla»: los valores nunca dependen solo del color ni del
 * tooltip (relief rule de la paleta: varios tonos claros no llegan a 3:1).
 */
export function ChartCard({
  title,
  description,
  loading,
  empty,
  table,
  children,
  className,
}: {
  title: string;
  description?: string;
  loading?: boolean;
  /** Texto cuando no hay datos. */
  empty?: string | null;
  table?: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className={cn('viz-root gap-3', className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {table && !loading && !empty && (
          <Button
            variant="ghost"
            size="sm"
            className="-mt-1 h-7 text-xs"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
          >
            <TableIcon aria-hidden /> {showTable ? 'Ver gráfica' : 'Ver tabla'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : empty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
        ) : showTable && table ? (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  {table.head.map((h, i) => (
                    <th key={h} className={cn('py-1.5 font-medium', i > 0 && 'text-right')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {r.map((c, j) => (
                      <td key={j} className={cn('py-1.5', j > 0 && 'text-right tabular-nums')}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Lista de barras con nombre, barra y cifra por fila (ranking de servicios, productos, sedes):
 * un solo tono, extremos redondeados, cifra en texto.
 */
export function MeterList({
  rows,
}: {
  rows: { key: string; label: string; value: number; display: string; hint?: string | undefined }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <span className="truncate text-sm" title={r.label}>
            {r.label}
          </span>
          <span className="text-right text-sm font-medium tabular-nums">
            {r.display}
            {r.hint && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{r.hint}</span>}
          </span>
          <div className="col-span-2 h-2 rounded-full bg-muted" aria-hidden>
            <div
              className="viz-bar h-2 rounded-full bg-(--series-1)"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAYS_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** Paso de la rampa secuencial (azul, de casi nada a mucho) para un valor. */
const step = (value: number, max: number) => (value === 0 ? 0 : Math.min(7, Math.max(1, Math.ceil((value / max) * 7))));

/** Mapa de calor día × hora, rampa secuencial de un solo tono, con tooltip y leyenda. */
export function Heatmap({ cells }: { cells: readonly HeatCell[] }) {
  const { hours, rows, max } = heatmapGrid(cells);
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const hovered = hover ? rows[hover.d]![hours.indexOf(hover.h)]! : 0;
  return (
    <div className="space-y-3">
      {/* Desplazable en móvil: enfocable para moverse con las flechas (axe scrollable-region-focusable,
          WCAG 2.1.1); jsx-a11y no contempla regiones desplazables. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Mapa de calor por día y hora">
        <div
          className="grid min-w-[28rem] gap-0.5 pr-3"
          style={{ gridTemplateColumns: `2.5rem repeat(${hours.length}, minmax(0, 1fr))` }}
          role="img"
          aria-label="Reservas por día de la semana y hora (usa «Ver tabla» para los valores)"
          onMouseLeave={() => setHover(null)}
        >
          <span />
          {hours.map((h) => (
            <span
              key={h}
              className="overflow-visible text-left text-[10px] whitespace-nowrap text-muted-foreground tabular-nums"
            >
              {h % 2 === 0 ? h : ''}
            </span>
          ))}
          {rows.map((row, d) => (
            <div key={d} className="contents">
              <span className="pr-1 text-right text-xs leading-6 text-muted-foreground">{DAYS[d]}</span>
              {row.map((v, i) => (
                <span
                  key={i}
                  className={cn(
                    'viz-cell h-6 rounded-[3px]',
                    hover?.d === d && hover.h === hours[i] && 'ring-2 ring-foreground ring-offset-1 ring-offset-card',
                  )}
                  style={{ background: `var(--seq-${step(v, max)})` }}
                  onMouseEnter={() => setHover({ d, h: hours[i]! })}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span aria-live="polite" className="min-h-4">
          {hover
            ? `${DAYS_LONG[hover.d]} ${hover.h}:00 – ${hover.h + 1}:00 · ${hovered} ${hovered === 1 ? 'reserva' : 'reservas'}`
            : 'Pasa el cursor por una celda para ver el detalle.'}
        </span>
        <span className="flex items-center gap-1">
          0
          {[1, 3, 5, 7].map((s) => (
            <span
              key={s}
              className="viz-cell inline-block size-3 rounded-[2px]"
              style={{ background: `var(--seq-${s})` }}
            />
          ))}
          {max}
        </span>
      </div>
    </div>
  );
}

const STATUS_ORDER: BookingStatus[] = ['confirmed', 'completed', 'pending', 'no_show', 'cancelled'];
const STATUS_SERIES: Record<BookingStatus, string> = {
  confirmed: 'var(--series-1)',
  completed: 'var(--series-3)',
  pending: 'var(--series-4)',
  no_show: 'var(--series-2)',
  cancelled: 'var(--series-5)',
};

/**
 * Reparto por estado en una barra segmentada (en lugar de una dona, que compara mal valores
 * cercanos), con leyenda que trae el número y el porcentaje: la identidad nunca es solo color.
 */
export function StatusBar({ byStatus }: { byStatus: Record<BookingStatus, number> }) {
  const total = STATUS_ORDER.reduce((s, k) => s + byStatus[k], 0);
  const pct = (n: number) =>
    new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 0 }).format(n / total);
  return (
    <div className="space-y-3">
      <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-md" aria-hidden>
        {STATUS_ORDER.filter((k) => byStatus[k] > 0).map((k) => (
          <div
            key={k}
            className="viz-bar h-full first:rounded-l-md last:rounded-r-md"
            style={{ width: `${(byStatus[k] / total) * 100}%`, background: STATUS_SERIES[k] }}
            title={`${STATUS_LABELS[k]}: ${byStatus[k]}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {STATUS_ORDER.map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span
              className="viz-cell size-2.5 shrink-0 rounded-[2px]"
              style={{ background: STATUS_SERIES[k] }}
              aria-hidden
            />
            <span className="truncate">{STATUS_LABELS[k]}</span>
            <span className="ml-auto font-medium tabular-nums">{byStatus[k]}</span>
            <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{pct(byStatus[k])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
