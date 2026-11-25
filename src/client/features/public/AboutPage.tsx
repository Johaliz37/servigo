import { lazy, Suspense, useEffect } from 'react';
import { InfoIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { branchPath } from '@shared/public-site';
import { Skeleton } from '@client/components/ui/skeleton';
import { useCompany } from '@client/app/tenant-context';
import { usePublicAbout } from './api';
import { useDocumentTitle } from './hooks';
import { PublicImg, PublicNotFound, QueryError } from './ui';

// El Markdown solo se descarga si hay texto (fase 09 §4).
const Markdown = lazy(async () => ({ default: (await import('@client/components/common/Markdown')).Markdown }));

/** «Acerca de» (fase 09 §3): sección general y una por sede, con ancla `#sede-{slug}`. */
export function Component() {
  const company = useCompany();
  const about = usePublicAbout();
  const { hash } = useLocation();
  useDocumentTitle(`Acerca de · ${company.name}`);

  // El ancla de una sede existe cuando llegan los datos.
  useEffect(() => {
    if (!about.data || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [about.data, hash]);

  if (about.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-12" aria-busy="true" aria-label="Cargando">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="aspect-[16/9] w-full rounded-2xl" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (about.isError) return <QueryError error={about.error} onRetry={() => void about.refetch()} />;
  if (!about.data.length) {
    return <PublicNotFound icon={InfoIcon} title="Acerca de" message="Pronto contaremos más sobre nosotros." />;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <h1 className="mb-8 text-3xl font-semibold tracking-tight sm:text-4xl">Acerca de {company.name}</h1>
      <div className="space-y-14">
        {about.data.map((s, i) => {
          const id = s.branch_slug ? `sede-${s.branch_slug}` : 'empresa';
          return (
            <section key={id} id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-4">
              <div className="space-y-1">
                {s.branch_name && <p className="text-sm font-medium text-primary">{s.branch_name}</p>}
                <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight">
                  {s.title || s.branch_name || company.name}
                </h2>
              </div>
              {s.image_path && (
                <PublicImg
                  path={s.image_path}
                  alt=""
                  width={1600}
                  height={900}
                  sizes="(min-width: 768px) 768px, 100vw"
                  priority={i === 0}
                  className="aspect-[16/9] w-full rounded-2xl object-cover"
                />
              )}
              {s.body && (
                <Suspense fallback={<Skeleton className="h-16 w-full" />}>
                  <Markdown className="text-base">{s.body}</Markdown>
                </Suspense>
              )}
              {s.branch_slug && (
                <Link
                  to={branchPath(s.branch_slug)}
                  className="inline-block text-sm font-medium text-primary hover:underline"
                >
                  Ver {s.branch_name}
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
