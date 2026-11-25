import { discountBadge, type EffectivePrice } from '@shared/pricing';
import { formatMoney } from '@shared/format';
import { Badge } from '@client/components/ui/badge';
import { useCompany } from '@client/app/tenant-context';
import { cn } from '@client/lib/utils';

/** Precio final; si hay descuento, el base tachado y el badge "−20 % hasta 30/11". */
export function PriceDisplay({ price, className }: { price: EffectivePrice; className?: string }) {
  const company = useCompany();
  const opts = { currency: company.currency, locale: company.locale, timeZone: company.timezone };
  const badge = discountBadge(price, opts);
  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <span className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
        <span className="font-medium">{formatMoney(price.final, opts.currency, opts.locale)}</span>
        {badge && (
          <s className="text-xs text-muted-foreground">
            <span className="sr-only">Antes: </span>
            {formatMoney(price.base, opts.currency, opts.locale)}
          </s>
        )}
      </span>
      {badge && (
        <Badge variant="secondary" className="bg-primary/10 text-primary" title={price.discountLabel ?? undefined}>
          {badge}
        </Badge>
      )}
    </div>
  );
}
