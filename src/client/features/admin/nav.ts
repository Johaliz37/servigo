import {
  BuildingIcon,
  CalendarDaysIcon,
  CalendarCheckIcon,
  ClipboardListIcon,
  CogIcon,
  ContactIcon,
  HandshakeIcon,
  InfoIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  PackageIcon,
  PanelBottomIcon,
  ScissorsIcon,
  Share2Icon,
  SlidersHorizontalIcon,
  UsersIcon,
} from 'lucide-react';
import type { Action } from '@shared/permissions';

export interface NavItem {
  /** Ruta relativa a `/admin` ('' = dashboard). */
  path: string;
  label: string;
  icon: LucideIcon;
  action: Action;
  /** Fase del plan que implementa la pantalla (las que faltan muestran un aviso). */
  phase: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const ADMIN_NAV: NavGroup[] = [
  {
    label: 'Operación',
    items: [
      { path: '', label: 'Inicio', icon: LayoutDashboardIcon, action: 'dashboard.view', phase: 12 },
      { path: 'reservas', label: 'Reservas', icon: CalendarCheckIcon, action: 'bookings.manage', phase: 11 },
      { path: 'clientes', label: 'Clientes', icon: ContactIcon, action: 'bookings.manage', phase: 11 },
      { path: 'calendario', label: 'Calendario', icon: CalendarDaysIcon, action: 'availability.edit_branch', phase: 8 },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { path: 'catalogo/servicios', label: 'Servicios', icon: ScissorsIcon, action: 'catalog.edit', phase: 6 },
      { path: 'catalogo/productos', label: 'Productos', icon: PackageIcon, action: 'catalog.edit', phase: 6 },
      { path: 'formularios', label: 'Información adicional', icon: ClipboardListIcon, action: 'forms.edit', phase: 7 },
    ],
  },
  {
    label: 'Sitio público',
    items: [
      { path: 'sedes', label: 'Sedes', icon: BuildingIcon, action: 'company.edit', phase: 5 },
      { path: 'contenido/acerca', label: 'Acerca de', icon: InfoIcon, action: 'company.edit', phase: 5 },
      {
        path: 'contenido/patrocinadores',
        label: 'Patrocinadores',
        icon: HandshakeIcon,
        action: 'company.edit',
        phase: 5,
      },
      { path: 'contenido/redes', label: 'Redes sociales', icon: Share2Icon, action: 'company.edit', phase: 5 },
      { path: 'contenido/footer', label: 'Pie de página', icon: PanelBottomIcon, action: 'company.edit', phase: 5 },
    ],
  },
  {
    label: 'Configuración',
    items: [
      { path: 'configuracion/empresa', label: 'Empresa', icon: CogIcon, action: 'company.edit', phase: 5 },
      {
        path: 'configuracion/reservas',
        label: 'Reservas',
        icon: SlidersHorizontalIcon,
        action: 'company.edit',
        phase: 5,
      },
      { path: 'configuracion/miembros', label: 'Miembros', icon: UsersIcon, action: 'members.view', phase: 3 },
    ],
  },
];

export const ADMIN_NAV_ITEMS = ADMIN_NAV.flatMap((g) => g.items);
