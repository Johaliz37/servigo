import { lazy, Suspense } from 'react';
import { privacyTemplate } from '@shared/privacy';
import { Skeleton } from '@client/components/ui/skeleton';
import { useCompany } from '@client/app/tenant-context';
import { usePublicPrivacy, usePublicSite } from './api';
import { useDocumentTitle } from './hooks';
import { QueryError } from './ui';

const Markdown = lazy(async () => ({ default: (await import('@client/components/common/Markdown')).Markdown }));

/** Política de privacidad (fase 13, D31): texto propio de la empresa o la plantilla con sus datos. */
export function Component() {
  const company = useCompany();
  const privacy = usePublicPrivacy();
  const site = usePublicSite();
  useDocumentTitle(`Política de privacidad · ${company.name}`);

  if (privacy.isError) return <QueryError error={privacy.error} onRetry={() => void privacy.refetch()} />;
  const ready = privacy.data && (privacy.data.policy !== null || site.data);
  const text =
    privacy.data?.policy ??
    (site.data
      ? privacyTemplate({
          name: site.data.company.name,
          email: site.data.company.contact.email,
          phone: site.data.company.contact.phone,
          address: site.data.company.footer.address ?? null,
        })
      : '');
  const updated = privacy.data?.updated_at
    ? new Intl.DateTimeFormat(company.locale, { dateStyle: 'long' }).format(new Date(privacy.data.updated_at))
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <h1 className="mb-2 text-3xl font-semibold tracking-tight sm:text-4xl">Política de privacidad</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Tratamiento de datos personales de {company.name}
        {updated && ` · Actualizada el ${updated}`}
      </p>
      {ready ? (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Markdown className="text-base">{text}</Markdown>
        </Suspense>
      ) : (
        <div className="space-y-3" aria-busy="true" aria-label="Cargando">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
    </div>
  );
}
