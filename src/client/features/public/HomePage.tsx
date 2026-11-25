import { ArrowRightIcon, MapPinIcon, StoreIcon } from 'lucide-react';
import { Link, Navigate } from 'react-router';
import { branchPath, type PublicBranchCard } from '@shared/public-site';
import { EmptyState } from '@client/components/common/EmptyState';
import { Button } from '@client/components/ui/button';
import { Skeleton } from '@client/components/ui/skeleton';
import { useCompany } from '@client/app/tenant-context';
import { usePublicSite } from './api';
import { readLastBranch, useDocumentTitle } from './hooks';
import { BrandPlaceholder, PublicImg, QueryError } from './ui';

function BranchCard({ branch, priority }: { branch: PublicBranchCard; priority: boolean }) {
  return (
    <li>
      <Link
        to={branchPath(branch.slug)}
        className="group relative flex aspect-[16/10] overflow-hidden rounded-2xl bg-muted shadow-sm focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none"
      >
        {branch.cover_image_path ? (
          <PublicImg
            path={branch.cover_image_path}
            alt=""
            width={800}
            height={500}
            sizes="(min-width: 640px) 50vw, 100vw"
            priority={priority}
            className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <BrandPlaceholder label="" className="absolute inset-0" />
        )}
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
        <span className="relative mt-auto flex w-full items-end justify-between gap-3 p-5 text-white">
          <span className="min-w-0">
            <span className="block truncate text-xl font-semibold sm:text-2xl">{branch.name}</span>
            {branch.city && (
              <span className="mt-0.5 flex items-center gap-1 text-sm text-white/85">
                <MapPinIcon aria-hidden className="size-3.5" />
                {branch.city}
              </span>
            )}
          </span>
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur transition-colors group-hover:bg-white group-hover:text-black"
          >
            <ArrowRightIcon className="size-5" />
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Inicio (fase 09 §3): con una sede entra directo; con varias, hero de la empresa y tarjetas
 * de sede. Ofrece volver a la última sede visitada.
 */
export function HomePage() {
  const company = useCompany();
  const site = usePublicSite();
  useDocumentTitle(company.seo.title?.trim() || company.name);

  if (site.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-12" aria-busy="true" aria-label="Cargando">
        <Skeleton className="mx-auto h-10 w-64" />
        <div className="grid gap-6 sm:grid-cols-2">
          <Skeleton className="aspect-[16/10] rounded-2xl" />
          <Skeleton className="aspect-[16/10] rounded-2xl" />
        </div>
      </div>
    );
  }
  if (site.isError) return <QueryError error={site.error} onRetry={() => void site.refetch()} />;

  const { branches, company: info } = site.data;
  if (branches.length === 1) return <Navigate to={branchPath(branches[0]!.slug)} replace />;

  const last = readLastBranch(company.id);
  const lastBranch = branches.find((b) => b.slug === last);
  const hero = info.hero_image_path;

  return (
    <>
      <section className="relative isolate overflow-hidden">
        {hero ? (
          <PublicImg
            path={hero}
            alt=""
            width={1600}
            height={700}
            sizes="100vw"
            priority
            className="absolute inset-0 -z-10 size-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-background"
          />
        )}
        {hero && <div aria-hidden className="absolute inset-0 -z-10 bg-black/45" />}
        <div className={`mx-auto max-w-3xl px-4 py-16 text-center sm:py-24 ${hero ? 'text-white' : ''}`}>
          {company.logoUrl && (
            <img
              src={company.logoUrl}
              alt=""
              width={80}
              height={80}
              className="mx-auto mb-5 size-20 rounded-2xl bg-white/90 object-contain p-1.5 shadow-sm"
            />
          )}
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{company.name}</h1>
          {company.seo.description && (
            <p className={`mt-4 text-lg text-pretty ${hero ? 'text-white/90' : 'text-muted-foreground'}`}>
              {company.seo.description}
            </p>
          )}
          {lastBranch && (
            <Button asChild size="lg" className="mt-8">
              <Link to={branchPath(lastBranch.slug)}>
                Continuar en {lastBranch.name} <ArrowRightIcon aria-hidden />
              </Link>
            </Button>
          )}
        </div>
      </section>

      <section aria-labelledby="sedes-title" className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <h2 id="sedes-title" className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">
          Elige tu sede
        </h2>
        {branches.length === 0 ? (
          <EmptyState icon={StoreIcon} title="Pronto abriremos nuestras sedes" />
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2">
            {branches.map((b, i) => (
              <BranchCard key={b.slug} branch={b} priority={!hero && i < 2} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
