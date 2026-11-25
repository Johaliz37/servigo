# Fase 06 — Catálogo: servicios y productos

## Objetivo

CRUD completo de **servicios** y **productos** (comparten la misma ficha: nombre, referencia, precio, descripción, lista de detalles, fotos, descuentos con fecha límite, activo/inactivo), la relación de productos que se ofrecen dentro de cada servicio, la marca "se puede añadir a la reserva", y la configuración por sede cuando la sede tiene catálogo propio. Incluye el módulo de precios compartido.

## Prerrequisitos

Fase 05. Tablas: `catalog_items`, `catalog_item_details`, `catalog_item_photos`, `discounts`, `service_products`, `branch_catalog_items`, `branches`.

## Tareas

### 1. Módulo de precios (`src/shared/pricing.ts`)
- [x] `activeDiscount(item, discounts, at: Date, branchId)` → descuento vigente (`is_active`, `starts_at ≤ at ≤ ends_at`, sede coincide o null) con **mayor ahorro**.
- [x] `effectivePrice(item, branchOverride?, discount?)` → `{ base, discountAmount, final, discountLabel, endsAt }`. Redondeo a 2 decimales (o 0 decimales si la moneda es COP/CLP — usar `Intl.NumberFormat().resolvedOptions().maximumFractionDigits`).
- [x] `bookingTotals(service, addons[], at)` → subtotal, descuentos, total.
- [x] Tests unitarios exhaustivos (límites de fecha, porcentaje 100, fijo mayor que el precio → precio 0, override de sede).
- [x] La misma lógica replicada en SQL en `create_booking` (fase 10) — documentar que ambas deben coincidir y añadir un test que compare resultados.

### 2. Listados — `/admin/catalogo/servicios` y `/admin/catalogo/productos`
- [x] `DataTable` con: foto de portada, nombre, referencia, precio (y precio con descuento si aplica, con badge "‑20 % hasta 30/11"), duración (servicios), estado, sedes. Búsqueda, filtro por estado y sede, orden por arrastre (`sort_order`).
- [x] Acciones: editar, duplicar, activar/inactivar (switch en la fila), eliminar (solo si no tiene reservas; si tiene, sugerir inactivar).

### 3. Ficha de ítem (formulario con pestañas)
- [x] **General**: nombre, referencia (única), descripción corta, descripción larga (Markdown), precio, destacado, activo.
  - Solo servicios: duración, buffer antes/después, capacidad simultánea.
  - Solo productos: "Se puede añadir dentro de una reserva" (`allow_in_booking`), stock opcional.
- [x] **Detalles**: lista editable y ordenable de `label` + `value` opcional (ej. "Incluye: toalla", "Duración: 60 min").
- [x] **Fotos**: hasta 8, usando `ImageUploader` (fase 05), reordenables, marcar portada, texto alternativo obligatorio (accesibilidad).
- [x] **Descuentos**: lista; cada uno con etiqueta, tipo (% o valor fijo), valor, fecha inicio opcional, **fecha límite** obligatoria, sede (todas o una), activo. Indicar estado calculado: *Programado / Vigente / Vencido*. Vista previa del precio resultante.
- [x] **Productos del servicio** (solo servicios): seleccionar productos activos (combobox con búsqueda), cantidad máxima por reserva, orden. Aviso si un producto seleccionado no tiene `allow_in_booking` activo ("no se mostrará al reservar").
- [x] **Sedes**: si alguna sede tiene `own_catalog = true`, tabla de sedes con switch "Disponible en esta sede" y "Precio en esta sede" opcional. Para sedes sin catálogo propio mostrar "Incluido automáticamente".
- [x] Validación con Zod compartida (`src/shared/schemas/catalog.ts`). Guardado transaccional mediante RPC `upsert_catalog_item(payload jsonb)` (security invoker, respeta RLS) para no dejar detalles/fotos huérfanos.

### 4. Vista por sede — `/admin/sedes/:id/catalogo`
- [x] Para sedes con catálogo propio: matriz de ítems con switch de disponibilidad y precio por sede; acción masiva "Activar todos / Desactivar todos".

### 5. Función de lectura del catálogo efectivo
- [x] SQL `effective_catalog(p_branch uuid)` → ítems activos disponibles en la sede (aplica `own_catalog`, `branch_catalog_items.is_active`, `price_override`). La usan las RPC públicas (fase 09) y la reserva (fase 10).

## Criterios de aceptación

- [x] Crear un servicio con 3 detalles, 4 fotos y un descuento del 15 % hasta mañana; el listado muestra el precio rebajado y el badge.
- [x] Pasada la fecha límite (simular con `now` inyectado en tests) el precio vuelve al base.
- [x] Inactivar un servicio lo oculta de `effective_catalog`.
- [x] Producto asociado a un servicio con `allow_in_booking = false` no aparece en la lista de add-ons (`effective_addons(service, branch)` devuelve vacío).
- [x] Sede con catálogo propio y precio override devuelve ese precio en `effective_catalog`.
- [x] Tests de `pricing.ts` > 95 % de cobertura.

## Notas de ejecución

- **Precios (`src/shared/pricing.ts`, D24):**
  - **Decimales.** 0 para COP, CLP, PYG, JPY y KRW; 2 para el resto. No se usa `Intl…maximumFractionDigits` como sugería el plan porque Intl devuelve 2 para COP. La lista es la misma de `formatMoney`.
  - **Redondeo.** Mitades hacia arriba, igual que `round` de Postgres. Se calcula con enteros (`bigint`, en centavos), así 19,99 × 15 % da 3,00 y no 2,99.
  - **Elección.** Gana el descuento de mayor ahorro. Si empatan, el que vence antes; si aún empatan, el id menor.
  - **Valores extremos.** Un porcentaje del 100 % o un fijo mayor que el precio dejan el precio en 0, nunca negativo.
  - **Totales de la reserva.** `bookingTotals` aplica el descuento de cada producto por unidad. `productsTotal` es la suma antes de descuentos (`bookings.products_total`) y `discountTotal` incluye servicio y productos (`bookings.discount_total`).
  - **Cobertura.** 100 % en sentencias, ramas, funciones y líneas. `pnpm test:coverage` lo exige (más de 95 %) en el CI.
- **Paridad con SQL.** `currency_digits`, `discount_amount` y `pick_discount` son las gemelas en SQL. `pick_discount` recibe las filas de descuento como arreglo, para poder probarse sin datos. Los casos viven en un solo lugar, el bloque `$cases$` de `supabase/tests/fase06_pricing.test.sql`, con 19 casos:
  - pgTAP los ejecuta contra SQL;
  - `pricing.parity.test.ts` los lee (`?raw`) y los ejecuta contra TS.
  
  `create_booking` (fase 10) debe calcular con `effective_catalog` y `effective_addons`, no con fórmulas propias.
- **Migración `catalog_pricing_rpc`:**
  - `effective_catalog(sede, at = now())` aplica `own_catalog`, `branch_catalog_items.is_active` y `price_override`, más el descuento vigente y la portada.
    - Es `security definer` porque son datos públicos, pero solo responde por empresas activas y sedes activas.
    - Ejecutan `authenticated` y `service_role`. Las RPC públicas de la fase 09 la llaman desde dentro.
  - `effective_addons(servicio, sede, at)` devuelve los productos asociados que estén activos y disponibles en la sede, tengan `allow_in_booking` y tengan stock si lo controlan. El servicio también debe estar disponible. La cantidad máxima se limita al stock.
  - `upsert_catalog_item(payload)`:
    - Es `security invoker`, así que RLS solo deja escribir a owner y admin.
    - Crea o actualiza la ficha y reemplaza en la misma transacción las listas que vengan en el payload. Las listas ausentes no se tocan.
    - Los descuentos conservan su id.
  - Trigger: un ítem con reservas no se borra (servicio en `bookings`, producto en `booking_items`). Se ofrece inactivarlo.
  - `reorder_rows` también ordena `catalog_items`.
  - pgTAP: 28 asserts nuevos (227 en total).
- **Esquemas.** Están en `src/shared/catalog.ts` y no en `src/shared/schemas/catalog.ts`: ya existe `src/shared/schemas.ts`, y se sigue el patrón de `content.ts`. Los campos que no aplican al tipo se normalizan antes de guardar para cumplir los CHECK de la tabla.
- **Fechas de los descuentos.** Se eligen por día en la zona de la empresa: el inicio es a las 00:00 y la fecha límite a las 23:59:59.999 de ese día, ambos inclusivos. El estado (Programado, Vigente, Vencido, Inactivo) y la vista previa del precio se calculan con `pricing.ts`.
- **Listado.**
  - Es una tabla propia con filas reordenables (dnd-kit, también con teclado) en lugar de `DataTable`, porque el orden lo define `sort_order`.
  - El arrastre se desactiva si hay búsqueda o filtros.
  - Con el filtro de sede, el precio mostrado es el de esa sede (precio propio y descuentos de la sede).
  - Al duplicar se copian la ficha completa y sus fotos (`storage.copy`); la copia queda sin referencia e inactiva.
- **Ficha.**
  - Si una pestaña tiene errores, muestra un punto rojo, y al guardar con errores se salta a esa pestaña.
  - Al salir con cambios sin guardar se pide confirmación (`useBlocker`).
  - Una foto subida y quitada antes de guardar se borra de inmediato; las ya guardadas se borran al guardar (D22).
  - El texto alternativo de cada foto es obligatorio.
- **Catálogo por sede** (`/admin/sedes/:id/catalogo`, desde el menú de la sede): un interruptor y un precio por ítem, que se guardan al salir del campo, y botones «Activar todos» y «Desactivar todos» por tipo.
- **E2E.** Ahora en serie, con un solo worker: las pruebas comparten la BD con seed (las fases 05 y 06 tocan la misma sede) y comprimir imágenes en paralelo satura el servidor de desarrollo.
- **Verificación:**
  - Vitest 123/123, pgTAP 227/227, `db lint` sin errores.
  - E2E 15/15 (3 nuevas, repetibles).
  - Capturas en escritorio y en móvil oscuro, sin errores de consola ni desborde horizontal.
  - El bundle público no incluye el catálogo.
