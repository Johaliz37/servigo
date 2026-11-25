import { useMemo, useState } from 'react';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { Button } from '@client/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@client/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@client/components/ui/popover';
import { cn } from '@client/lib/utils';

/** Las más usadas por los clientes de Servigo, primero. */
const COMMON = [
  'America/Bogota',
  'America/Mexico_City',
  'America/Lima',
  'America/Guayaquil',
  'America/Panama',
  'America/Caracas',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'Europe/Madrid',
];

function allZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return COMMON;
  }
}

/** Desfase actual legible, p. ej. "GMT-5". */
function offsetOf(zone: string): string {
  try {
    return (
      new Intl.DateTimeFormat('es', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    );
  } catch {
    return '';
  }
}

const label = (zone: string) => zone.replace(/_/g, ' ');

/** Combo IANA con búsqueda (fase 05 §2). `allowEmpty` añade "La de la empresa" (null). */
export function TimezoneCombobox({
  value,
  onChange,
  id,
  allowEmpty,
  emptyLabel = 'La de la empresa',
}: {
  value: string | null;
  onChange: (zone: string | null) => void;
  id?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => {
    const rest = allZones().filter((z) => !COMMON.includes(z));
    return { common: COMMON, rest };
  }, []);

  function pick(zone: string | null) {
    onChange(zone);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{value ? `${label(value)} (${offsetOf(value)})` : emptyLabel}</span>
          <ChevronsUpDownIcon className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar ciudad o zona…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            {allowEmpty && (
              <CommandGroup>
                <CommandItem value={emptyLabel} onSelect={() => pick(null)}>
                  <CheckIcon className={cn(value === null ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  {emptyLabel}
                </CommandItem>
              </CommandGroup>
            )}
            {(['common', 'rest'] as const).map((group) => (
              <CommandGroup key={group} heading={group === 'common' ? 'Frecuentes' : 'Todas'}>
                {zones[group].map((zone) => (
                  <CommandItem key={zone} value={zone} keywords={[label(zone)]} onSelect={() => pick(zone)}>
                    <CheckIcon className={cn(value === zone ? 'opacity-100' : 'opacity-0')} aria-hidden />
                    <span className="truncate">{label(zone)}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{offsetOf(zone)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
