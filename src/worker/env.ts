import type { ResolvedTenant, TenantCompany } from '@shared/tenant';

export type AppEnv = {
  Bindings: Env;
  Variables: {
    tenant: ResolvedTenant;
    /** Empresa del subdominio (solo si `tenant.type === 'company'` y existe). */
    company: TenantCompany | null;
  };
};
