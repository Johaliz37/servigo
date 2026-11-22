# Fase 03 — Multitenancy, autenticación y shell de la aplicación

## Objetivo

Que cada subdominio cargue *su* empresa con su marca, que `/admin` exija login de un miembro de esa empresa, que exista la consola superadmin para dar de alta empresas, y que las layouts pública y de administración estén listas para recibir las pantallas de las fases siguientes.

## Prerrequisitos

Fases 01 y 02. Tablas: `companies`, `company_members`, `company_invitations`, `platform_admins`, `branches`. RPC `get_company_by_slug`.

## Tareas

### 1. Resolución de tenant (Worker + cliente)
- [ ] `src/shared/tenant.ts`: `resolveTenant(host, rootDomain, search)` → `{ type: 'platform' } | { type: 'company', slug } | { type: 'redirect', to }` (ver `00 §4`). `platform` = `servigo.roquintech.com` (o `localhost` en local); la consola superadmin es la ruta `/console` dentro de `platform`. `www` → `redirect` a `https://roquintech.com`. Un slug reservado que no es empresa → 404.
- [ ] Middleware Hono `tenantMiddleware`: resuelve tenant, consulta `get_company_by_slug` (cache API, TTL 60 s, clave `tenant:{slug}`), adjunta `c.var.company`. Si no existe → página 404 de tenant ("Esta empresa no existe"); si `suspended` → página "Sitio temporalmente no disponible".
- [ ] El Worker sirve `index.html` con **HTMLRewriter** inyectando: `<title>`, `meta description`, `og:*`, favicon, `<script>window.__TENANT__ = {...}</script>` (id, slug, nombre, colores, logo). Así la SPA arranca sin un fetch extra y el SEO/compartir en redes funciona.
- [ ] Cliente: `TenantProvider` lee `window.__TENANT__` (fallback: fetch `/api/public/tenant`). Hook `useTenant()`.

### 2. Theming por empresa
- [ ] `applyBrand(primary, secondary)`: convierte hex a OKLCH y escribe CSS variables de shadcn (`--primary`, `--primary-foreground`, `--ring`, `--accent`…) calculando el color de texto con contraste AA.
- [ ] Modo claro/oscuro respetando `prefers-color-scheme` en admin; el sitio público usa claro por defecto.

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
- [ ] Rutas *lazy* (`React.lazy`) por feature para que el bundle público no cargue código de admin (FullCalendar, Recharts).
- [ ] `RequireMember` (guard): sin sesión → `/admin/login?next=`; con sesión pero no miembro de *esta* empresa → pantalla "No tienes acceso a esta empresa" + cerrar sesión.

### 4. Autenticación (Supabase Auth)
- [ ] Login email + contraseña, "olvidé mi contraseña" (enlace con `redirectTo` al mismo subdominio), cambio de contraseña.
- [ ] La sesión se guarda en `localStorage` por subdominio (aislamiento natural entre empresas).
- [ ] Hook `useMembership()` → `{ role, branchIds }` desde `company_members`; helper `can(action)` para ocultar UI según rol (la seguridad real la da RLS).
- [ ] Gestión de miembros (`/admin/configuracion/miembros`, owner/admin): listar, invitar por email con rol y sedes, cambiar rol, revocar. Invitación: fila en `company_invitations` + `supabase.auth.admin.inviteUserByEmail` desde endpoint del Worker `/api/admin/invite` (requiere secret key; el Worker valida el JWT del invitador y su rol). RPC `accept_invitation(token)` crea la membresía.

### 5. Consola superadmin
- [ ] `/console/companies`: tabla con nombre, slug, estado, nº sedes, nº reservas del mes, creada.
- [ ] Alta: nombre, slug (validación en vivo de formato, reservados y disponibilidad), email del owner, zona horaria, moneda. Endpoint Worker `/api/superadmin/companies` → crea empresa + sede principal por defecto + invitación al owner.
- [ ] Suspender / reactivar empresa.
- [ ] Primer superadmin: insertado por SQL manual (documentar en README).

### 6. Layouts
- [ ] **Admin**: sidebar colapsable (logo empresa, navegación por secciones, selector de sede global persistido en `localStorage` que filtra calendario/reservas/dashboard), header con usuario y "Ver sitio público" (nueva pestaña). Responsive: sidebar → `Sheet` en móvil.
- [ ] **Público**: header (logo/nombre, enlaces Acerca de y Mis reservas, selector de sede si hay varias), `<main>`, footer configurable (contenido real en fase 09).
- [ ] Componentes comunes: `PageHeader`, `EmptyState`, `ConfirmDialog`, `DataTable` (TanStack Table), `ImageUploader` (fase 05 lo completa), `Money`, `DateTimeInSede`.
- [ ] Manejo de errores: `ErrorBoundary` por ruta, toasts (sonner) para errores de Supabase con mensajes en español.

## Criterios de aceptación

- [ ] `demo.localhost:5273` y `spa.localhost:5273` muestran nombre y color de su empresa; `noexiste.localhost:5273` muestra 404 de tenant.
- [ ] `demo.localhost:5273/admin` redirige a login; un owner de `spa` que inicia sesión en `demo` ve "No tienes acceso".
- [ ] Superadmin crea la empresa `prueba`, el owner recibe invitación (Mailpit local), la acepta y entra a `prueba.localhost:5273/admin`.
- [ ] El bundle inicial de la ruta pública no incluye FullCalendar ni Recharts (verificar con `rollup-plugin-visualizer`).
- [ ] Ver código fuente de `demo.localhost:5273` muestra `<title>` y `og:title` de la empresa.
