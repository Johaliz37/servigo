import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import type { ClientTenant } from '@shared/tenant';
import { NotFoundPage, RouteError } from '@client/components/common/RouteError';
import { FullPageSpinner } from '@client/components/common/Spinner';
// Sitio público: carga directa, sin chunk aparte. Así la primera página no espera dos saltos
// de red más (HTML → JS → chunk de la ruta) antes de pintar (fase 09 §4, Lighthouse).
import { Component as BranchPage } from '@client/features/public/BranchPage';
import { HomePage } from '@client/features/public/HomePage';
import { ProductPage, ServicePage } from '@client/features/public/ItemPage';
import { Component as PublicLayout } from '@client/features/public/PublicLayout';

const HydrateFallback = () => <FullPageSpinner />;

/**
 * Rutas por tenant (fase 03 §3). Todo es *lazy* salvo el sitio público (fase 09 §4): el
 * bundle inicial no carga el código de administración ni supabase-js (que solo importan
 * admin/consola/auth).
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

// Fase 11: gestión de reservas y clientes.
const BOOKING_ROUTES: RouteObject[] = [
  { path: 'reservas', lazy: () => import('@client/features/bookings/BookingsPage') },
  { path: 'reservas/nueva', lazy: () => import('@client/features/bookings/NewBookingPage') },
  { path: 'reservas/agenda', lazy: () => import('@client/features/bookings/AgendaPage') },
  { path: 'reservas/:id', lazy: () => import('@client/features/bookings/BookingDetailPage') },
  { path: 'clientes', lazy: () => import('@client/features/bookings/CustomersPage') },
].map((route) => ({ ...route, ErrorBoundary: RouteError }));

// Fase 06: catálogo (listados, ficha con pestañas y catálogo por sede).
const catalogList = () => import('@client/features/catalog/CatalogListPage');
const catalogEditor = () => import('@client/features/catalog/ItemEditorPage');
const CATALOG_ROUTES: RouteObject[] = [
  { path: 'catalogo/servicios', lazy: async () => ({ Component: (await catalogList()).ServicesPage }) },
  { path: 'catalogo/servicios/:id', lazy: async () => ({ Component: (await catalogEditor()).ServiceEditorPage }) },
  { path: 'catalogo/productos', lazy: async () => ({ Component: (await catalogList()).ProductsPage }) },
  { path: 'catalogo/productos/:id', lazy: async () => ({ Component: (await catalogEditor()).ProductEditorPage }) },
  { path: 'sedes/:id/catalogo', lazy: () => import('@client/features/branches/BranchCatalogPage') },
  // Fase 07: información adicional (constructor de formularios).
  { path: 'formularios', lazy: () => import('@client/features/forms/FormsPage') },
  // Fase 08: calendario de disponibilidad (FullCalendar solo se descarga en esta ruta).
  { path: 'calendario', lazy: () => import('@client/features/calendar/CalendarPage') },
].map((route) => ({ ...route, ErrorBoundary: RouteError }));

// Fase 05: empresa, sedes y contenido del sitio.
const CONTENT_ROUTES: RouteObject[] = [
  { path: 'sedes', lazy: () => import('@client/features/branches/BranchesPage') },
  { path: 'contenido/acerca', lazy: () => import('@client/features/content/AboutPage') },
  { path: 'contenido/patrocinadores', lazy: () => import('@client/features/content/SponsorsPage') },
  { path: 'contenido/redes', lazy: () => import('@client/features/content/SocialLinksPage') },
  { path: 'contenido/footer', lazy: () => import('@client/features/content/FooterPage') },
  { path: 'configuracion/empresa', lazy: () => import('@client/features/settings/CompanyProfilePage') },
  { path: 'configuracion/reservas', lazy: () => import('@client/features/settings/BookingSettingsPage') },
].map((route) => ({ ...route, ErrorBoundary: RouteError }));

const companyRoutes: RouteObject[] = [
  {
    path: '/',
    Component: PublicLayout,
    ErrorBoundary: RouteError,
    HydrateFallback,
    children: [
      {
        index: true,
        Component: HomePage,
      },
      // Fase 09: sede, fichas y «Acerca de».
      { path: 's/:branchSlug', Component: BranchPage },
      {
        path: 's/:branchSlug/servicios/:id',
        Component: ServicePage,
      },
      {
        path: 's/:branchSlug/productos/:id',
        Component: ProductPage,
      },
      { path: 'acerca', lazy: () => import('@client/features/public/AboutPage') },
      // Fase 10: reserva y consulta (chunks propios: teléfono, calendario y Turnstile).
      { path: 's/:branchSlug/reservar/:serviceId?', lazy: () => import('@client/features/booking/BookingWizard') },
      { path: 'reserva/:code', lazy: () => import('@client/features/booking/BookingPage') },
      { path: 'mis-reservas', lazy: () => import('@client/features/booking/MyBookingsPage') },
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
      ...BOOKING_ROUTES,
      ...CONTENT_ROUTES,
      ...CATALOG_ROUTES,
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
