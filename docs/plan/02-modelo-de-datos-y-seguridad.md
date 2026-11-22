# Fase 02 — Modelo de datos y seguridad multitenant

## Objetivo

Crear en `supabase/migrations/` el esquema completo, las políticas RLS, el bucket de Storage, las funciones auxiliares y los datos semilla, con pruebas pgTAP que demuestren el aislamiento entre empresas.

## Prerrequisitos

Fase 01 completa (`pnpm db:start` funciona).

## Alcance

Esquema de todas las entidades del producto. Las fases posteriores **usan** estas tablas; si necesitan columnas nuevas, crean una migración adicional y lo registran en su archivo.

## Tareas

- [x] Migración `extensions`: `pgcrypto`, `btree_gist`, `citext`, `pg_trgm`.
- [x] Migración `enums`.
- [x] Migración `core` (plataforma, empresas, miembros, sedes).
- [x] Migración `content` (acerca de, patrocinadores, redes, footer).
- [x] Migración `catalog` (ítems, detalles, fotos, descuentos, relación servicio-producto, por sede).
- [x] Migración `booking_fields`.
- [x] Migración `availability`.
- [x] Migración `bookings`.
- [x] Migración `rls_helpers` + `rls_policies`.
- [x] Migración `storage` (bucket + políticas).
- [x] Migración `triggers` (`updated_at`, validaciones cruzadas de `company_id`).
- [x] `seed.sql` con 2 empresas de ejemplo (`demo` con 2 sedes y `spa` con 1 sede), servicios, productos, campos, disponibilidad y 20 reservas.
- [x] Pruebas pgTAP en `supabase/tests/`.
- [x] `pnpm db:types` y commit del archivo de tipos.

## 1. Enums

```sql
create type member_role      as enum ('owner','admin','staff');
create type company_status   as enum ('active','suspended');
create type catalog_kind     as enum ('service','product');
create type discount_type    as enum ('percent','fixed');
create type field_type       as enum ('text','textarea','select','multiselect','radio','checkbox','number','date');
create type availability_kind as enum ('open','closed');
create type booking_status   as enum ('pending','confirmed','completed','cancelled','no_show');
create type social_network   as enum ('facebook','instagram','tiktok','x','youtube','linkedin','whatsapp','website','email','phone','other');
```

Mapeo de los tipos de "información adicional" pedidos: *texto libre* → `text`/`textarea`; *lista de ítems* → `select` (desplegable, una opción) o `multiselect`; *check* → `checkbox` (sí/no); *lista de opciones* → `radio`.

## 2. Tablas

Todas las tablas de tenant tienen `company_id uuid not null references companies on delete cascade`, `created_at timestamptz default now()`, `updated_at timestamptz default now()` (trigger) e índice por `company_id`.

### 2.1 Núcleo

**platform_admins**: `user_id uuid pk references auth.users`.

**reserved_slugs**: `slug citext pk`, `reason text` (`system` | `roquintech_product`), `created_at`. Sembrada en la migración `core` con la lista de `00 §4`. Un trigger `before insert or update of slug` en `companies` rechaza los slugs que estén aquí. Solo `platform_admin` puede escribirla (RLS). Para lanzar un producto nuevo de Roquintech basta un `insert` aquí, tras confirmar que ninguna empresa ya usa ese slug.

**companies**
| Columna | Tipo | Notas |
|---------|------|-------|
| id | uuid pk | |
| slug | citext unique | Regex `00 §4`; trigger contra `reserved_slugs` |
| name | text not null | |
| legal_name, tax_id | text | |
| logo_path, favicon_path, hero_image_path | text | Rutas en bucket `media` |
| primary_color, secondary_color | text | Hex `#RRGGBB` |
| contact_email, contact_phone, whatsapp | text | |
| timezone | text default 'America/Bogota' | IANA |
| currency | char(3) default 'COP' | |
| locale | text default 'es-CO' | |
| footer | jsonb default '{}' | `{ text, show_socials, links:[{label,url}], address, show_powered_by }` |
| booking_settings | jsonb | `{ auto_confirm:false, min_lead_minutes:60, max_days_ahead:60, slot_step_minutes:30, allow_customer_cancel:false, cancel_limit_hours:24, require_email:false, terms_text:'' }` |
| seo | jsonb | `{ title, description, og_image_path }` |
| status | company_status default 'active' | |

**company_members**: `id`, `company_id`, `user_id references auth.users`, `role member_role`, `branch_ids uuid[] null` (null = todas), `unique(company_id,user_id)`.

**company_invitations**: `id`, `company_id`, `email citext`, `role`, `branch_ids`, `token uuid`, `expires_at`, `accepted_at`.

**branches** (sedes)
| Columna | Tipo | Notas |
|---------|------|-------|
| id, company_id | uuid | |
| slug | citext | `unique(company_id, slug)`; se usa en la URL `/s/{slug}` |
| name | text | |
| address, city, phone, whatsapp, email, maps_url | text | |
| lat, lng | numeric(9,6) | opcional |
| timezone | text | null = el de la empresa |
| cover_image_path | text | Imagen mostrada en el selector de sedes |
| header | jsonb | `{ title, subtitle, image_path, overlay_opacity }` (encabezado de la sede) |
| own_availability | boolean default false | true = usa sus propias ventanas; false = usa las de la empresa |
| own_catalog | boolean default false | true = usa `branch_catalog_items`; false = todo el catálogo activo |
| is_active | boolean default true | |
| sort_order | int default 0 | |

### 2.2 Contenido

**about_sections**: `id`, `company_id`, `branch_id uuid null` (null = general de la empresa), `title`, `body` (Markdown sanitizado), `image_path`, `is_visible bool default false`, `sort_order`. Índice único parcial: una sección general por empresa (`where branch_id is null`) y una por sede.

**sponsors**: `id`, `company_id`, `branch_id uuid not null`, `name`, `description`, `image_path`, `url`, `is_visible bool default true`, `sort_order`.

**social_links**: `id`, `company_id`, `branch_id uuid null` (null = empresa; aparece en todas las sedes salvo que la sede tenga los suyos), `network social_network`, `label`, `url`, `is_visible`, `sort_order`.

### 2.3 Catálogo

**catalog_items** (servicios y productos)
| Columna | Tipo | Notas |
|---------|------|-------|
| id, company_id | uuid | |
| kind | catalog_kind | |
| name | text not null | |
| reference | text | Referencia/SKU, `unique(company_id, reference)` cuando no es null |
| short_description | text | Para tarjetas del carrusel |
| description | text | Markdown sanitizado |
| price | numeric(12,2) not null check ≥ 0 | |
| duration_minutes | int | Requerido si `kind='service'` (check) |
| buffer_before_minutes, buffer_after_minutes | int default 0 | Solo servicios |
| capacity | int default 1 | Reservas simultáneas en el mismo horario (solo servicios) |
| allow_in_booking | boolean default false | Solo productos: puede añadirse a una reserva |
| stock | int null | Solo productos, opcional (null = sin control) |
| is_active | boolean default true | Inactivar |
| is_featured | boolean default false | |
| sort_order | int | |

**catalog_item_details**: `id`, `company_id`, `item_id`, `label text`, `value text null`, `sort_order` (la "lista de detalles").

**catalog_item_photos**: `id`, `company_id`, `item_id`, `path`, `thumb_path`, `alt`, `is_cover bool`, `sort_order`. Máximo 8 por ítem (trigger).

**discounts**: `id`, `company_id`, `item_id`, `label`, `type discount_type`, `value numeric(12,2)` (check: percent 0–100), `starts_at timestamptz null`, `ends_at timestamptz not null` (fecha límite), `branch_id uuid null` (null = todas), `is_active`. Regla: si hay varios vigentes se aplica el de **mayor ahorro**.

**service_products**: `company_id`, `service_id`, `product_id`, `max_quantity int default 10`, `sort_order`, `pk(service_id, product_id)`. Define qué productos se ofrecen dentro de un servicio. Un producto aparece como *add-on* en la reserva solo si está aquí **y** `allow_in_booking = true` **y** está activo en la sede.

**branch_catalog_items**: `company_id`, `branch_id`, `item_id`, `is_active bool default true`, `price_override numeric(12,2) null`, `pk(branch_id, item_id)`. Solo se consulta si `branches.own_catalog = true`.

### 2.4 Información adicional

**booking_fields**: `id`, `company_id`, `service_id uuid null` (null = general, se pide en todas las reservas), `label`, `help_text`, `placeholder`, `type field_type`, `options jsonb default '[]'` (`[{value,label}]`), `required bool`, `validation jsonb` (`{min,max,minLength,maxLength,pattern}`), `is_active`, `sort_order`.

### 2.5 Disponibilidad

**availability_events** (modelo tipo Google Calendar)
| Columna | Tipo | Notas |
|---------|------|-------|
| id, company_id | uuid | |
| branch_id | uuid null | null = nivel empresa (lo usan las sedes con `own_availability=false`) |
| kind | availability_kind | `open` = ventana de atención; `closed` = no disponibilidad |
| title | text | |
| notes | text | |
| color | text | |
| starts_at, ends_at | timestamptz | Primera ocurrencia |
| all_day | boolean | |
| timezone | text | Zona en que se interpreta la recurrencia |
| rrule | text null | RFC 5545 (`FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=...`) |
| exdates | timestamptz[] default '{}' | Ocurrencias eliminadas |
| recurrence_parent_id | uuid null | Ocurrencia modificada ("solo este evento") |
| recurrence_original_start | timestamptz null | Ocurrencia que reemplaza |
| service_ids | uuid[] null | null = aplica a todos los servicios |
| capacity_override | int null | Opcional: capacidad distinta en esa ventana |

### 2.6 Reservas

**customers**: `id`, `company_id`, `name`, `phone` (normalizado E.164), `email citext null`, `notes`, `unique(company_id, phone)`. Se hace *upsert* al reservar (para dashboard y búsqueda).

**bookings**
| Columna | Tipo | Notas |
|---------|------|-------|
| id, company_id, branch_id | uuid | |
| service_id | uuid | |
| customer_id | uuid | |
| code | text | `unique(company_id, code)` |
| status | booking_status | |
| starts_at, ends_at | timestamptz | Sin buffers |
| block_starts_at, block_ends_at | timestamptz | Con buffers (para ocupación) |
| customer_name, customer_phone, customer_email | text | Snapshot |
| customer_notes, internal_notes | text | |
| service_name, service_price, service_discount | snapshot | |
| products_total, discount_total, total | numeric(12,2) | |
| currency | char(3) | |
| source | text default 'web' | `web` / `admin` |
| cancelled_at, cancel_reason | | |
| created_by | uuid null | Miembro si se creó desde admin |

Índices: `(company_id, branch_id, starts_at)`, `(company_id, customer_phone)`, `(company_id, customer_email)`, `gist (branch_id, service_id, tstzrange(block_starts_at, block_ends_at))`.

**booking_items**: `id`, `company_id`, `booking_id`, `product_id`, `name`, `unit_price`, `discount`, `quantity`, `line_total`.

**booking_answers**: `id`, `company_id`, `booking_id`, `field_id null`, `label` (snapshot), `type`, `value jsonb`.

**booking_events** (historial): `id`, `company_id`, `booking_id`, `actor uuid null`, `action` (`created`, `status_changed`, `rescheduled`, `edited`), `payload jsonb`, `created_at`.

## 3. Funciones auxiliares de seguridad

```sql
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create or replace function public.has_company_role(p_company uuid, p_roles member_role[] default '{owner,admin,staff}')
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.company_members m
    where m.company_id = p_company and m.user_id = auth.uid() and m.role = any(p_roles));
$$;

create or replace function public.can_access_branch(p_company uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or exists (
    select 1 from public.company_members m
    where m.company_id = p_company and m.user_id = auth.uid()
      and (m.role in ('owner','admin') or m.branch_ids is null or p_branch = any(m.branch_ids)));
$$;
```

## 4. Políticas RLS (patrón)

- `alter table ... enable row level security;` en **todas** las tablas de `public`.
- `revoke all on all tables in schema public from anon;` — el público solo usa RPC.
- Patrón para tablas de configuración (catálogo, contenido, campos, sedes):
  - `select`: `has_company_role(company_id)`
  - `insert/update/delete`: `has_company_role(company_id, '{owner,admin}')`
- `availability_events`, `bookings`, `booking_*`, `customers`:
  - `select/update`: `has_company_role(company_id) and (branch_id is null or can_access_branch(company_id, branch_id))`
  - `insert` de reservas desde admin: igual que `update`. Desde público: solo RPC.
  - `delete` de reservas: solo `owner`.
- `company_members`: select si es miembro; insert/update/delete solo `owner` (y `admin` para `staff`).
- `companies`: select si es miembro; update `owner/admin`; insert/delete solo `platform_admin`.
- Trigger `enforce_company_consistency`: en tablas hijas, verifica que `company_id` coincide con el del padre (`item_id`, `branch_id`, `booking_id`) para impedir referencias cruzadas entre tenants.

## 5. Storage

- Bucket `media` público (lectura), `file_size_limit = 2MB`, `allowed_mime_types = {image/webp,image/jpeg,image/png,image/svg+xml}` (SVG solo para logos; sanitizar).
- Convención de ruta: `{company_id}/{entidad}/{uuid}-{hash}.webp`.
- Políticas en `storage.objects`:
  - insert/update/delete: `bucket_id = 'media' and has_company_role(((storage.foldername(name))[1])::uuid, '{owner,admin}')`.
- Función `company_storage_usage(company_id)` para mostrar cuota (límite blando por empresa: 100 MB).

## 6. RPC base (esta fase solo crea la firma y versión mínima; se completan en fases 09–10)

| Función | Rol | Descripción |
|---------|-----|-------------|
| `ping()` | anon | Devuelve `now()`; usado por el keep-alive. |
| `get_company_by_slug(slug)` | anon | `{id, slug, name, status, branding}` o null. |
| `get_public_site(slug)` | anon | Fase 09. |
| `get_public_branch(slug, branch_slug)` | anon | Fase 09. |
| `get_booking_context(...)` | service_role | Fase 10. |
| `create_booking(payload jsonb)` | service_role | Fase 10. |
| `find_bookings(...)` | service_role | Fase 10. |

Todas `security definer`, `set search_path = ''`, nombres calificados, `grant execute` explícito al rol correspondiente y `revoke` a `public`.

## 7. Pruebas pgTAP (`supabase/tests/`)

- [x] `rls_isolation.test.sql`: usuario de empresa A no ve ni modifica filas de B en cada tabla.
- [x] `rls_staff.test.sql`: staff con `branch_ids = {sede1}` no ve reservas de sede2.
- [x] `anon.test.sql`: `anon` no puede `select` en ninguna tabla; sí puede ejecutar `ping` y `get_company_by_slug`.
- [x] `consistency.test.sql`: insertar foto con `company_id` distinto al del ítem falla.
- [x] `constraints.test.sql`: servicio sin duración falla; slug reservado falla; porcentaje > 100 falla.

Helper: usar `basejump-supabase_test_helpers` (`tests.create_supabase_user`, `tests.authenticate_as`) o funciones propias equivalentes.

## Criterios de aceptación

- [x] `pnpm db:reset` aplica migraciones y seed sin errores.
- [x] `pnpm db:test` pasa al 100 %.
- [x] `supabase db lint` sin errores; *Security Advisor* de Studio sin alertas de RLS deshabilitado o `search_path` mutable.
- [x] `src/shared/database.types.ts` generado y commiteado.
- [x] Diagrama ER (Mermaid) añadido en `docs/er.md`.

## Notas de ejecución

- Migraciones en `supabase/migrations/20261122170000_*` … `20261122171100_*`. El orden real es: extensions → enums → core → content → catalog → booking_fields → availability → bookings → triggers → rls → storage → rpc_base.
- **Admin gestiona solo staff** (miembros e invitaciones), como dice §4. También se ajustó `00 §7`.
- **Staff** puede crear, editar y borrar eventos de disponibilidad de sus sedes (la "gestión de calendario" de `00 §7`). Los eventos de nivel empresa solo los editan owner y admin.
- **RPC**: solo `ping` y `get_company_by_slug`. Las de sitio público y reservas se crean con su firma definitiva en las fases 09–10.
- **Solo el superadmin** cambia `slug` y `status` de una empresa (trigger `companies_guard_platform_fields`).
- Con `search_path = ''`, comparar columnas `citext` exige `operator(extensions.=)`; un `=` a secas compara como `text` y distingue mayúsculas.
- Quitar a `PUBLIC` el permiso de ejecutar funciones nuevas requiere `alter default privileges ... revoke execute on functions from public` **sin** `in schema`.
- Pruebas: helpers propios en `supabase/tests/000-setup-tests-hooks.sql` (esquema `tests`, solo local/CI) en lugar de `basejump-supabase_test_helpers`. `tests.create_tenant()` crea una fila en cada tabla, y las pruebas de aislamiento recorren todas las tablas con `company_id` leyendo el catálogo: una tabla nueva queda cubierta sin tocar los tests. Total: 150 aserciones.
- `supabase db advisors --type all --level warn`: 0 avisos (equivale al Security Advisor de Studio).
- Seed: usuarios `superadmin@servigo.local`, `owner|admin|staff@demo.local` y `owner@spa.local` (contraseña `Servigo123!`, solo local). La reserva `K7M29QXA` es fija para pruebas.
- `pnpm db:types` formatea el archivo generado con Prettier.