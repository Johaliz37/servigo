import { BriefcaseBusinessIcon, GlobeIcon, LinkIcon, MailIcon, PhoneIcon, type LucideIcon } from 'lucide-react';
import { siFacebook, siInstagram, siTiktok, siWhatsapp, siX, siYoutube, type SimpleIcon } from 'simple-icons';
import type { SocialNetwork } from '@shared/content';
import { cn } from '@client/lib/utils';

const BRANDS: Partial<Record<SocialNetwork, SimpleIcon>> = {
  instagram: siInstagram,
  facebook: siFacebook,
  tiktok: siTiktok,
  x: siX,
  youtube: siYoutube,
  whatsapp: siWhatsapp,
};

const GENERIC: Record<SocialNetwork, LucideIcon> = {
  instagram: LinkIcon,
  facebook: LinkIcon,
  tiktok: LinkIcon,
  x: LinkIcon,
  youtube: LinkIcon,
  whatsapp: PhoneIcon,
  // simple-icons ya no incluye LinkedIn (retirado a pedido de la marca).
  linkedin: BriefcaseBusinessIcon,
  website: GlobeIcon,
  email: MailIcon,
  phone: PhoneIcon,
  other: LinkIcon,
};

/** Ícono de una red (logos de simple-icons, CC0; genéricos de lucide para el resto). */
export function SocialIcon({ network, className }: { network: SocialNetwork; className?: string }) {
  const brand = BRANDS[network];
  if (brand) {
    return (
      <svg role="img" viewBox="0 0 24 24" aria-hidden className={cn('size-4 fill-current', className)}>
        <path d={brand.path} />
      </svg>
    );
  }
  const Icon = GENERIC[network];
  return <Icon aria-hidden className={cn('size-4', className)} />;
}
