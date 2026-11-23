import { useEffect, useSyncExternalStore } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * Modo oscuro según el sistema mientras el componente esté montado (admin y consola).
 * El sitio público no lo usa: queda en claro por defecto (fase 03 §2).
 */
export function useSystemDarkMode(): void {
  const dark = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    return () => root.classList.remove('dark');
  }, [dark]);
}
