/** Utilidades del sitio público (sin componentes, para Fast Refresh). */
import { useEffect } from 'react';
import { formatMoney } from '@shared/money';
import type { PublicSocial } from '@shared/public-site';
import { useCompany } from '@client/app/tenant-context';

export function useMoney() {
  const company = useCompany();
  return (amount: number) => formatMoney(amount, company.currency, company.locale);
}

const NETWORK_NAMES: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  x: 'X',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  website: 'Sitio web',
  email: 'Correo',
  phone: 'Teléfono',
  other: 'Enlace',
};

export const socialLabel = (s: PublicSocial) => s.label?.trim() || NETWORK_NAMES[s.network] || 'Enlace';

/** Título de la pestaña en la navegación dentro de la SPA (el primero lo pone el Worker). */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

// ---------------------------------------------------------------------------
// Última sede elegida (para «Continuar en …»)
// ---------------------------------------------------------------------------

const lastBranchKey = (companyId: string) => `servigo:last-branch:${companyId}`;

export function readLastBranch(companyId: string): string | null {
  try {
    return localStorage.getItem(lastBranchKey(companyId));
  } catch {
    return null;
  }
}

export function rememberBranch(companyId: string, slug: string): void {
  try {
    localStorage.setItem(lastBranchKey(companyId), slug);
  } catch {
    // Sin localStorage (modo privado estricto): no se recuerda.
  }
}
