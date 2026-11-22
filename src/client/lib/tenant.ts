import type { ResolvedTenant } from '@shared/tenant';

declare global {
  interface Window {
    /** Inyectado por el Worker con HTMLRewriter en cada navegación HTML. */
    __TENANT__?: ResolvedTenant;
  }
}

/** Tenant resuelto por el Worker. Si falta, la página no pasó por el Worker. */
export function getTenant(): ResolvedTenant {
  return window.__TENANT__ ?? { type: 'not_found' };
}
