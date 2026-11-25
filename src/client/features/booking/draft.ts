import { useCallback, useState } from 'react';
import type { CustomerInput } from '@shared/booking';

/**
 * Borrador de la reserva en `sessionStorage` (fase 10 §1): recargar la página no pierde lo
 * escrito. Fecha y hora van en la URL (`?step=&date=&slot=`); el resto, aquí.
 */
export interface BookingDraft {
  quantities: Record<string, number>;
  customer: CustomerInput;
  answers: Record<string, unknown>;
  accept_terms: boolean;
}

export const emptyDraft = (): BookingDraft => ({
  quantities: {},
  customer: { name: '', phone: '', email: '', notes: '' },
  answers: {},
  accept_terms: false,
});

const keyOf = (companyId: string, branchSlug: string, serviceId: string) =>
  `servigo:booking-draft:${companyId}:${branchSlug}:${serviceId}`;

function read(key: string): BookingDraft {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? { ...emptyDraft(), ...(JSON.parse(raw) as Partial<BookingDraft>) } : emptyDraft();
  } catch {
    return emptyDraft();
  }
}

export function useDraft(companyId: string, branchSlug: string, serviceId: string | undefined) {
  const key = keyOf(companyId, branchSlug, serviceId ?? 'none');
  const [state, setState] = useState(() => ({ key, draft: read(key) }));
  // Otro servicio → otro borrador (ajuste durante el render, sin efecto).
  const current = state.key === key ? state.draft : read(key);
  if (state.key !== key) setState({ key, draft: current });

  const update = useCallback((patch: Partial<BookingDraft>) => {
    setState((prev) => {
      const next = { ...prev.draft, ...patch };
      try {
        sessionStorage.setItem(prev.key, JSON.stringify(next));
      } catch {
        // Sin sessionStorage: el borrador vive en memoria.
      }
      return { key: prev.key, draft: next };
    });
  }, []);

  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // nada
    }
  }, [key]);

  return { draft: current, update, clear };
}

export type StepId = 'servicio' | 'fecha' | 'productos' | 'datos' | 'confirmar';

export const STEP_LABELS: Record<StepId, string> = {
  servicio: 'Servicio',
  fecha: 'Fecha y hora',
  productos: 'Productos',
  datos: 'Tus datos',
  confirmar: 'Confirmar',
};

/** Pasos visibles: «Productos» solo si el servicio tiene complementos. */
export function stepsFor(hasAddons: boolean): StepId[] {
  return ['servicio', 'fecha', ...(hasAddons ? (['productos'] as const) : []), 'datos', 'confirmar'];
}
