# Fase 00 — Arquitectura y decisiones

> Documento de referencia. Toda fase lo asume leído. No contiene tareas de código, sí decisiones vinculantes.

## 1. Visión del producto

- **Plataforma multitenant**: una base de datos, un despliegue, N empresas aisladas por `company_id` + Row Level Security (RLS).
- **Dos vistas**:
  - **Administración** (`https://{slug}.roquintech.com/admin`): requiere login; gestiona todo lo de la empresa.
  - **Pública** (`https://{slug}.roquintech.com/`): sin login; catálogo, reserva, consulta de reservas.
- **Plataforma Servigo** (`https://servigo.roquintech.com`): landing comercial de Servigo en `/` y consola del superadmin en `/console` para dar de alta empresas.

**Contexto de marca**: *Servigo* es el producto; *Roquintech* es la empresa matriz, que tendrá varios productos bajo el mismo dominio `roquintech.com`. Por eso:
- `roquintech.com` y `www.roquintech.com` son la **web corporativa de Roquintech**, un proyecto aparte y fuera del alcance de este plan.
- Servigo **comparte** el espacio de subdominios de `roquintech.com` con los futuros productos: un subdominio puede ser una empresa cliente de Servigo **o** otro producto de Roquintech, nunca ambas cosas (ver slugs reservados en §4).

## 2. Stack (todo gratuito)

| Capa | Tecnología | Plan / costo | Por qué |
|------|-----------|--------------|---------|
| Frontend | React 19 + Vite + TypeScript (SPA) | OSS | Simple, rápido, cabe holgado en los límites del Worker. |
| UI | Tailwind CSS v4 + shadcn/ui (Radix) + lucide-react | OSS | Componentes accesibles, theming por CSS variables (marca por empresa). |
| Ruteo / datos cliente | React Router v8 (modo librería) + TanStack Query v5 | OSS | Caché, reintentos, invalidación. |
| Formularios | react-hook-form + Zod v4 | OSS | Mismos esquemas Zod en cliente y Worker. |
| Calendario | FullCalendar v6 *standard* (daygrid, timegrid, list, interaction, rrule) | MIT | Experiencia tipo Google Calendar. **No** usar plugins *premium* (resource/timeline). |
| Recurrencias | `rrule` | OSS | RRULE RFC 5545, igual que Google Calendar. |
| Fechas | `date-fns` + `@date-fns/tz` | OSS | Zonas horarias por sede. |
| Carrusel | `scroll-snap` nativo en el sitio público (D27); Embla (componente `carousel` de shadcn) disponible para el panel | OSS | Ligero, táctil. |
| Gráficas | Recharts (componente `chart` de shadcn) | OSS | Dashboard. |
| Edge / API | Cloudflare Workers + Static Assets + Hono v4 | Free: 100k req/día al Worker; assets estáticos ilimitados | Un único Worker sirve SPA, API y resuelve el tenant por `Host`. |
| Antibots | Cloudflare Turnstile | Gratis | Protege crear/consultar reservas. |
| Rate limiting | Binding Workers Rate Limiting (o contador en Cache API) | Gratis | Frenar enumeración de reservas. |
| Base de datos | Supabase Postgres | Free: 500 MB BD, 1 GB storage, 50k MAU, 5 GB egress | Auth, RLS, Storage y RPC incluidos. |
| Auth | Supabase Auth (email + contraseña, enlaces mágicos/invitaciones) | Free | Solo para miembros de empresas y superadmin. |
| Archivos | Supabase Storage (bucket público `media`) | Free | Imágenes comprimidas en el navegador (WebP). La transformación de imágenes de Supabase es de pago → **no usarla**. |
| Repo / CI | GitHub (repo **público**) + GitHub Actions | Free (minutos ilimitados en repos públicos) | Lint, test, migraciones, deploy, backups. |
| Local | Docker Desktop + Supabase CLI (`supabase start`) + Wrangler | Gratis | Paridad con producción. |
| DNS / TLS | Cloudflare DNS + Universal SSL | Free | Universal SSL cubre `roquintech.com` y `*.roquintech.com`. |

Supuesto: el dominio `roquintech.com` ya es propiedad del cliente (la renovación anual del dominio es el único costo fuera del alcance de "costo 0").

## 3. Arquitectura

```
Navegador ──HTTPS──> Cloudflare (DNS *.roquintech.com proxied)
                         │  Route: *.roquintech.com/*  (las rutas más específicas de otros productos Roquintech tienen prioridad)
                         ▼
                 Worker "servigo" (Hono)
                 ├─ /api/public/*   → RPC Supabase (secret key), cache 60 s
                 ├─ /api/bookings/* → Turnstile + rate limit + RPC create/find
                 ├─ /api/admin/*    → (opcional) operaciones que requieren secret key
                 └─ resto           → Static Assets (SPA) + HTMLRewriter (meta/SEO del tenant)
                         │
                         ▼
                 Supabase (Postgres + Auth + Storage)
                   ▲
                   └── El panel /admin habla directo con Supabase usando el JWT del miembro (RLS)
```

Reglas:

1. **Lecturas públicas** (sitio de la empresa) → siempre por funciones RPC `security definer` que devuelven JSON (`get_public_site`, `get_public_branch`, …). El rol `anon` **no** tiene `select` directo sobre tablas.
2. **Escrituras públicas** (crear reserva, consultar reserva) → **solo** vía Worker, que valida Turnstile, aplica rate limit y llama RPC con la *secret key*. La *secret key* nunca llega al navegador.
3. **Administración** → el navegador usa `supabase-js` con la *publishable key* y el JWT del usuario; RLS garantiza el aislamiento por empresa.
4. **Cálculo de cupos** → en el Worker (TypeScript + `rrule`), reutilizando el mismo módulo que usa la UI de administración. La inserción de la reserva hace un *lock* y revalida capacidad en Postgres (atómico).

## 4. Resolución de tenant

| Host | Resultado |
|------|-----------|
| `roquintech.com` | Web corporativa de Roquintech (fuera de alcance; no la sirve el Worker de Servigo). Mientras no exista, una *Redirect Rule* de Cloudflare la envía a `https://servigo.roquintech.com` (D20) |
| `www.roquintech.com` | El Worker responde `301` → `https://roquintech.com` (hoy la misma *Redirect Rule* lo envía antes a `servigo.roquintech.com`, D20) |
| `servigo.roquintech.com` | Plataforma Servigo: landing en `/`, consola superadmin en `/console` |
| `{slug}.roquintech.com` | Sitio de la empresa `slug` (público en `/`, administración en `/admin`) |
| `{otro-producto}.roquintech.com` | Otro producto de Roquintech, con su propia route de Worker (más específica, gana sobre el comodín) |
| `localhost:5273` | Plataforma Servigo en local (`/console` para el superadmin) |
| `{slug}.localhost:5273` | Sitio de la empresa en local (Chrome/Edge/Firefox resuelven `*.localhost` a 127.0.0.1) |
| `localhost:5273/?tenant={slug}` | Alternativa local / preview |

Variables: `ROOT_DOMAIN` = `roquintech.com` (prod) | `localhost` (local); `PLATFORM_SUBDOMAIN` = `servigo` (en local la plataforma es el host raíz `localhost`).

**Slugs reservados** (no pueden ser empresa): `www, app, admin, api, console, mail, smtp, ftp, static, assets, cdn, media, status, docs, blog, help, soporte, dev, staging, test, auth, login, email, webmail, imap, pop, ns1, ns2, autodiscover, autoconfig, enterpriseenrollment, enterpriseregistration, lyncdiscover, sip, msoid, roquintech, servigo, monicarobles` **más el nombre de cada producto de Roquintech, actual o futuro**. La lista vive en la tabla `reserved_slugs` (semilla en una migración), no en el código, para que reservar el nombre de un producto nuevo sea un `insert` y no un despliegue. Antes de lanzar un producto nuevo de Roquintech hay que verificar que ninguna empresa de Servigo ya usa ese slug.

Validación de slug: `^(?!.*--)[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$` (3–32 caracteres, sin guion al inicio/fin y sin `--`, que evita etiquetas tipo punycode `xn--`). La misma expresión se usa en Zod y en el `check` de Postgres (ambos admiten *lookahead*).

## 5. Estructura del repositorio

```
/
├─ docs/plan/                  # este plan
├─ src/
│  ├─ client/                  # SPA React
│  │  ├─ app/                  # router, providers, layouts
│  │  ├─ features/<dominio>/   # pantallas, hooks y componentes por dominio
│  │  ├─ components/ui/        # shadcn/ui
│  │  └─ lib/                  # supabase client, tenant, utils
│  ├─ worker/                  # Hono: rutas /api, SSR de meta, cache
│  └─ shared/                  # Zod schemas, tipos, motor de disponibilidad, precios
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/              # SQL versionado (única fuente de verdad del esquema)
│  ├─ seed.sql
│  └─ tests/                   # pgTAP
├─ e2e/                        # Playwright
├─ .github/workflows/
├─ wrangler.jsonc
├─ vite.config.ts
└─ package.json                # pnpm
```

`src/shared` **no** puede importar nada de navegador ni de Workers: solo TS puro (se usa en ambos lados y en tests).

## 6. Convenciones

- **Idioma**: UI en español (preparada para i18n con un diccionario simple `es`). Código, tablas y columnas en inglés `snake_case` (SQL) / `camelCase` (TS).
- **Moneda**: `numeric(12,2)` en BD; cada empresa define `currency` (ISO 4217, por defecto `COP`) y `locale` (por defecto `es-CO`). Formato con `Intl.NumberFormat`.
- **Tiempo**: `timestamptz` siempre. Cada sede tiene `timezone` IANA (por defecto el de la empresa, p. ej. `America/Bogota`). La UI muestra la hora de la sede, no la del navegador.
- **IDs**: `uuid` (`gen_random_uuid()`). Códigos de reserva legibles: 8 caracteres Crockford Base32 sin `I L O U` (ej. `K7M2-9QXA` mostrado con guion).
- **Soft delete**: no. Se usa `is_active`/`is_visible`; borrar solo si no hay reservas asociadas.
- **Migraciones**: una por cambio, nombre `YYYYMMDDHHMMSS_descripcion.sql`, generadas con `supabase migration new`. Nunca editar una migración ya aplicada en producción.
- **Tipos**: `supabase gen types typescript --local > src/shared/database.types.ts` tras cada migración.
- **Git**: rama `main` protegida; ramas `feat/fase-XX-...`; Conventional Commits; PR con CI verde.
- **Calidad mínima por PR**: `pnpm lint && pnpm typecheck && pnpm test` y `supabase test db`.

## 7. Roles y permisos

| Rol | Alcance |
|-----|---------|
| `platform_admin` | Todo. Alta/baja de empresas, invitar owner. |
| `owner` | Todo dentro de su empresa, incluye miembros y eliminar datos. |
| `admin` | Todo dentro de su empresa salvo gestionar owners y otros admins: entre los miembros solo gestiona `staff` (fase 02 §4). |
| `staff` | Ver y gestionar reservas y calendario de las sedes asignadas (`branch_ids`); solo lectura de catálogo. |
| `anon` (cliente final) | Solo RPC públicas y endpoints del Worker. |

## 8. Límites gratuitos y mitigaciones

| Límite | Mitigación |
|--------|-----------|
| Supabase pausa proyectos inactivos 7 días | Workflow programado de GitHub que llama un RPC liviano (`ping`) 2 veces por semana. |
| Supabase Free sin backups descargables | Workflow semanal `supabase db dump` comprimido (`gzip`) y **cifrado** (`age` con la clave pública en la variable `BACKUP_AGE_RECIPIENT`; la privada solo fuera de GitHub) → artefacto de GitHub (retención 90 días). Cifrar es obligatorio: el repo es público (D17) y sus artefactos los puede descargar cualquiera. |
| 1 GB Storage | Compresión en cliente a WebP, máx. 1600 px (≈150–300 KB) + miniatura 400 px; límite 2 MB por archivo y cuota de imágenes por empresa. |
| 5 GB egress Supabase | Imágenes servidas **directo desde la URL pública** del bucket `media` (`{SUPABASE_URL}/storage/v1/object/public/media/{path}`), sin pasar por el Worker (ver D14). Nombres con hash de contenido (inmutables) y subida con `cacheControl: '31536000'` para que la CDN de Supabase y el navegador las cacheen; WebP comprimido para mantener bajo el egress. |
| Worker Free: 100k req/día, 10 ms CPU | Los assets estáticos con hash no cuentan contra el Worker (`run_worker_first: ["/*", "!/assets/*"]`: toda navegación HTML y `/api` pasa por el Worker; `/assets/*` se sirve directo). Cache de RPC públicas 60 s. |
| Email de Supabase Auth limitado | En producción es **obligatorio** un SMTP propio: el correo integrado de Supabase solo entrega a miembros del equipo del proyecto. Se usa Resend Free (3.000/mes, 100/día) con el dominio `mail.roquintech.com` (D21). Notificaciones al cliente final por WhatsApp `wa.me` (gratis, sin API). |
| 2 proyectos Supabase Free | `prod` + `staging` (opcional). Local siempre en Docker. |

## 9. Fuera de alcance (v1)

Pasarela de pagos, apps móviles nativas, envío de SMS, WhatsApp Business API, dominios personalizados por empresa (requiere Cloudflare for SaaS de pago por encima de cierto volumen), facturación del SaaS a las empresas, multi-idioma completo.

## 10. Registro de decisiones (ADR breve)

| # | Decisión | Motivo |
|---|----------|--------|
| D1 | Un solo Worker (SPA + API) con route `*.roquintech.com/*` | Pages no admite dominios comodín; Workers Routes sí en plan Free. |
| D2 | SPA en lugar de Next.js | Menor tamaño de bundle del Worker (límite 3 MB Free) y menor CPU. SEO básico vía HTMLRewriter. |
| D3 | Lecturas públicas por RPC JSON | Una sola llamada por página, fácil de cachear, no expone columnas privadas. |
| D4 | Servicios y productos en una tabla `catalog_items` con `kind` | Comparten fotos, detalles, descuentos y precios; evita FKs polimórficas. |
| D5 | Vigencia de descuentos evaluada en la **fecha de creación** de la reserva | "Descuento con fecha límite" = promoción válida hasta X. |
| D6 | Disponibilidad como eventos con RRULE | Permite UX idéntica a Google Calendar (recurrencias, excepciones). |
| D7 | Sin cuenta para clientes finales | Requisito. Identificación por código + teléfono/email. |
| D8 | `run_worker_first: ["/*", "!/assets/*"]` | Con solo `/` y `/admin*`, los enlaces profundos (`/s/:sede`, `/reserva/:code`) se servían como SPA sin pasar por el Worker: sin validación de tenant, sin `window.__TENANT__` ni meta/SEO. |
| D9 | CI básica desde la fase 01; CD y CI de BD/E2E en la fase 04 | Todo el código entra validado desde el primer PR; el despliegue llega cuando hay algo que desplegar. |
| D10 | Panel administrativo por tenant en `{slug}.roquintech.com/admin` (no un subdominio aparte) | Mismo origen que el sitio público → sesión aislada por empresa y un solo certificado comodín de un nivel. |
| D11 | Servigo usa `{slug}.roquintech.com` y comparte el dominio con otros productos de Roquintech | Costo 0: el certificado comodín gratuito cubre un solo nivel (`a.servigo.roquintech.com` requeriría Advanced Certificate Manager, de pago). Costo aceptado: los slugs compiten con los nombres de producto → tabla `reserved_slugs`. |
| D12 | Nada de cookies con `Domain=.roquintech.com`; sesión en `localStorage` por origen | Los subdominios de otros productos y de otras empresas son *same-site*; una cookie de dominio padre se filtraría entre ellos. |
| D13 | Slugs sin `--` y lista reservada ampliada (`media`, `auth`, `login`, nombres de correo/DNS como `autodiscover`, `ns1`…) | Evita etiquetas punycode y choques con subdominios que clientes de correo o proveedores consultan automáticamente. |
| D14 | Imágenes por URL directa de Supabase Storage, no por proxy del Worker | El Worker corre antes que la caché de Cloudflare: cada imagen gastaría 1 de las 100k peticiones/día aunque esté cacheada (~15 por página → techo de ~6.000 visitas/día en total). La URL directa no consume Worker y aprovecha la CDN de Supabase. Si el egress (5 GB) se vuelve el cuello de botella, la salida es Cloudflare R2 + `media.roquintech.com`. La CSP debe permitir `img-src` del host de Supabase. |
| D15 | Puertos locales propios: app en `5273`, Supabase en `544xx` (API 54421, BD 54422, Studio 54423, Mailpit 54424) | En la máquina de desarrollo conviven otros proyectos Vite y Supabase en los puertos por defecto (5173, 543xx). |
| D16 | Versiones fijadas en la fase 01 (nov. 2026): TypeScript **6.0** (no 7), ESLint **9** (no 10), React Router **8**, Vite 8, Vitest 5, Tailwind 4.3, shadcn CLI 4 (estilo *new-york*, Radix) | `typescript-eslint` 8 solo admite TS < 6.1 y `eslint-plugin-jsx-a11y` solo ESLint ≤ 9. Subir cuando sus plugins lo soporten. React Router 8 es la versión estable actual; se usa en modo librería igual que v7. |
| D17 | Repo público `Johaliz37/servigo` con `main` protegida (PR obligatorio, checks `ci` y `db` en verde, historial lineal, sin force push; sin exigir rama al día ni bloquear el bypass de administradores: un solo desarrollador y PRs de Dependabot, D20) | GitHub Free solo permite proteger ramas en repos públicos; un repo privado exigiría GitHub Pro (de pago). Consecuencia: ningún secreto ni dato real de empresas puede entrar al repo (`.env*`, `.dev.vars` y dumps de BD siempre fuera; los backups de la fase 04 van como artefactos, que en repos públicos **cualquiera puede descargar**: hay que cifrarlos o guardarlos en otro sitio). |
| D18 | Invitaciones: el Worker inserta la fila de `company_invitations` **con el JWT del invitador** (RLS decide qué rol puede invitar) y luego envía el correo con la secret key: `inviteUserByEmail` si la cuenta es nueva, enlace mágico si ya existe. La membresía la crea la RPC `accept_invitation(token)`, que exige que el correo de la sesión coincida con el invitado | Una sola fuente de verdad para permisos (las políticas de la fase 02) y un correo por persona aunque pertenezca a varias empresas. |
| D19 | Registro público cerrado (`enable_signup = false`), contraseñas de 8+ caracteres y plantillas de correo en español (`supabase/templates/`). Toda empresa conserva al menos un owner (trigger) | Solo se entra por invitación; evita empresas huérfanas. En producción las plantillas y la expiración de enlaces (24 h) se configuran en el dashboard (fase 04). |
| D20 | Despliegue: workflow `deploy` disparado por `workflow_run` cuando `ci` (jobs `ci` y `db`) termina en verde sobre `main`; migraciones (`supabase db push`) → `CLOUDFLARE_ENV=production pnpm build` → `wrangler deploy --secrets-file` → smoke test. El Worker de producción es `servigo-production` (sin `workers.dev` ni previews). Los secretos del Worker viven solo en el entorno `production` de GitHub y viajan con cada despliegue; nunca `wrangler secret put` ni despliegues desde una máquina local (se quitó `pnpm deploy`). `roquintech.com` y `www` se redirigen a `servigo.roquintech.com` con una *Redirect Rule* hasta que exista la web corporativa | Con el plugin de Vite, `wrangler deploy` usa la config resuelta en el build y no acepta `--env`; un despliegue local publicaría la config de `localhost`. Una sola fuente de secretos evita deriva entre GitHub y Cloudflare, y rotar = `gh secret set` + redeploy |
| D21 | Zona `roquintech.com` compartida con Microsoft 365 (MX, SPF `-all`, `autodiscover`…) y otros sitios (`monicarobles`: Custom Domain de Worker **más** una ruta específica, porque un Custom Domain no gana sobre la ruta comodín). Servigo envía correo desde el subdominio `mail.roquintech.com` (Resend: DKIM + SPF propios, sin tocar el SPF raíz) y `_dmarc` en `p=none`. Los subdominios ya ocupados se reservan en `reserved_slugs` (migración de la fase 04) | Un registro DNS explícito gana sobre el comodín DNS, pero no sobre la ruta del Worker: todo sitio proxied ajeno a Servigo necesita su ruta `host/*` (el smoke test lo vigila). Una empresa con ese slug quedaría inaccesible. Separar el remitente en un subdominio evita romper la entrega del correo corporativo |
| D22 | Imágenes: el navegador recorta y convierte todo a WebP (≤ 1600 px, ≤ 400 KB, más miniatura `.thumb.webp` de 400 px); solo entran JPG, PNG o WebP. Ruta `{company}/{entidad}/{uuid}-{hash}.webp`, inmutable y con caché de 1 año. El archivo reemplazado se borra después de guardar el formulario, y cada registro tiene su propio archivo (al duplicar se copia con `storage.copy`) | Mantiene el egress y la cuota de Storage bajos sin la transformación de imágenes de pago. Borrar solo tras guardar evita dejar el sitio sin imagen si se cancela, y un archivo por registro hace seguro el borrado |
| D23 | Reglas de sedes en la BD: al menos una sede activa, no borrar sedes con reservas (se inactivan) y copia del catálogo al encender «Catálogo propio». El orden por arrastre usa la RPC `reorder_rows`, atómica y sujeta a RLS. Tras editar perfil o marca, el panel purga la caché del tenant (`POST /api/admin/purge-tenant`) y aplica la empresa fresca sin recargar | Las reglas valen igual desde el panel, el SQL o futuras APIs. El sitio público refleja los cambios en segundos y no al vencer la caché de 60 s |
| D24 | Precios: una sola regla, definida en `src/shared/pricing.ts`, con gemelas en SQL (`currency_digits`, `discount_amount`, `pick_discount`), que usan `effective_catalog` y `effective_addons` y, en la fase 10, `create_booking`. 0 decimales en COP, CLP, PYG, JPY y KRW, y 2 en el resto. Redondeo de mitades hacia arriba con aritmética entera. Gana el descuento de mayor ahorro (empate: vence antes, luego id). Las fechas de los descuentos se eligen por día en la zona de la empresa (00:00 a 23:59:59.999, inclusivas). La ficha se guarda en una transacción con `upsert_catalog_item` (invoker, RLS). Un ítem con reservas no se borra: se inactiva | Un único conjunto de casos (`fase06_pricing.test.sql`), ejecutado contra ambas implementaciones, impide que el panel, el sitio y la reserva muestren precios distintos. Intl dice 2 decimales para COP aunque nadie cobra centavos. Guardar todo en una transacción evita detalles o fotos huérfanos |
| D25 | Información adicional: la forma de `booking_fields.options` y `validation` la exige un trigger. Cada opción tiene un `value` estable, generado del texto al crearla, que no cambia al renombrarla; las respuestas guardan ese `value` más una copia de `label` y `type`, y se muestran con el texto actual de la opción (o con el `value` si la opción ya no existe). El tipo de un campo no cambia tras crearlo, y un campo con respuestas no se borra: se inactiva. `buildAnswersSchema` (`src/shared/booking-fields.ts`) es la regla de validación de respuestas, y `create_booking` (fase 10) debe aplicar las mismas reglas | Renombrar una opción o reordenar campos nunca rompe reservas pasadas. Validar la forma en la BD protege al formulario público y a la validación en SQL de datos mal formados escritos por cualquier vía |
| D26 | Disponibilidad: un solo motor de cupos, `src/shared/availability.ts`, para la vista previa del calendario, `GET /api/public/slots` y la validación de la reserva. Las series se expanden en hora de pared de la zona del evento: las reglas diarias y semanales con una vía rápida propia, comprobada contra `rrule`; las demás con `rrule`. El calendario usa FullCalendar estándar en `timeZone: 'UTC'` con horas de pared de la sede, sin el plugin `@fullcalendar/rrule` ni plugins de zonas, y pinta las ocurrencias del motor. Los cambios se guardan como planes {inserts, updates, deletes} con `apply_availability_plan` (transacción con RLS), y «Deshacer» aplica el plan inverso. El Worker lee con `get_slot_inputs` (secret key, sin datos personales) y guarda la respuesta 30 s | El calendario, el sitio y la reserva muestran los mismos cupos. Con la vía rápida, un cálculo de 31 días cabe en el presupuesto de CPU del Worker Free (~2 ms de 10 ms); el iterador de `rrule` gastaba ~0,2 ms por serie. Con horas de pared, los cambios de hora no corren los horarios. Un plan atómico hace que «Este y los siguientes» (varias filas) no quede a medias |
| D27 | Sitio público: una RPC `security definer` por página (`get_public_site`, `get_public_branch`, `get_public_item`, `get_public_about`, `get_public_sitemap`), con precios de `effective_catalog`/`effective_addons` (D24). El Worker las lee por `fetch` con la secret key y las guarda 60 s en la Cache API con una **versión por empresa**: purgar es cambiar la versión (`POST /api/admin/purge-public`, que el panel llama tras cada guardado de owner/admin). El navegador recibe `max-age=60, stale-while-revalidate=300`. El JS inicial de la ruta pública no lleva Radix, Embla, sonner, date-fns, zod ni supabase-js: carrusel y galería con `scroll-snap` nativo en lugar de Embla, menús propios (`Disclosure`), Toaster solo en panel, acceso y consola, y Markdown y lightbox diferidos | El presupuesto de 150 KB gzip (fase 09 §4) no cabía con esas librerías: React, React Router y TanStack Query ya suman ~137 KB. Con scroll-snap, el *swipe* lo hace el navegador. Con una versión por empresa, la purga no tiene que enumerar claves (la Cache API no borra por prefijo). Quien edita puede ver hasta 60 s de caché de su propio navegador; cualquier otro visitante ve el cambio al instante |
