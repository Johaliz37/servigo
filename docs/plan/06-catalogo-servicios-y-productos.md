# Fase 06 — Catálogo: servicios y productos

## Objetivo

CRUD completo de **servicios** y **productos** (comparten la misma ficha: nombre, referencia, precio, descripción, lista de detalles, fotos, descuentos con fecha límite, activo/inactivo), la relación de productos que se ofrecen dentro de cada servicio, la marca "se puede añadir a la reserva", y la configuración por sede cuando la sede tiene catálogo propio. Incluye el módulo de precios compartido.

## Prerrequisitos

Fase 05. Tablas: `catalog_items`, `catalog_item_details`, `catalog_item_photos`, `discounts`, `service_products`, `branch_catalog_items`, `branches`.

## Tareas

### 1. Módulo de precios (`src/shared/pricing.ts`)
- [ ] `activeDiscount(item, discounts, at: Date, branchId)` → descuento vigente (`is_active`, `starts_at ≤ at ≤ ends_at`, sede coincide o null) con **mayor ahorro**.
- [ ] `effectivePrice(item, branchOverride?, discount?)` → `{ base, discountAmount, final, discountLabel, endsAt }`. Redondeo a 2 decimales (o 0 decimales si la moneda es COP/CLP — usar `Intl.NumberFormat().resolvedOptions().maximumFractionDigits`).
- [ ] `bookingTotals(service, addons[], at)` → subtotal, descuentos, total.
- [ ] Tests unitarios exhaustivos (límites de fecha, porcentaje 100, fijo mayor que el precio → precio 0, override de sede).
- [ ] La misma lógica replicada en SQL en `create_booking` (fase 10) — documentar que ambas deben coincidir y añadir un test que compare resultados.

### 2. Listados — `/admin/catalogo/servicios` y `/admin/catalogo/productos`
- [ ] `DataTable` con: foto de portada, nombre, referencia, precio (y precio con descuento si aplica, con badge "‑20 % hasta 30/11"), duración (servicios), estado, sedes. Búsqueda, filtro por estado y sede, orden por arrastre (`sort_order`).
- [ ] Acciones: editar, duplicar, activar/inactivar (switch en la fila), eliminar (solo si no tiene reservas; si tiene, sugerir inactivar).

### 3. Ficha de ítem (formulario con pestañas)
- [ ] **General**: nombre, referencia (única), descripción corta, descripción larga (Markdown), precio, destacado, activo.
  - Solo servicios: duración, buffer antes/después, capacidad simultánea.
  - Solo productos: "Se puede añadir dentro de una reserva" (`allow_in_booking`), stock opcional.
- [ ] **Detalles**: lista editable y ordenable de `label` + `value` opcional (ej. "Incluye: toalla", "Duración: 60 min").
- [ ] **Fotos**: hasta 8, usando `ImageUploader` (fase 05), reordenables, marcar portada, texto alternativo obligatorio (accesibilidad).
- [ ] **Descuentos**: lista; cada uno con etiqueta, tipo (% o valor fijo), valor, fecha inicio opcional, **fecha límite** obligatoria, sede (todas o una), activo. Indicar estado calculado: *Programado / Vigente / Vencido*. Vista previa del precio resultante.
- [ ] **Productos del servicio** (solo servicios): seleccionar productos activos (combobox con búsqueda), cantidad máxima por reserva, orden. Aviso si un producto seleccionado no tiene `allow_in_booking` activo ("no se mostrará al reservar").
- [ ] **Sedes**: si alguna sede tiene `own_catalog = true`, tabla de sedes con switch "Disponible en esta sede" y "Precio en esta sede" opcional. Para sedes sin catálogo propio mostrar "Incluido automáticamente".
- [ ] Validación con Zod compartida (`src/shared/schemas/catalog.ts`). Guardado transaccional mediante RPC `upsert_catalog_item(payload jsonb)` (security invoker, respeta RLS) para no dejar detalles/fotos huérfanos.

### 4. Vista por sede — `/admin/sedes/:id/catalogo`
- [ ] Para sedes con catálogo propio: matriz de ítems con switch de disponibilidad y precio por sede; acción masiva "Activar todos / Desactivar todos".

### 5. Función de lectura del catálogo efectivo
- [ ] SQL `effective_catalog(p_branch uuid)` → ítems activos disponibles en la sede (aplica `own_catalog`, `branch_catalog_items.is_active`, `price_override`). La usan las RPC públicas (fase 09) y la reserva (fase 10).

## Criterios de aceptación

- [ ] Crear un servicio con 3 detalles, 4 fotos y un descuento del 15 % hasta mañana; el listado muestra el precio rebajado y el badge.
- [ ] Pasada la fecha límite (simular con `now` inyectado en tests) el precio vuelve al base.
- [ ] Inactivar un servicio lo oculta de `effective_catalog`.
- [ ] Producto asociado a un servicio con `allow_in_booking = false` no aparece en la lista de add-ons (`effective_addons(service, branch)` devuelve vacío).
- [ ] Sede con catálogo propio y precio override devuelve ese precio en `effective_catalog`.
- [ ] Tests de `pricing.ts` > 95 % de cobertura.
