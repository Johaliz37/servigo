import { createContext, use, useState, type ReactNode } from 'react';
import type { ClientTenant, TenantCompany } from '@shared/tenant';
import { applyBrand } from '@client/lib/brand';

interface TenantContextValue {
  tenant: ClientTenant;
  /** Reemplaza el tenant (p. ej. tras editar el perfil) y reaplica la marca. */
  setTenant: (tenant: ClientTenant) => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

function applyFavicon(url: string | null) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link && url) link.href = url;
}

export function TenantProvider({ tenant: initial, children }: { tenant: ClientTenant; children: ReactNode }) {
  const [tenant, setState] = useState(initial);

  function setTenant(next: ClientTenant) {
    setState(next);
    if (next.type === 'company') {
      applyBrand(next.company.primaryColor, next.company.secondaryColor);
      applyFavicon(next.company.faviconUrl);
    }
  }

  return <TenantContext value={{ tenant, setTenant }}>{children}</TenantContext>;
}

function useTenantContext(): TenantContextValue {
  const value = use(TenantContext);
  if (!value) throw new Error('useTenant fuera de TenantProvider');
  return value;
}

export function useTenant(): ClientTenant {
  return useTenantContext().tenant;
}

export function useSetTenant(): (tenant: ClientTenant) => void {
  return useTenantContext().setTenant;
}

/** Empresa del subdominio. Solo en rutas de empresa (el router de plataforma no las monta). */
export function useCompany(): TenantCompany {
  const tenant = useTenant();
  if (tenant.type !== 'company') throw new Error('useCompany fuera de un sitio de empresa');
  return tenant.company;
}
