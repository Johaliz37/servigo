/**
 * Piezas del sitio público (fase 09): imágenes con `srcset`, precio con descuento, tarjetas de
 * ítem, redes y estados (carga, vacío, error, 404). Sin supabase-js ni zod.
 */
import type { ReactNode } from 'react';
import { ClockIcon, RefreshCwIcon, SearchXIcon, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import {
  bookingPath,
  discountDeadline,
  discountOff,
  formatDuration,
  itemPath,
  type PublicItem,
  type PublicSocial,
} from '@shared/public-site';
import { SocialIcon } from '@client/components/common/SocialIcon';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { Skeleton } from '@client/components/ui/skeleton';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/messages';
import { mediaUrl } from '@client/lib/media-url';
import { cn } from '@client/lib/utils';
import { socialLabel, useMoney } from './hooks';

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

/**
 * Imagen del bucket con miniatura (400 px) y versión grande (1600 px) en `srcset`. `priority`
 * para la primera imagen visible (encabezado): carga inmediata y `fetchpriority="high"`.
 */
export function PublicImg({
  path,
  alt,
  width,
  height,
  sizes,
  priority = false,
  className,
}: {
  path: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const main = mediaUrl(path)!;
  const thumb = path.endsWith('.webp') ? mediaUrl(path, 'thumb') : null;
  return (
    <img
      src={main}
      srcSet={thumb ? `${thumb} 400w, ${main} 1600w` : undefined}
      sizes={thumb ? sizes : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : 'auto'}
      className={className}
    />
  );
}

/** Fondo de marca cuando no hay foto (degradado del color primario). */
export function BrandPlaceholder({ label, className }: { label: string; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex items-center justify-center bg-gradient-to-br from-primary/85 to-primary/50 text-4xl font-semibold text-primary-foreground/90',
        className,
      )}
    >
      {label.charAt(0).toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Precio
// ---------------------------------------------------------------------------

/** Precio final, el base tachado si hay descuento y el badge con la fecha límite. */
export function ItemPrice({
  item,
  size = 'sm',
  className,
}: {
  item: Pick<PublicItem, 'price' | 'final_price' | 'discount'>;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const company = useCompany();
  const money = useMoney();
  const d = item.discount;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <span className={cn('font-semibold tabular-nums', size === 'lg' ? 'text-2xl' : 'text-base')}>
        {money(item.final_price)}
      </span>
      {d && (
        <>
          <s className={cn('text-muted-foreground tabular-nums', size === 'lg' ? 'text-base' : 'text-sm')}>
            <span className="sr-only">Antes: </span>
            {money(item.price)}
          </s>
          <Badge className="bg-primary/10 text-primary hover:bg-primary/10" title={d.label ?? undefined}>
            {discountOff(d, money, company.locale)} · {discountDeadline(d, company.timezone, company.locale)}
          </Badge>
        </>
      )}
    </div>
  );
}

export function Duration({ minutes, className }: { minutes: number | null; className?: string }) {
  const text = formatDuration(minutes);
  if (!text) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm text-muted-foreground', className)}>
      <ClockIcon aria-hidden className="size-3.5" />
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de ítem
// ---------------------------------------------------------------------------

/** Tarjeta de servicio o producto: toda la parte superior lleva al detalle. */
export function ItemCard({
  item,
  branchSlug,
  className,
}: {
  item: PublicItem;
  branchSlug: string;
  className?: string;
}) {
  const href = itemPath(branchSlug, item);
  return (
    <article
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs',
        className,
      )}
    >
      <Link to={href} className="flex flex-1 flex-col focus-visible:outline-none">
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          {item.cover ? (
            <PublicImg
              path={item.cover.path}
              alt={item.cover.alt ?? ''}
              width={400}
              height={300}
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 85vw"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <BrandPlaceholder label={item.name} className="size-full" />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <h3 className="leading-snug font-semibold group-hover:underline group-focus-visible:underline">
            {item.name}
          </h3>
          {item.short_description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{item.short_description}</p>
          )}
          <Duration minutes={item.duration_minutes} />
          <ItemPrice item={item} className="mt-auto pt-2" />
        </div>
      </Link>
      {item.kind === 'service' && (
        <div className="px-4 pb-4">
          <Button asChild className="w-full">
            <Link to={bookingPath(branchSlug, item.id)} aria-label={`Reservar ${item.name}`}>
              Reservar
            </Link>
          </Button>
        </div>
      )}
    </article>
  );
}

export function ItemCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-5 w-1/3" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Redes
// ---------------------------------------------------------------------------

const externalProps = (url: string) =>
  /^https?:\/\//.test(url) ? { target: '_blank', rel: 'noopener noreferrer' } : {};

/** Iconos con etiqueta (`large`) o solo iconos (footer). */
export function SocialLinks({ links, large = false }: { links: PublicSocial[]; large?: boolean }) {
  if (!links.length) return null;
  return (
    <ul className={cn('flex flex-wrap', large ? 'justify-center gap-3 sm:gap-4' : 'gap-1')}>
      {links.map((s) => (
        <li key={s.url}>
          {large ? (
            <a
              href={s.url}
              {...externalProps(s.url)}
              className="flex min-w-28 flex-col items-center gap-2 rounded-xl border bg-card px-4 py-4 text-sm font-medium transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <SocialIcon network={s.network} className="size-7" />
              {socialLabel(s)}
            </a>
          ) : (
            <a
              href={s.url}
              {...externalProps(s.url)}
              aria-label={socialLabel(s)}
              title={socialLabel(s)}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <SocialIcon network={s.network} className="size-4" />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Secciones y estados
// ---------------------------------------------------------------------------

export function Section({
  id,
  title,
  description,
  children,
  className,
  section,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Marca para las pruebas E2E (orden 3.1–3.5). */
  section?: string;
}) {
  return (
    <section aria-labelledby={`${id}-title`} id={id} data-section={section} className={cn('py-10 sm:py-14', className)}>
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-6 space-y-1">
          <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {title}
          </h2>
          {description && <p className="text-muted-foreground">{description}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
      <h1 className="text-2xl font-semibold">No pudimos cargar esta página</h1>
      <p className="text-muted-foreground">{messageOf(error)}</p>
      <Button onClick={onRetry}>
        <RefreshCwIcon aria-hidden /> Reintentar
      </Button>
    </div>
  );
}

export function PublicNotFound({
  title,
  message,
  icon: Icon = SearchXIcon,
}: {
  title: string;
  message: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
      <Icon aria-hidden className="size-12 text-muted-foreground" />
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{message}</p>
      <Button asChild variant="outline">
        <Link to="/">Ir al inicio</Link>
      </Button>
    </div>
  );
}
