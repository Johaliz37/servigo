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
- [ ] Pestañas rápidas: **Hoy · Próximas · Pendientes (n) · Pasadas · Canceladas · Todas**.
- [ ] Filtros: sede (por defecto la del selector global), servicio, estado, rango de fechas, búsqueda por código/nombre/teléfono/email (`pg_trgm`).
- [ ] `DataTable` paginada en servidor (`range()` de Supabase): código, fecha/hora (zona de la sede), cliente, teléfono (clic → `tel:` / WhatsApp), servicio, sede, total, estado (badge de color), origen (web/admin).
- [ ] Acciones en fila y masivas: confirmar, cancelar (motivo), completar, no asistió.
- [ ] **Tiempo real**: suscripción Supabase Realtime a `bookings` del `company_id` → toast "Nueva reserva K7M2‑9QXA" + sonido opcional + contador en el menú lateral.
- [ ] Exportar CSV del filtro actual (generado en el cliente).

### 2. Detalle de reserva (panel lateral `Sheet` y ruta `/admin/reservas/:id`)
- [ ] Cabecera: código, estado, botones de transición permitidos.
- [ ] Bloques: cliente (con enlaces de contacto y "otras reservas de este cliente"), servicio y horario, productos y totales, información adicional (`DynamicFields readOnly`), notas del cliente, **notas internas** (editables), historial (`booking_events` en línea de tiempo).
- [ ] **Reprogramar**: selector de fecha/hora usando el motor de disponibilidad (excluyendo la propia reserva del conteo) con opción "Forzar fuera de disponibilidad" solo para owner/admin. RPC `reschedule_booking`.
- [ ] **Editar**: datos del cliente, productos (recalcula totales con los precios congelados de la reserva salvo que se elija "recalcular con precios actuales"), respuestas.
- [ ] Mensaje rápido por WhatsApp al cliente con plantillas ("Tu reserva {code} está confirmada para {fecha}") — enlace `wa.me`, sin costo.

### 3. Reserva manual `/admin/reservas/nueva`
- [ ] Reutiliza los pasos del asistente público en modo admin (sin Turnstile), con buscador de cliente existente por teléfono/nombre, `source = 'admin'`, `created_by`. RPC `create_booking_admin` (security invoker + validaciones de rol) o la misma lógica de `create_booking` parametrizada.

### 4. Integración con el calendario (fase 08)
- [ ] La capa *Reservas* abre este detalle al hacer clic; arrastrar una reserva en el calendario = reprogramar (con confirmación y validación de cupo).
- [ ] Vista *Agenda del día* imprimible (`/admin/reservas/agenda?date=`), con estilos `@media print`.

### 5. Clientes `/admin/clientes`
- [ ] Lista de `customers` con nº de reservas, última visita, total gastado; detalle con historial. Editar nombre/email/notas.

## Criterios de aceptación

- [ ] Una reserva creada desde el sitio público aparece en la bandeja sin recargar.
- [ ] Confirmar, cancelar, completar y no asistió respetan la máquina de estados y quedan en el historial con el usuario que lo hizo.
- [ ] Reprogramar a un horario lleno falla salvo "forzar" por owner/admin.
- [ ] Un staff asignado a la sede A no ve ni puede modificar reservas de la sede B (verificado contra RLS, no solo UI).
- [ ] Exportar CSV respeta los filtros.
