import { useEffect } from 'react';
import { CalendarCheckIcon, MapPinIcon, PhoneIcon, SparklesIcon } from 'lucide-react';
import { Link, useParams } from 'react-router';
import {
  bookingPath,
  mapsUrl,
  telUrl,
  whatsappUrl,
  type PublicBranch,
  type PublicItem,
  type PublicSponsor,
} from '@shared/public-site';
import { EmptyState } from '@client/components/common/EmptyState';
import { SocialIcon } from '@client/components/common/SocialIcon';
import { Button } from '@client/components/ui/button';
import { Skeleton } from '@client/components/ui/skeleton';
import { useCompany } from '@client/app/tenant-context';
import { cn } from '@client/lib/utils';
import { SnapCarousel } from './SnapCarousel';
import { isNotFound, usePublicBranch, usePublicSite } from './api';
import { rememberBranch, useDocumentTitle } from './hooks';
import {
  BrandPlaceholder,
  ItemCard,
  ItemCardSkeleton,
  PublicImg,
  PublicNotFound,
  QueryError,
  Section,
  SocialLinks,
} from './ui';

// ---------------------------------------------------------------------------
// 3.1 Encabezado
// ---------------------------------------------------------------------------

function BranchHeader({ data }: { data: PublicBranch }) {
  const site = usePublicSite();
  const { branch } = data;
  const image = branch.header.image_path ?? branch.cover_image_path;
  const overlay = branch.header.overlay_opacity ?? 0.4;
  const title = branch.header.title?.trim() || branch.name;
  const subtitle = branch.header.subtitle?.trim();
  const whatsapp = whatsappUrl(
    branch.whatsapp ?? site.data?.company.contact.whatsapp,
    `Hola, quiero información de ${branch.name}`,
  );
  const phone = telUrl(branch.phone);
  const maps = mapsUrl(branch);
  const address = [branch.address, branch.city].filter(Boolean).join(', ');

  return (
    <section
      data-section="header"
      aria-labelledby="sede-title"
      className={cn(
        'relative isolate overflow-hidden',
        image ? 'text-white' : 'bg-gradient-to-br from-primary/15 via-background to-background',
      )}
    >
      {image && (
        <>
          <PublicImg
            path={image}
            alt=""
            width={1600}
            height={900}
            sizes="100vw"
            priority
            className="absolute inset-0 -z-10 size-full object-cover"
          />
          <div aria-hidden className="absolute inset-0 -z-10 bg-black" style={{ opacity: overlay }} />
        </>
      )}
      <div className="mx-auto flex min-h-[22rem] max-w-6xl flex-col justify-end gap-5 px-4 py-12 sm:min-h-[28rem] sm:py-16">
        <div className="max-w-2xl space-y-3">
          <h1 id="sede-title" className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {title}
          </h1>
          {subtitle && <p className={cn('text-lg', image ? 'text-white/90' : 'text-muted-foreground')}>{subtitle}</p>}
          {address &&
            (maps ? (
              <a
                href={maps}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline',
                  image ? 'text-white/90' : 'text-muted-foreground',
                )}
              >
                <MapPinIcon aria-hidden className="size-4 shrink-0" />
                {address}
                <span className="sr-only"> (abre Google Maps)</span>
              </a>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-sm">
                <MapPinIcon aria-hidden className="size-4 shrink-0" />
                {address}
              </p>
            ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to={bookingPath(branch.slug)}>
              <CalendarCheckIcon aria-hidden /> Reservar
            </Link>
          </Button>
          {whatsapp && (
            <Button
              asChild
              size="lg"
              variant="outline"
              className={cn(image && 'border-white/60 bg-white/10 text-white hover:bg-white/20 hover:text-white')}
            >
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                <SocialIcon network="whatsapp" /> WhatsApp
              </a>
            </Button>
          )}
          {phone && (
            <Button
              asChild
              size="lg"
              variant="outline"
              className={cn(image && 'border-white/60 bg-white/10 text-white hover:bg-white/20 hover:text-white')}
            >
              <a href={phone}>
                <PhoneIcon aria-hidden /> Llamar
              </a>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3.2 Servicios (carrusel) y productos
// ---------------------------------------------------------------------------

function ServicesCarousel({ items, branchSlug }: { items: PublicItem[]; branchSlug: string }) {
  return (
    <SnapCarousel
      items={items}
      label="Carrusel de servicios"
      itemKey={(item) => item.id}
      itemLabel={(item) => item.name}
      renderItem={(item) => <ItemCard item={item} branchSlug={branchSlug} />}
    />
  );
}

// ---------------------------------------------------------------------------
// 3.3 Patrocinadores
// ---------------------------------------------------------------------------

function SponsorCard({ sponsor }: { sponsor: PublicSponsor }) {
  const body = (
    <>
      <div className="flex h-20 w-full items-center justify-center">
        {sponsor.image_path ? (
          <PublicImg
            path={sponsor.image_path}
            alt={sponsor.name}
            width={160}
            height={80}
            sizes="160px"
            className="max-h-20 w-auto max-w-full object-contain"
          />
        ) : (
          <BrandPlaceholder label={sponsor.name} className="size-16 rounded-full text-2xl" />
        )}
      </div>
      <p className="font-medium">{sponsor.name}</p>
      {sponsor.description && <p className="text-sm text-muted-foreground">{sponsor.description}</p>}
    </>
  );
  const className = 'flex h-full flex-col items-center gap-2 rounded-xl border bg-card p-5 text-center';
  return (
    <li>
      {sponsor.url ? (
        <a
          href={sponsor.url}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className={cn(
            className,
            'transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          )}
        >
          {body}
        </a>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function BranchSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-[22rem] rounded-none sm:h-[28rem]" />
      <div className="mx-auto max-w-6xl px-4 py-10">
        <Skeleton className="mb-6 h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ItemCardSkeleton />
          <ItemCardSkeleton />
          <ItemCardSkeleton />
        </div>
      </div>
    </div>
  );
}

/** Página de la sede (fase 09 §3): 3.1 encabezado · 3.2 servicios · 3.3 patrocinadores · 3.4 redes. */
export function Component() {
  const { branchSlug = '' } = useParams();
  const company = useCompany();
  const query = usePublicBranch(branchSlug.toLowerCase());
  const data = query.data;
  useDocumentTitle(data ? `${data.branch.name} · ${company.name}` : null);

  useEffect(() => {
    if (data) rememberBranch(company.id, data.branch.slug);
  }, [data, company.id]);

  if (query.isPending) return <BranchSkeleton />;
  if (query.isError) {
    return isNotFound(query.error) ? (
      <PublicNotFound
        title="Esta sede no existe"
        message="Puede que haya cambiado de dirección o ya no esté disponible."
      />
    ) : (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  const slug = data!.branch.slug;
  const { services, products, sponsors, socials } = data!;

  return (
    <>
      <BranchHeader data={data!} />

      <Section id="servicios" section="services" title="Servicios" description="Elige un servicio y reserva en línea.">
        {services.length ? (
          <ServicesCarousel items={services} branchSlug={slug} />
        ) : (
          <EmptyState icon={SparklesIcon} title="Pronto publicaremos nuestros servicios" />
        )}
      </Section>

      {products.length > 0 && (
        <Section id="productos" section="products" title="Productos" className="pt-0 sm:pt-0">
          <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {products.map((p) => (
              <li key={p.id}>
                <ItemCard item={p} branchSlug={slug} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {sponsors.length > 0 && (
        <Section id="patrocinadores" section="sponsors" title="Patrocinadores" className="bg-muted/30">
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {sponsors.map((s) => (
              <SponsorCard key={s.name + (s.url ?? '')} sponsor={s} />
            ))}
          </ul>
        </Section>
      )}

      {socials.length > 0 && (
        <Section id="redes" section="socials" title="Síguenos" className="text-center [&_h2]:text-center">
          <SocialLinks links={socials} large />
        </Section>
      )}
    </>
  );
}
