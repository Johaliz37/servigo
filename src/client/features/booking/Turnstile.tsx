import { useEffect, useRef } from 'react';

/**
 * Widget de Cloudflare Turnstile (gratis, sin cookies de rastreo). Modo *managed*: casi
 * siempre se resuelve solo. `onToken(null)` cuando vence o falla, para deshabilitar el envío.
 *
 * En desarrollo, sin `VITE_TURNSTILE_SITE_KEY`, usa la clave de prueba que siempre valida
 * (developers.cloudflare.com/turnstile/troubleshooting/testing).
 */
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || (import.meta.env.DEV ? '1x00000000000000000000AA' : '');
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile')));
    script.onerror = () => {
      loading = null;
      reject(new Error('No se pudo cargar la verificación'));
    };
    document.head.append(script);
  });
  return loading;
}

export function Turnstile({ onToken, action }: { onToken: (token: string | null) => void; action?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    void loadTurnstile()
      .then((api) => {
        if (cancelled || !box.current) return;
        id = api.render(box.current, {
          sitekey: SITE_KEY,
          action,
          language: 'es',
          appearance: 'interaction-only',
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(null),
          'error-callback': () => callback.current(null),
        });
      })
      .catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [action]);

  return <div ref={box} className="min-h-0" />;
}
