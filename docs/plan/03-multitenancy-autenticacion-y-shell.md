# Fase 03 — Multitenancy, autenticación y shell de la aplicación

## Objetivo

Que cada subdominio cargue *su* empresa con su marca, que `/admin` exija login de un miembro de esa empresa, que exista la consola superadmin para dar de alta empresas, y que las layouts pública y de administración estén listas para recibir las pantallas de las fases siguientes.

## Prerrequisitos

Fases 01 y 02. Tablas: `companies`, `company_members`, `company_invitations`, `platform_admins`, `branches`. RPC `get_company_by_slug`.

## Tareas

### 1. Resolución de tenant (Worker + cliente)
- [x] `src/shared/tenant.ts`: `resolveTenant(host, rootDomain, search)` → `{ type: 'platform' } | { type: 'company', slug } | { type: 'redirect', to }` (ver `00 §4`). `platform` = `servigo.roquintech.com` (o `localhost` en local); la consola superadmin es la ruta `/console` dentro de `platform`. `www` → `redirect` a `https://roquintech.com`. Un slug reservado que no es empresa → 404.
- [x] Middleware Hono `tenantMiddleware`: resuelve tenant, consulta `get_company_by_slug` (cache API, TTL 60 s, clave `tenant:{slug}`), adjunta `c.var.company`. Si no existe → página 404 de tenant ("Esta empresa no existe"); si `suspended` → página "Sitio temporalmente no disponible".
- [x] El Worker sirve `index.html` con **HTMLRewriter** inyectando: `<title>`, `meta description`, `og:*`, favicon, `<script>window.__TENANT__ = {...}</script>` (id, slug, nombre, colores, logo). Así la SPA arranca sin un fetch extra y el SEO/compartir en redes funciona.
- [x] Cliente: `TenantProvider` lee `window.__TENANT__` (fallback: fetch `/api/public/tenant`). Hook `useTenant()`.

### 2. Theming por empresa
- [x] `applyBrand(primary, secondary)`: convierte hex a OKLCH y escribe CSS variables de shadcn (`--primary`, `--primary-foreground`, `--ring`, `--accent`…) calculando el color de texto con contraste AA.
- [x] Modo claro/oscuro respetando `prefers-color-scheme` en admin; el sitio público usa claro por defecto.

### 3. Ruteo
```
Plataforma Servigo (servigo.roquintech.com)
  /                      Landing comercial de Servigo (estática)
  /console/login         Superadmin
  /console/companies     Lista/alta/suspensión de empresas
Empresa ({slug}.roquintech.com)
  /                      Inicio (selector de sede o sede única)          → fase 09
  /s/:branchSlug         Página de sede                                  → fase 09
  /s/:branchSlug/servicios/:itemId   Detalle de servicio                 → fase 09
  /s/:branchSlug/reservar/:serviceId Asistente de reserva                → fase 10
  /reserva/:code         Confirmación / detalle de reserva               → fase 10
  /mis-reservas          Búsqueda de reservas                            → fase 10
  /acerca                Acerca de                                       → fase 09
  /admin/login, /admin/recuperar, /admin/aceptar-invitacion
  /admin                 Dashboard                                       → fase 12
  /admin/reservas        → fase 11
  /admin/clientes        → fase 11
  /admin/calendario      → fase 08
  /admin/catalogo/servicios | productos  → fase 06
  /admin/formularios     → fase 07
  /admin/sedes           → fase 05
  /admin/contenido/acerca | patrocinadores | redes | footer → fase 05
  /admin/configuracion/empresa | reservas | miembros       → fases 05/03
```
- [x] Rutas *lazy* (`React.lazy`) por feature para que el bundle público no cargue código de admin (FullCalendar, Recharts).
- [x] `RequireMember` (guard): sin sesión → `/admin/login?next=`; con sesión pero no miembro de *esta* empresa → pantalla "No tienes acceso a esta empresa" + cerrar sesión.

### 4. Autenticación (Supabase Auth)
- [x] Login email + contraseña, "olvidé mi contraseña" (enlace con `redirectTo` al mismo subdominio), cambio de contraseña.
- [x] La sesión se guarda en `localStorage` por subdominio (aislamiento natural entre empresas).
- [x] Hook `useMembership()` → `{ role, branchIds }` desde `company_members`; helper `can(action)` para ocultar UI según rol (la seguridad real la da RLS).
- [x] Gestión de miembros (`/admin/configuracion/miembros`, owner/admin): listar, invitar por email con rol y sedes, cambiar rol, revocar. Invitación: fila en `company_invitations` + `supabase.auth.admin.inviteUserByEmail` desde endpoint del Worker `/api/admin/invite` (requiere secret key; el Worker valida el JWT del invitador y su rol). RPC `accept_invitation(token)` crea la membresía.

### 5. Consola superadmin
- [x] `/console/companies`: tabla con nombre, slug, estado, nº sedes, nº reservas del mes, creada.
- [x] Alta: nombre, slug (validación en vivo de formato, reservados y disponibilidad), email del owner, zona horaria, moneda. Endpoint Worker `/api/superadmin/companies` → crea empresa + sede principal por defecto + invitación al owner.
- [x] Suspender / reactivar empresa.
- [x] Primer superadmin: insertado por SQL manual (documentar en README).

### 6. Layouts
- [x] **Admin**: sidebar colapsable (logo empresa, navegación por secciones, selector de sede global persistido en `localStorage` que filtra calendario/reservas/dashboard), header con usuario y "Ver sitio público" (nueva pestaña). Responsive: sidebar → `Sheet` en móvil.
- [x] **Público**: header (logo/nombre, enlaces Acerca de y Mis reservas, selector de sede si hay varias), `<main>`, footer configurable (contenido real en fase 09).
- [x] Componentes comunes: `PageHeader`, `EmptyState`, `ConfirmDialog`, `DataTable` (TanStack Table), `ImageUploader` (fase 05 lo completa), `Money`, `DateTimeInSede`.
- [x] Manejo de errores: `ErrorBoundary` por ruta, toasts (sonner) para errores de Supabase con mensajes en español.

## Criterios de aceptación

- [x] `demo.localhost:5273` y `spa.localhost:5273` muestran nombre y color de su empresa; `noexiste.localhost:5273` muestra 404 de tenant.
- [x] `demo.localhost:5273/admin` redirige a login; un owner de `spa` que inicia sesión en `demo` ve "No tienes acceso".
- [x] Superadmin crea la empresa `prueba`, el owner recibe invitación (Mailpit local), la acepta y entra a `prueba.localhost:5273/admin`.
- [x] El bundle inicial de la ruta pública no incluye FullCalendar ni Recharts (verificar con `rollup-plugin-visualizer`).
- [x] Ver código fuente de `demo.localhost:5273` muestra `<title>` y `og:title` de la empresa.

## Notas de ejecución

- **Migración** `20261123120221_auth_invitations_console.sql`:
  - RPC `create_company` (empresa + "Sede principal" + invitación al owner, atómica, solo superadmin), `check_slug`, `console_companies`, `list_company_members`, `get_invitation` (anon, por token) y `accept_invitation`.
  - Trigger `company_members_keep_owner` (no se puede degradar ni quitar al último owner).
  - `company_invitations.invited_by` toma `auth.uid()` por defecto.
  - pgTAP: `fase03_invitations_console.test.sql` (30 aserciones; total 180).
- **Worker** (`src/worker/`):
  - `tenantMiddleware` con Cache API (60 s; 10 s para "no existe") y páginas propias para 404 de tenant, empresa suspendida (503) y BD caída (503).
  - `buildHead` inyecta `<title>`, descripción, Open Graph, favicon, `theme-color`, `noindex` en `/admin` y `/console`, y `window.__TENANT__` con los datos públicos de la empresa.
  - API: `/api/public/tenant`, `/api/health?db=1`, `/api/admin/invite`, `/api/admin/invitations/:id/resend`, `/api/superadmin/companies` (alta, `PATCH …/status` que purga la caché, `POST …/resend-owner-invite`).
- **Flujo de invitación** (D18): usuario nuevo → correo "Te invitaron" → `/admin/aceptar-invitacion?token=` con sesión → crea contraseña (se marca `password_set` en sus metadatos) → acepta. Usuario existente → enlace mágico o login con su contraseña.
- **Rutas**: todas *lazy* (`createBrowserRouter` + `lazy`). `supabase-js` solo lo importan los chunks de admin, consola y auth. Verificado con `pnpm analyze`: el entry público no lo incluye. FullCalendar y Recharts aún no están instalados.
- **Superadmin dentro de una empresa**: `has_company_role` ya lo admitía (fase 02), así que el panel lo trata como rol `platform_admin` con permisos de owner.
- **Selector de sede**: se guarda en `localStorage` con la clave `servigo:branch:{companyId}`. Staff solo ve sus sedes y, con una sola, queda fija.
- **Pendiente para otras fases**:
  - `ImageUploader` solo valida tipo y tamaño (la compresión a WebP y la subida llegan en la fase 05).
  - El header público aún no tiene selector de sede ni footer configurable (fase 09).
- **E2E** (`e2e/fase03.spec.ts`, 6 pruebas) cubre todos los criterios de aceptación, incluida la invitación leída desde Mailpit.
  - En local: `PW_CHANNEL=msedge pnpm e2e` (o `pnpm exec playwright install chromium`).
  - En CI entran con la fase 04.
- **Dev**: `optimizeDeps.include` en `vite.config.ts` evita que Vite recargue la página al descubrir dependencias de los chunks lazy.
