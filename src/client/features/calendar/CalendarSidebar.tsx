import { useState } from 'react';
import { es } from 'date-fns/locale';
import { CalendarPlusIcon, KeyboardIcon, PlusIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@client/components/ui/button';
import { Calendar } from '@client/components/ui/calendar';
import { Checkbox } from '@client/components/ui/checkbox';
import { Label } from '@client/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Switch } from '@client/components/ui/switch';
import type { CalendarService } from './api';
import { KIND_COLORS, TEMPLATES } from './model';

export interface Layers {
  open: boolean;
  closed: boolean;
  bookings: boolean;
}

const LAYERS: { key: keyof Layers; label: string; swatch: string }[] = [
  { key: 'open', label: 'Atención', swatch: KIND_COLORS.open },
  { key: 'closed', label: 'No disponible', swatch: KIND_COLORS.closed },
  { key: 'bookings', label: 'Reservas', swatch: 'var(--primary)' },
];

const SHORTCUTS: [string, string][] = [
  ['t', 'Hoy'],
  ['d / w / m / a', 'Día, semana, mes, agenda'],
  ['j / k', 'Siguiente / anterior'],
  ['c', 'Crear'],
  ['Esc', 'Cerrar'],
];

const toLocalDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
const fromLocalDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Panel izquierdo del calendario (en móvil va dentro de un Sheet). */
export function CalendarSidebar({
  editable,
  currentDate,
  onDate,
  onCreate,
  layers,
  onLayers,
  services,
  serviceFilter,
  onServiceFilter,
  slotsAvailable,
  showSlots,
  onShowSlots,
  onTemplate,
  onHolidays,
  year,
  onUseGeneral,
}: {
  editable: boolean;
  currentDate: string;
  onDate: (date: string) => void;
  onCreate: () => void;
  layers: Layers;
  onLayers: (layers: Layers) => void;
  services: CalendarService[];
  serviceFilter: string;
  onServiceFilter: (id: string) => void;
  slotsAvailable: boolean;
  showSlots: boolean;
  onShowSlots: (on: boolean) => void;
  onTemplate: (id: string) => void;
  onHolidays: () => void;
  year: number;
  /** Solo si la sede tiene horario propio y el usuario puede cambiarlo. */
  onUseGeneral?: () => void;
}) {
  const selected = toLocalDate(currentDate);
  const [month, setMonth] = useState(selected);
  const [shownFor, setShownFor] = useState(currentDate);
  // El mini calendario sigue al principal cuando este cambia de mes.
  if (shownFor !== currentDate) {
    setShownFor(currentDate);
    setMonth(selected);
  }
  const slotsEnabled = slotsAvailable && serviceFilter !== 'all';

  return (
    <div className="space-y-6 p-3">
      {editable && (
        <Button
          onClick={onCreate}
          variant="outline"
          className="h-12 rounded-2xl px-5 text-sm font-medium shadow-md hover:shadow-lg"
          title="Crear (c)"
        >
          <PlusIcon className="size-5" aria-hidden /> Crear
        </Button>
      )}

      <Calendar
        mode="single"
        locale={es}
        weekStartsOn={1}
        selected={selected}
        month={month}
        onMonthChange={setMonth}
        onSelect={(d) => d && onDate(fromLocalDate(d))}
        className="-mx-1 p-0 [--cell-size:--spacing(7.5)]"
        aria-label="Mini calendario"
      />

      <section aria-labelledby="layers-title" className="space-y-2">
        <h2 id="layers-title" className="text-sm font-medium">
          Mis calendarios
        </h2>
        {LAYERS.map((layer) => (
          <Label key={layer.key} className="flex items-center gap-3 font-normal">
            <Checkbox
              checked={layers[layer.key]}
              onCheckedChange={(on) => onLayers({ ...layers, [layer.key]: on === true })}
              style={{ ['--layer' as string]: layer.swatch }}
              className="border-[var(--layer)] data-[state=checked]:border-[var(--layer)] data-[state=checked]:bg-[var(--layer)]"
            />
            {layer.label}
          </Label>
        ))}
      </section>

      <section aria-labelledby="filter-title" className="space-y-3">
        <h2 id="filter-title" className="text-sm font-medium">
          Servicio
        </h2>
        <Select value={serviceFilter} onValueChange={onServiceFilter}>
          <SelectTrigger className="w-full" aria-label="Filtrar por servicio">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los servicios</SelectItem>
            {services.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-start justify-between gap-3">
          <Label htmlFor="show-slots" className="flex-col items-start gap-1 font-normal">
            <span className="font-medium">Mostrar horarios reservables</span>
            <span className="text-xs text-muted-foreground">
              {!slotsAvailable
                ? 'Elige una sede para ver sus cupos.'
                : serviceFilter === 'all'
                  ? 'Elige un servicio para ver sus cupos.'
                  : 'Lo que verán tus clientes al reservar.'}
            </span>
          </Label>
          <Switch
            id="show-slots"
            checked={showSlots && slotsEnabled}
            disabled={!slotsEnabled}
            onCheckedChange={onShowSlots}
          />
        </div>
      </section>

      {editable && (
        <section aria-labelledby="templates-title" className="space-y-2">
          <h2 id="templates-title" className="flex items-center gap-2 text-sm font-medium">
            <SparklesIcon className="size-4" aria-hidden /> Plantillas rápidas
          </h2>
          <div className="flex flex-col gap-1">
            {TEMPLATES.map((t) => (
              <Button
                key={t.id}
                variant="ghost"
                size="sm"
                className="h-auto justify-start py-1.5 text-left whitespace-normal"
                onClick={() => onTemplate(t.id)}
              >
                {t.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-auto justify-start py-1.5 text-left whitespace-normal"
              onClick={onHolidays}
            >
              <CalendarPlusIcon aria-hidden /> Importar festivos de Colombia {year}
            </Button>
          </div>
        </section>
      )}

      {onUseGeneral && (
        <section aria-labelledby="own-title" className="space-y-2">
          <h2 id="own-title" className="text-sm font-medium">
            Horario propio de la sede
          </h2>
          <p className="text-xs text-muted-foreground">
            Esta sede no usa el horario general. Sus eventos se conservan si vuelves al general.
          </p>
          <Button variant="outline" size="sm" onClick={onUseGeneral}>
            Usar el horario general
          </Button>
        </section>
      )}

      <section aria-labelledby="keys-title" className="hidden space-y-2 md:block">
        <h2 id="keys-title" className="flex items-center gap-2 text-sm font-medium">
          <KeyboardIcon className="size-4" aria-hidden /> Atajos
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {SHORTCUTS.map(([k, label]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-1 font-mono text-foreground">{k}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
