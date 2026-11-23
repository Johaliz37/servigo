import type { ClientTenant } from '@shared/tenant';

declare global {
  interface Window {
    /** Inyectado por el Worker con HTMLRewriter en cada navegación HTML. */
    __TENANT__?: ClientTenant;
  }
}

/**
 * Tenant inyectado por el Worker o, si la página no pasó por el HTMLRewriter,
 * pedido a `/api/public/tenant`. `null` = el Worker respondió algo inesperado.
 */
export async function loadTenant(): Promise<ClientTenant | null> {
  if (window.__TENANT__) return window.__TENANT__;
  try {
    const res = await fetch('/api/public/tenant', { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as ClientTenant;
  } catch {
    return null;
  }
}
