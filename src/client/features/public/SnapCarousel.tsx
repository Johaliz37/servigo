import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { Button } from '@client/components/ui/button';
import { cn } from '@client/lib/utils';

/**
 * Carrusel con `scroll-snap` nativo (00 D27): el navegador hace el *swipe* y la inercia, y el
 * JS solo mueve por páginas y pinta los puntos. Accesible: región `carousel`, diapositivas
 * con etiqueta y botones con nombre (con Tab, el navegador desplaza hasta la tarjeta enfocada); respeta `prefers-reduced-motion`.
 */
export function SnapCarousel<T>({
  items,
  label,
  itemKey,
  itemLabel,
  renderItem,
  itemClassName = 'basis-[85%] sm:basis-[calc((100%-1rem)/2)] lg:basis-[calc((100%-2rem)/3)]',
}: {
  items: T[];
  label: string;
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  itemClassName?: string;
}) {
  const track = useRef<HTMLUListElement>(null);
  const [state, setState] = useState({ pages: 1, page: 0, canPrev: false, canNext: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const width = el.clientWidth || 1;
    const max = el.scrollWidth - width;
    const pages = Math.max(1, Math.ceil(el.scrollWidth / width - 0.05));
    const atEnd = el.scrollLeft >= max - 2;
    setState({
      pages,
      page: atEnd ? pages - 1 : Math.round(el.scrollLeft / width),
      canPrev: el.scrollLeft > 2,
      canNext: !atEnd,
    });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    queueMicrotask(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure, items.length]);

  const go = (page: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: page * el.clientWidth });
  };
  const step = (delta: number) => {
    const el = track.current;
    if (el) el.scrollBy({ left: delta * el.clientWidth });
  };

  return (
    <div role="region" aria-roledescription="carrusel" aria-label={label}>
      <ul
        ref={track}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] gap-4 overflow-x-auto px-4 pb-2 motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <li
            key={itemKey(item)}
            role="group"
            aria-roledescription="diapositiva"
            aria-label={`${i + 1} de ${items.length}: ${itemLabel(item)}`}
            className={cn('shrink-0 snap-start', itemClassName)}
          >
            {renderItem(item)}
          </li>
        ))}
      </ul>
      {state.pages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Páginas del carrusel">
            {Array.from({ length: state.pages }, (_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Ir a la página ${i + 1}`}
                aria-current={i === state.page ? 'true' : undefined}
                onClick={() => go(i)}
                className="flex size-6 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span
                  className={cn(
                    'block h-2 rounded-full transition-all',
                    i === state.page ? 'w-5 bg-primary' : 'w-2 bg-muted-foreground/35',
                  )}
                />
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-10 rounded-full"
              onClick={() => step(-1)}
              disabled={!state.canPrev}
              aria-label="Anteriores"
            >
              <ArrowLeftIcon aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-10 rounded-full"
              onClick={() => step(1)}
              disabled={!state.canNext}
              aria-label="Siguientes"
            >
              <ArrowRightIcon aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
