import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@client/lib/api';
import { useMembership } from '@client/features/auth/membership';

const DEBOUNCE_MS = 800;

/**
 * Tras cada guardado correcto en el panel, invalida la caché del sitio público (fase 09 §2):
 * el cambio se ve al instante y no al vencer los 60 s. Varios guardados seguidos (p. ej.
 * reordenar) se agrupan en una sola llamada. Solo owner/admin pueden editar contenido.
 */
export function usePurgePublicOnSave() {
  const queryClient = useQueryClient();
  const { role } = useMembership();
  const enabled = role === 'owner' || role === 'admin' || role === 'platform_admin';

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Si falla, el sitio se actualiza igual al vencer la caché.
        apiFetch('/api/admin/purge-public', { method: 'POST' }).catch(() => undefined);
      }, DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [queryClient, enabled]);
}
