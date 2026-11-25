import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { cn } from '@client/lib/utils';

/**
 * Botón que despliega un panel (selector de sede, menú móvil) sin Radix: el sitio público
 * ahorra ~30 KB gzip de JS inicial (fase 09 §4). Patrón *disclosure*: `aria-expanded` +
 * `aria-controls`; se cierra con Escape (devolviendo el foco), al hacer clic fuera y al navegar.
 */
export function Disclosure({
  label,
  children,
  buttonClassName,
  panelClassName,
  buttonLabel,
}: {
  /** Contenido del botón. */
  label: ReactNode;
  /** Nombre accesible del botón si `label` es solo un ícono. */
  buttonLabel?: string;
  children: ReactNode;
  buttonClassName?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const [openedAt, setOpenedAt] = useState(location.key);

  // Cerrar al navegar (ajuste de estado durante el render, sin efecto).
  if (open && openedAt !== location.key) {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={buttonLabel}
        onClick={() => {
          setOpenedAt(location.key);
          setOpen((v) => !v);
        }}
        className={buttonClassName}
      >
        {label}
      </button>
      <div
        id={id}
        hidden={!open}
        className={cn(
          'absolute right-0 z-50 mt-2 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg',
          panelClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
