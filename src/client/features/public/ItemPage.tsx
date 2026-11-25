import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ExpandIcon, PackageIcon } from 'lucide-react';
import { Link, useParams } from 'react-router';
import {
  bookingPath,
  branchPath,
  discountDeadline,
  itemPath,
  whatsappUrl,
  type PublicItemDetail,
} from '@shared/public-site';
import { SocialIcon } from '@client/components/common/SocialIcon';
import { Button } from '@client/components/ui/button';
import { Skeleton } from '@client/components/ui/skeleton';
import { useCompany } from '@client/app/tenant-context';
import { cn } from '@client/lib/utils';
import { mediaUrl } from '@client/lib/media-url';
import { isNotFound, usePublicItem, usePublicSite } from './api';
import { useDocumentTitle, useMoney } from './hooks';
import { BrandPlaceholder, Duration, ItemPrice, PublicImg, PublicNotFound, QueryError } from './ui';

// Solo se descargan si hacen falta (descripción con Markdown, foto ampliada): fase 09 §4.
const Markdown = lazy(async () => ({ default: (await import('@client/components/common/Markdown')).Markdown }));
const Lightbox = lazy(() => import('./Lightbox'));

// ---------------------------------------------------------------------------
// Galería con lightbox
// ---------------------------------------------------------------------------

function Gallery({ item }: { item: PublicItemDetail }) {
  const track = useRef<HTMLUListElement>(null);
  const [selected, setSelected] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const photos = item.photos;

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const sync = () => setSelected(Math.round(el.scrollLeft / (el.clientWidth || 1)));
    el.addEventListener('scroll', sync, { passive: true });
    return () => el.removeEventListener('scroll', sync);
  }, []);

  if (!photos.length) {
    return <BrandPlaceholder label={item.name} className="aspect-[4/3] w-full rounded-2xl text-7xl" />;
  }

  const show = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth });
  };

  return (
    <div className="space-y-3">
      {/* Fotos con scroll-snap nativo (00 D27): swipe en móvil sin librería. */}
      <ul
        ref={track}
        aria-label="Fotos"
        className="flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto rounded-2xl bg-muted motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((p, i) => (
          <li key={p.path} className="w-full shrink-0 snap-start">
            <button
              type="button"
              onClick={() => setLightbox(i)}
              className="group relative block aspect-[4/3] w-full focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
              aria-label={`Ampliar foto ${i + 1} de ${photos.length}`}
            >
              <PublicImg
                path={p.path}
                alt={p.alt ?? ''}
                width={1600}
                height={1200}
                sizes="(min-width: 1024px) 50vw, 100vw"
                priority={i === 0}
                className="size-full object-cover"
              />
              <span className="absolute right-3 bottom-3 flex size-9 items-center justify-center rounded-full bg-black/50 text-white opacity-80 group-hover:opacity-100">
                <ExpandIcon aria-hidden className="size-4" />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Miniaturas">
          {photos.map((p, i) => (
            <button
              key={p.path}
              type="button"
              onClick={() => show(i)}
              aria-label={`Ver foto ${i + 1}`}
              aria-current={i === selected ? 'true' : undefined}
              className={cn(
                'size-16 shrink-0 overflow-hidden rounded-lg border-2 transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                i === selected ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100',
              )}
            >
              <img
                src={mediaUrl(p.thumb_path ?? p.path, p.thumb_path ? undefined : 'thumb') ?? ''}
                alt=""
                width={64}
                height={64}
                loading="lazy"
                className="size-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {lightbox !== null && (
        <Suspense fallback={null}>
          <Lightbox
            title={item.name}
            photos={photos}
            index={lightbox}
            onIndex={setLightbox}
            onClose={() => setLightbox(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------------

function Addons({ item }: { item: PublicItemDetail }) {
  const money = useMoney();
  if (!item.addons.length) return null;
  return (
    <section aria-labelledby="addons-title" className="space-y-3">
      <h2 id="addons-title" className="text-lg font-semibold">
        Complementos
      </h2>
      <p className="text-sm text-muted-foreground">Puedes añadirlos al reservar.</p>
      <ul className="divide-y rounded-xl border">
        {item.addons.map((a) => (
          <li key={a.id}>
            <Link
              to={itemPath(item.branch.slug, a)}
              className="flex items-center gap-3 p-3 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
            >
              <span className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                {a.cover ? (
                  <PublicImg
                    path={a.cover.path}
                    alt=""
                    width={56}
                    height={56}
                    sizes="56px"
                    className="size-full object-cover"
                  />
                ) : (
                  <PackageIcon aria-hidden className="m-auto mt-4 size-6 text-muted-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.name}</span>
                {a.short_description && (
                  <span className="block truncate text-sm text-muted-foreground">{a.short_description}</span>
                )}
              </span>
              <span className="text-right text-sm tabular-nums">
                <span className="block font-medium">{money(a.final_price)}</span>
                {a.discount && <s className="text-xs text-muted-foreground">{money(a.price)}</s>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItemSkeleton() {
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-2" aria-busy="true" aria-label="Cargando">
      <Skeleton className="aspect-[4/3] rounded-2xl" />
      <div className="space-y-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

/** Ficha de servicio o producto (fase 09 §3): galería, precio, detalles, descripción y complementos. */
export function Component({ kind }: { kind: 'service' | 'product' }) {
  const { branchSlug = '', id = '' } = useParams();
  const company = useCompany();
  const site = usePublicSite();
  const query = usePublicItem(branchSlug.toLowerCase(), id.toLowerCase());
  const item = query.data && query.data.kind === kind ? query.data : null;
  useDocumentTitle(item ? `${item.name} · ${company.name}` : null);

  if (query.isPending) return <ItemSkeleton />;
  if (query.isError && !isNotFound(query.error)) {
    return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (!item) {
    return (
      <PublicNotFound
        icon={PackageIcon}
        title={kind === 'service' ? 'Este servicio no está disponible' : 'Este producto no está disponible'}
        message="Puede que ya no se ofrezca en esta sede."
      />
    );
  }

  const isService = item.kind === 'service';
  const ask = whatsappUrl(
    site.data?.company.contact.whatsapp,
    `Hola, quiero información de ${item.name} (${item.branch.name})`,
  );

  return (
    <div className="pb-24 lg:pb-0">
      <nav aria-label="Ruta" className="mx-auto max-w-6xl px-4 pt-6 text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link to={branchPath(item.branch.slug)} className="hover:text-foreground hover:underline">
              {item.branch.name}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link
              to={`${branchPath(item.branch.slug)}#${isService ? 'servicios' : 'productos'}`}
              className="hover:text-foreground hover:underline"
            >
              {isService ? 'Servicios' : 'Productos'}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="truncate text-foreground">
            {item.name}
          </li>
        </ol>
      </nav>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 lg:grid-cols-2 lg:gap-12">
        <Gallery item={item} />

        <div className="space-y-6">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{item.name}</h1>
            {item.short_description && <p className="text-lg text-muted-foreground">{item.short_description}</p>}
            <Duration minutes={item.duration_minutes} />
            <ItemPrice item={item} size="lg" />
            {item.discount && (
              <p className="text-sm text-muted-foreground">
                {item.discount.label ? `${item.discount.label}. ` : ''}
                Promoción válida {discountDeadline(item.discount, company.timezone, company.locale).toLowerCase()}.
              </p>
            )}
          </div>

          <div className="hidden gap-3 lg:flex">
            {isService ? (
              <Button asChild size="lg">
                <Link to={bookingPath(item.branch.slug, item.id)}>Reservar</Link>
              </Button>
            ) : (
              ask && (
                <Button asChild size="lg" variant="outline">
                  <a href={ask} target="_blank" rel="noopener noreferrer">
                    <SocialIcon network="whatsapp" /> Preguntar por WhatsApp
                  </a>
                </Button>
              )
            )}
          </div>

          {item.details.length > 0 && (
            <dl className="divide-y rounded-xl border">
              {item.details.map((d) => (
                <div key={d.label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-4 py-3 text-sm">
                  <dt className="font-medium">{d.label}</dt>
                  <dd className="text-muted-foreground">{d.value || '—'}</dd>
                </div>
              ))}
            </dl>
          )}

          {item.description && (
            <Suspense fallback={<Skeleton className="h-24 w-full" />}>
              <Markdown className="text-base">{item.description}</Markdown>
            </Suspense>
          )}

          <Addons item={item} />
        </div>
      </div>

      {/* Botón fijo en móvil */}
      {(isService || ask) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 backdrop-blur lg:hidden">
          {isService ? (
            <Button asChild size="lg" className="w-full">
              <Link to={bookingPath(item.branch.slug, item.id)}>Reservar</Link>
            </Button>
          ) : (
            ask && (
              <Button asChild size="lg" variant="outline" className="w-full">
                <a href={ask} target="_blank" rel="noopener noreferrer">
                  <SocialIcon network="whatsapp" /> Preguntar por WhatsApp
                </a>
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export const ServicePage = () => <Component kind="service" />;
export const ProductPage = () => <Component kind="product" />;
