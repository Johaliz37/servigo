import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { formatCode } from '@shared/booking';
import { useCompany } from '@client/app/tenant-context';
import { supabase } from '@client/lib/supabase';

const SOUND_KEY = 'servigo:new-booking-sound';

function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === '1';
  } catch {
    return false;
  }
}

const listeners = new Set<(on: boolean) => void>();

/** Sonido opcional al llegar una reserva (preferencia de este navegador). */
export function useSoundSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readSound);
  useEffect(() => {
    listeners.add(setOn);
    return () => void listeners.delete(setOn);
  }, []);
  return [
    on,
    (next) => {
      try {
        localStorage.setItem(SOUND_KEY, next ? '1' : '0');
      } catch {
        // Sin localStorage: dura la sesión.
      }
      for (const l of listeners) l(next);
      if (next) beep();
    },
  ];
}

/** Dos tonos cortos con Web Audio (sin archivos de audio). */
function beep() {
  try {
    const ctx = new AudioContext();
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.15 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.15 + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.15);
    }
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // Navegador sin Web Audio o sin interacción previa: solo el aviso visual.
  }
}

interface BookingChange {
  id: string;
  code: string;
  source: string;
  branch_id: string;
  customer_name: string;
  service_name: string;
}

/**
 * Tiempo real (fase 11 §1): escucha los cambios de `bookings` de la empresa. Supabase Realtime
 * aplica RLS, así que staff solo recibe los de sus sedes. Una reserva web nueva muestra un
 * aviso (y suena si está activado); cualquier cambio refresca bandeja, calendario y contador.
 */
export function useBookingsRealtime() {
  const company = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['admin-bookings'] });
        void queryClient.invalidateQueries({ queryKey: ['admin-booking'] });
        void queryClient.invalidateQueries({ queryKey: ['calendar-bookings'] });
      }, 300);
    };

    const channel = supabase
      .channel(`bookings:${company.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `company_id=eq.${company.id}` },
        (payload) => {
          refresh();
          if (payload.eventType !== 'INSERT') return;
          const b = payload.new as BookingChange;
          if (b.source !== 'web') return;
          if (readSound()) beep();
          toast.info(`Nueva reserva ${formatCode(b.code)}`, {
            description: `${b.customer_name} · ${b.service_name}`,
            duration: 10_000,
            action: { label: 'Ver', onClick: () => void navigateRef.current(`/admin/reservas?tab=pending&b=${b.id}`) },
          });
        },
      )
      .subscribe();

    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [company.id, queryClient]);
}

/** Pendientes (contador del menú lateral y de la pestaña). */
export function usePendingCount(branchId: string | null) {
  const company = useCompany();
  return useQuery({
    queryKey: ['admin-bookings', company.id, 'pending-count', branchId],
    staleTime: 30_000,
    queryFn: async () => {
      let query = supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', company.id)
        .eq('status', 'pending');
      if (branchId) query = query.eq('branch_id', branchId);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
  });
}
