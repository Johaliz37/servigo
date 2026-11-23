import { createContext, use, type ReactNode } from 'react';
import type { ClientTenant, TenantCompany } from '@shared/tenant';

const TenantContext = createContext<ClientTenant | null>(null);

export function TenantProvider({ tenant, children }: { tenant: ClientTenant; children: ReactNode }) {
  return <TenantContext value={tenant}>{children}</TenantContext>;
}

export function useTenant(): ClientTenant {
  const tenant = use(TenantContext);
  if (!tenant) throw new Error('useTenant fuera de TenantProvider');
  return tenant;
}

/** Empresa del subdominio. Solo en rutas de empresa (el router de plataforma no las monta). */
export function useCompany(): TenantCompany {
  const tenant = useTenant();
  if (tenant.type !== 'company') throw new Error('useCompany fuera de un sitio de empresa');
  return tenant.company;
}
