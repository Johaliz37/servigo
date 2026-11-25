# Fase 11 — Gestión de reservas (empresa)

## Objetivo

Que la empresa gestione las reservas recibidas: verlas en lista y calendario, filtrarlas, cambiar su estado, reprogramarlas, editarlas, crearlas manualmente y consultar su historial, respetando las sedes asignadas a cada miembro.

## Prerrequisitos

Fase 10. Tablas `bookings`, `booking_items`, `booking_answers`, `booking_events`, `customers`. Motor de disponibilidad (fase 08). `DynamicFields` (fase 07).

## Máquina de estados

```
pending ──confirmar──> confirmed ──completar──> completed
   │                      │  └──no asistió──> no_show
   └──cancelar──┐         └──cancelar──┐
                ▼                       ▼
            cancelled  <────────────────┘
```
Transiciones validadas en SQL (`change_booking_status(id, to, reason)`), cada cambio inserta en `booking_events`. `completed`/`no_show` solo para reservas cuya hora ya pasó.

## Tareas

### 1. Bandeja `/admin/reservas`
- [x] Pestañas rápidas: **Hoy · Próximas · Pendientes (n) · Pasadas · Canceladas · Todas**.
- [x] Filtros: sede (por defecto la del selector global), servicio, estado, rango de fechas, búsqueda por código/nombre/teléfono/email (`pg_trgm`).
- [x] `DataTable` paginada en servidor (`range()` de Supabase): código, fecha/hora (zona de la sede), cliente, teléfono (clic → `tel:` / WhatsApp), servicio, sede, total, estado (badge de color), origen (web/admin).
- [x] Acciones en fila y masivas: confirmar, cancelar (motivo), completar, no asistió.
- [x] **Tiempo real**: suscripción Supabase Realtime a `bookings` del `company_id` → toast "Nueva reserva K7M2‑9QXA" + sonido opcional + contador en el menú lateral.
- [x] Exportar CSV del filtro actual (generado en el cliente).

### 2. Detalle de reserva (panel lateral `Sheet` y ruta `/admin/reservas/:id`)
- [x] Cabecera: código, estado, botones de transición permitidos.
- [x] Bloques: cliente (con enlaces de contacto y "otras reservas de este cliente"), servicio y horario, productos y totales, información adicional (`DynamicFields readOnly`), notas del cliente, **notas internas** (editables), historial (`booking_events` en línea de tiempo).
- [x] **Reprogramar**: selector de fecha/hora usando el motor de disponibilidad (excluyendo la propia reserva del conteo) con opción "Forzar fuera de disponibilidad" solo para owner/admin. RPC `reschedule_booking`.
- [x] **Editar**: datos del cliente, productos (recalcula totales con los precios congelados de la reserva salvo que se elija "recalcular con precios actuales"), respuestas.
- [x] Mensaje rápido por WhatsApp al cliente con plantillas ("Tu reserva {code} está confirmada para {fecha}") — enlace `wa.me`, sin costo.

### 3. Reserva manual `/admin/reservas/nueva`
- [x] Reutiliza los pasos del asistente público en modo admin (sin Turnstile), con buscador de cliente existente por teléfono/nombre, `source = 'admin'`, `created_by`. RPC `create_booking_admin` (security invoker + validaciones de rol) o la misma lógica de `create_booking` parametrizada.

### 4. Integración con el calendario (fase 08)
- [x] La capa *Reservas* abre este detalle al hacer clic; arrastrar una reserva en el calendario = reprogramar (con confirmación y validación de cupo).
- [x] Vista *Agenda del día* imprimible (`/admin/reservas/agenda?date=`), con estilos `@media print`.

### 5. Clientes `/admin/clientes`
- [x] Lista de `customers` con nº de reservas, última visita, total gastado; detalle con historial. Editar nombre/email/notas.

## Criterios de aceptación

- [x] Una reserva creada desde el sitio público aparece en la bandeja sin recargar.
- [x] Confirmar, cancelar, completar y no asistió respetan la máquina de estados y quedan en el historial con el usuario que lo hizo.
- [x] Reprogramar a un horario lleno falla salvo "forzar" por owner/admin.
- [x] Un staff asignado a la sede A no ve ni puede modificar reservas de la sede B (verificado contra RLS, no solo UI).
- [x] Exportar CSV respeta los filtros.

## Notas de ejecución

- **Escritura solo por RPC (D29).** `authenticated` ya no inserta ni actualiza `bookings` (salvo `internal_notes`) ni escribe `booking_items`, `booking_answers` o `booking_events`. Toda gestión pasa por funciones `security definer` que comprueban `can_access_branch` (staff: solo sus sedes) y escriben el historial con `auth.uid()`:
  - `change_booking_status(id, to, motivo)` con la máquina de estados (`booking_transition_allowed`; error `SV006`). Cancelar devuelve el stock.
  - `reschedule_booking(id, inicio, capacidad, forzar)`: conserva duración y buffers, no cuenta la propia reserva y usa el mismo `pg_advisory_xact_lock` que `create_booking`. Forzar exige owner/admin.
  - `update_booking_admin(id, payload)`: cliente, productos (precio congelado salvo `reprice`; un producto nuevo toma el actual), respuestas (`validate_booking_answers`) y ajuste de stock. Solo se envía lo que cambió.
  - `create_booking_admin(payload)`: misma lógica que la web (`create_booking_core`, ahora compartida por `create_booking`), `source = 'admin'`, `created_by`, estado inicial confirmada o pendiente, sin Turnstile y sin exigir correo.
  - `booking_history(id)`: historial con el correo de quien hizo cada cambio.
- **Cupos en el panel.** `admin_slot_inputs` (= `get_slot_inputs` con acceso por sede y `p_exclude`) alimenta el mismo motor (D26) en el navegador, sin antelación mínima y hasta un año. Como esa capacidad viene del navegador, la BD la acota con `booking_capacity_cap` (la mayor configurada para la sede y el servicio). Tras cada cambio el panel llama `POST /api/admin/slots-changed` y el sitio público deja de ofrecer o vuelve a ofrecer el horario al instante.
- **Bandeja.** Pestañas, filtros, página y reserva abierta viven en la URL (`?tab=&sede=&servicio=&estado=&desde=&hasta=&q=&p=&b=`). La búsqueda (`searchFilter` en `@shared/booking-admin`) quita la sintaxis de PostgREST antes de armar el `or`, con índices `pg_trgm` en nombre y teléfono. Las acciones masivas muestran solo las transiciones comunes a todas las seleccionadas. El CSV se genera en el navegador (RFC 4180, BOM para Excel, protección contra fórmulas, hasta 5.000 filas).
- **Tiempo real.** `bookings` está en la publicación `supabase_realtime`; Realtime aplica RLS, así que staff solo recibe sus sedes. Una reserva web nueva muestra el aviso «Nueva reserva K7M2-9QXA» con «Ver» y, si se activa en la bandeja, suena (Web Audio, sin archivos). El contador de pendientes está en el menú lateral y en la pestaña.
- **Detalle.** Panel lateral en la bandeja y en el calendario, y página `/admin/reservas/:id`. Las respuestas se muestran con `formatAnswer` (lectura) y se editan con `DynamicFields`. WhatsApp con plantillas (confirmación, recordatorio, cambio de horario, cancelación) por `wa.me`.
- **Calendario.** Clic en una reserva abre el detalle; arrastrarla abre una confirmación que comprueba el cupo y ofrece forzar a owner/admin. La agenda del día (`/admin/reservas/agenda?date=`) oculta el menú y la cabecera al imprimir.
- **Clientes.** Vista `customer_stats` (`security_invoker`): staff solo cuenta las reservas de sus sedes. El teléfono identifica al cliente: se cambia editando una reserva.
- **Pruebas.** pgTAP `fase11_booking_management.test.sql` (48), unitarias `src/shared/fase11.test.ts` y E2E `e2e/fase11.spec.ts` (5: tiempo real con historial y reprogramar, CSV, reserva manual, aislamiento de staff y arrastre en el calendario).
