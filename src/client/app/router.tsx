import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import type { ClientTenant } from '@shared/tenant';
import { NotFoundPage, RouteError } from '@client/components/common/RouteError';
import { FullPageSpinner } from '@client/components/common/Spinner';

const HydrateFallback = () => <FullPageSpinner />;

/**
 * Rutas por tenant (fase 03 §3). Todo es *lazy*: el bundle público no carga el código
 * de administración ni supabase-js (que solo importan admin/consola/auth).
 */

const authRoutes = (base: 'admin' | 'console'): RouteObject => ({
  path: base,
  lazy: () => import('@client/features/auth/AuthLayout'),
  ErrorBoundary: RouteError,
  HydrateFallback,
  children: [
    { path: 'login', lazy: () => import('@client/features/auth/LoginPage') },
    { path: 'recuperar', lazy: () => import('@client/features/auth/ForgotPasswordPage') },
    { path: 'nueva-contrasena', lazy: () => import('@client/features/auth/NewPasswordPage') },
    ...(base === 'admin'
      ? [{ path: 'aceptar-invitacion', lazy: () => import('@client/features/auth/AcceptInvitationPage') }]
      : []),
  ],
});

const adminPages = () => import('@client/features/admin/pages');

// Secciones de las fases 05–12: muestran "En construcción" hasta que se implementen.
const PLACEHOLDER_PATHS = [
  'reservas',
  'clientes',
  'calendario',
  'catalogo/servicios',
  'catalogo/productos',
  'formularios',
  'sedes',
  'contenido/acerca',
  'contenido/patrocinadores',
  'contenido/redes',
  'contenido/footer',
  'configuracion/empresa',
  'configuracion/reservas',
];

const companyRoutes: RouteObject[] = [
  {
    path: '/',
    lazy: () => import('@client/features/public/PublicLayout'),
    ErrorBoundary: RouteError,
    HydrateFallback,
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('@client/features/public/PublicLayout')).HomePage }),
      },
      ...['acerca', 'mis-reservas', 's/:branchSlug/*', 'reserva/:code'].map((path) => ({
        path,
        lazy: async () => ({ Component: (await import('@client/features/public/PublicLayout')).ComingSoonPage }),
      })),
      { path: '*', Component: NotFoundPage },
    ],
  },
  authRoutes('admin'),
  {
    path: 'admin',
    lazy: () => import('@client/features/admin/AdminLayout'),
    ErrorBoundary: RouteError,
    HydrateFallback,
    children: [
      { index: true, lazy: async () => ({ Component: (await adminPages()).DashboardPage }) },
      ...PLACEHOLDER_PATHS.map((path) => ({
        path,
        lazy: async () => ({ Component: (await adminPages()).SectionPlaceholder }),
        ErrorBoundary: RouteError,
      })),
      {
        path: 'configuracion/miembros',
        lazy: () => import('@client/features/members/MembersPage'),
        ErrorBoundary: RouteError,
      },
      { path: 'cuenta', lazy: async () => ({ Component: (await adminPages()).AccountPage }) },
      { path: '*', Component: NotFoundPage },
    ],
  },
];

const platformRoutes: RouteObject[] = [
  {
    path: '/',
    lazy: () => import('@client/features/platform/LandingPage'),
    ErrorBoundary: RouteError,
    HydrateFallback,
  },
  authRoutes('console'),
  {
    path: 'console',
    lazy: () => import('@client/features/console/ConsoleLayout'),
    ErrorBoundary: RouteError,
    HydrateFallback,
    children: [
      { index: true, element: <Navigate to="companies" replace /> },
      { path: 'companies', lazy: () => import('@client/features/console/CompaniesPage'), ErrorBoundary: RouteError },
      { path: '*', Component: NotFoundPage },
    ],
  },
  { path: '*', Component: NotFoundPage },
];

export function createRouter(tenant: ClientTenant) {
  return createBrowserRouter(tenant.type === 'company' ? companyRoutes : platformRoutes);
}
