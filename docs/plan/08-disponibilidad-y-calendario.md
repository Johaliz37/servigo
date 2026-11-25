# Fase 08 — Disponibilidad y calendario (estilo Google Calendar)

## Objetivo

1. Un calendario en `/admin/calendario` que se vea y se comporte como Google Calendar, para configurar por sede (o a nivel empresa) **ventanas de atención** y **ventanas de no disponibilidad**, con recurrencias, y que además muestre las reservas.
2. El **motor de disponibilidad** (`src/shared/availability.ts`) que, a partir de esas ventanas, la configuración de reservas, la duración/capacidad del servicio y las reservas existentes, calcula los horarios reservables.

## Prerrequisitos

Fase 06. Tablas: `availability_events`, `branches` (`own_availability`, `timezone`), `catalog_items`, `bookings`, `companies.booking_settings`.

## Parte A — Calendario de administración

### Librería
FullCalendar v6 estándar (MIT): `@fullcalendar/react`, `daygrid`, `timegrid`, `list`, `interaction`, `rrule`, locale `es`. **Prohibido** usar plugins premium. Cargado con `React.lazy` solo en esta ruta.

### Réplica de diseño de Google Calendar
- [x] **Barra superior**: botón "Hoy", flechas ‹ ›, título del rango ("noviembre de 2026"), selector de vista (Día · Semana · Mes · Agenda) como `Select` a la derecha, selector de **sede** (y opción "Horario general de la empresa").
- [x] **Panel izquierdo** (colapsable): botón "+ Crear" con sombra redondeada, **mini‑calendario** de mes (shadcn `Calendar`) que navega el principal, lista "Mis calendarios" con checkboxes de capas y su color: *Atención* (verde), *No disponible* (gris rayado/rojo), *Reservas* (color primario de la empresa), y filtro por servicio.
- [x] **Rejilla**: líneas de hora tenues, columna de horas a la izquierda, encabezados de día con número grande en círculo para "hoy", **línea roja de hora actual** (`nowIndicator`), franja de "todo el día" arriba, eventos con esquinas redondeadas, texto blanco, hora + título; eventos superpuestos lado a lado.
- [x] Tipografía y espaciado limpios (fondo blanco, bordes `#dadce0`‑like vía tokens), responsive: en móvil vista por defecto Día/Agenda y panel izquierdo en `Sheet`.
- [x] Atajos de teclado como Google: `t` hoy, `d` día, `w` semana, `m` mes, `a` agenda, `c` crear, `j/k` siguiente/anterior, `Esc` cerrar.

### Interacciones
- [x] **Seleccionar arrastrando** en la rejilla → popover rápido (como Google) con título, tipo (Atención / No disponible), horas y botón "Más opciones" que abre el diálogo completo.
- [x] **Clic en evento** → popover de detalle con acciones Editar, Duplicar, Eliminar.
- [x] **Arrastrar** para mover y **estirar** el borde inferior para cambiar duración (`editable`, `eventResizableFromStart: false`).
- [x] **Diálogo completo** del evento:
  - Tipo, título, notas, color, todo el día, fecha/hora inicio y fin (en zona de la sede).
  - **Repetir**: "No se repite · Cada día · Cada semana el {día} · Cada mes el {n} · Cada año · Todos los días laborables (lun–vie) · Personalizado…". Personalizado: cada N días/semanas/meses, días de la semana (chips L M X J V S D), termina: nunca / el {fecha} / tras N veces. Se traduce a RRULE con `rrule` y se muestra el texto legible (`rrule.toText()` traducido al español).
  - Aplica a servicios: todos o selección (`service_ids`).
  - Capacidad en esta ventana (opcional).
- [x] **Editar/borrar un evento recurrente** → diálogo idéntico al de Google: *"Este evento" · "Este y los siguientes" · "Todos los eventos"*:
  - Este evento: crea excepción (`exdates` + evento hijo con `recurrence_parent_id`) o solo `exdates` al borrar.
  - Este y los siguientes: corta la serie original con `UNTIL` y crea una serie nueva desde la ocurrencia.
  - Todos: modifica la serie.
- [x] **Deshacer** (toast "Evento eliminado · Deshacer" durante 5 s).
- [x] **Capa Reservas**: muestra las reservas (solo lectura aquí, clic → abre detalle de la fase 11 si existe; si no, popover básico) con nombre del cliente y servicio.
- [x] **Vista previa de disponibilidad**: toggle "Mostrar horarios reservables" que pinta como *background events* los slots calculados por el motor para el servicio filtrado — permite a la empresa verificar su configuración.
- [x] Plantillas rápidas: "Horario de oficina L–V 8:00–18:00", "Sábados 9:00–13:00", "Almuerzo diario 12:00–13:00 (no disponible)", "Festivo (todo el día, no disponible)". Importar festivos de Colombia del año (lista estática en `src/shared/holidays/co.ts`, gratis, sin API).
- [x] Si la sede tiene `own_availability = false`, mostrar banner "Esta sede usa el horario general de la empresa" con botón "Ver horario general" / "Activar horario propio" (al activarlo ofrecer copiar los eventos generales).
- [x] Persistencia: hooks `useAvailabilityEvents(branchId|null, range)` y mutaciones optimistas con TanStack Query; staff solo ve/edita sedes asignadas.

## Parte B — Motor de disponibilidad (`src/shared/availability.ts`)

TS puro, sin dependencias de navegador ni Worker (solo `rrule` y `@date-fns/tz`). Usado por: vista previa del calendario, Worker (`/api/public/slots`) y validación de `create`.

### Entrada
```ts
type SlotQuery = {
  timezone: string;               // de la sede
  range: { from: Date; to: Date };// máx. 31 días
  service: { id; durationMinutes; bufferBefore; bufferAfter; capacity };
  events: AvailabilityEvent[];    // de la sede o de la empresa según own_availability
  bookings: { blockStart: Date; blockEnd: Date; serviceId: string; status }[];
  settings: { slotStepMinutes; minLeadMinutes; maxDaysAhead };
  now: Date;
};
```

### Algoritmo
1. Expandir ocurrencias de cada evento en el rango (`rrule` con `tzid` = zona del evento; aplicar `exdates`; reemplazar por hijos modificados).
2. Filtrar por `service_ids` (null o contiene el servicio).
3. Unir intervalos `open`; restar intervalos `closed` (todo el día = 00:00–24:00 de la zona de la sede).
4. Dentro de cada intervalo libre generar candidatos cada `slotStepMinutes` alineados a la hora local; un candidato es válido si `[start - bufferBefore, start + duration + bufferAfter]` cabe completo dentro del intervalo abierto.
5. Descartar candidatos con `start < now + minLeadMinutes` o `start > now + maxDaysAhead`.
6. Ocupación: contar reservas con estado `pending|confirmed` del **mismo servicio** que se solapan con el bloque; disponible si `count < (capacity_override ?? capacity)`.
7. Salida: `{ date: 'YYYY-MM-DD', slots: [{ start: ISO, end: ISO, remaining }] }[]` en orden.

### Casos borde (con test cada uno)
- [x] Cambio de horario de verano (usar zona `America/Santiago` o `Europe/Madrid` en tests aunque Colombia no tenga DST).
- [x] Evento que cruza medianoche.
- [x] `closed` que parte una ventana en dos.
- [x] Excepción de una ocurrencia y serie cortada ("este y los siguientes").
- [x] Capacidad 3 con 2 reservas → `remaining: 1`; reserva cancelada no cuenta.
- [x] Buffers impiden un slot pegado al cierre.
- [x] Rendimiento: 31 días, 20 eventos, 500 reservas < 5 ms en Node (presupuesto de CPU del Worker Free = 10 ms).

### Endpoint
- [x] `GET /api/public/slots?branch=&service=&from=&to=` en el Worker: obtiene datos con RPC `get_slot_inputs(branch, service, from, to)` (security definer, devuelve solo lo necesario: eventos, bloques de reservas sin datos personales, settings, servicio), ejecuta el motor, cachea 30 s por clave.

## Criterios de aceptación

- [x] Crear "L–V 8:00–17:00 cada semana" + "Almuerzo 12–13 no disponible" + festivo; la vista previa muestra slots correctos para un servicio de 45 min con paso 30 min.
- [x] Editar "solo este evento" un martes no afecta a los demás martes; "este y los siguientes" corta la serie.
- [x] Arrastrar y redimensionar persiste tras recargar.
- [x] Una sede con `own_availability=false` usa los eventos de nivel empresa en `/api/public/slots`.
- [x] Suite del motor pasa, incluidos los casos borde y el presupuesto de rendimiento.
- [ ] Revisión visual lado a lado con Google Calendar (captura en el PR). *Pendiente de la revisión del usuario: el agente no puede abrir Google Calendar con una cuenta.*

## Notas de ejecución

- **Motor (`src/shared/availability.ts`)**, decisión D26:
  - **Hora de pared:** las series se expanden en la hora local del evento. Una serie «9:00 cada lunes» sigue a las 9:00 tras un cambio de hora. Una hora inexistente avanza con el salto; una ambigua toma la primera.
  - **Expansión:** las reglas diarias y semanales (todas las que crea el calendario) usan una vía rápida propia, unas 50 veces más rápida que el iterador de `rrule`. Cualquier otra regla usa `rrule`. Una prueba compara las dos vías con 300 reglas aleatorias.
  - **Reglas ilegibles:** se ignoran sin romper el cálculo.
  - **Rendimiento:** 31 días, 20 eventos y 500 reservas en unos 2 ms (3 ms con cobertura). La prueba toma el mejor de 20 corridas.
  - **Capacidad:** la de la ventana `open` que contiene el bloque entero (la mayor si hay varias); si no, la del servicio.
  - **Pruebas:** 27 unitarias del motor y las recurrencias, más 8 de los planes del calendario.
- **Recurrencias (`src/shared/recurrence.ts`):**
  - Opciones de «Repetir» como Google, con un «Personalizado» que admite intervalo, días y final (nunca, fecha o número de veces).
  - El texto legible en español es propio, equivalente a `rrule.toText()`.
  - La RRULE se guarda sin `RRULE:` y con UNTIL en UTC.
- **Festivos (`src/shared/holidays/co.ts`):** se calculan para cualquier año (Ley Emiliani y Pascua) en lugar de una lista fija, así que no hay que actualizarla cada año. Una prueba los compara con los de 2026.
- **Migración `availability_slots`:**
  - Trigger `availability_events_validate`:
    - la RRULE debe ser de un FREQ admitido y formada por pares CLAVE=valor;
    - `service_ids` solo admite servicios, y una lista vacía cuenta como «todos»;
    - una excepción debe ser de una serie recurrente, de la misma sede y del mismo tipo;
    - un evento dura como máximo un año.
  - `get_slot_inputs`: security definer, solo para `service_role` (el Worker).
  - `apply_availability_plan`: security invoker (RLS); aplica en una transacción las altas, cambios y bajas del calendario.
  - pgTAP: 21 asserts nuevos, 260 en total.
- **Planes (`src/shared/calendar.ts`):**
  - **Este evento:** crea una excepción y añade la ocurrencia a `exdates`. Si cambia el tipo, la copia queda suelta.
  - **Este y los siguientes:** la serie termina con UNTIL justo antes de la ocurrencia y empieza una serie nueva, que descuenta COUNT. Las excepciones posteriores pasan a la serie nueva si la hora no cambió; si cambió, se borran, como en Google.
  - **Todos los eventos:** mover la serie un día gira BYDAY y desplaza `exdates` y excepciones.
  - **Deshacer:** aplica el plan inverso.
  - **Caché:** se actualiza en el mismo orden que la RPC.
- **Endpoint `GET /api/public/slots`:**
  - `from` y `to` son fechas locales de la sede, ambas incluidas, con un máximo de 31 días.
  - Valida que la sede sea de la empresa del subdominio.
  - Guarda la respuesta 30 s en la Cache API.
- **Calendario (`/admin/calendario`):**
  - FullCalendar 6.1 estándar en `timeZone: 'UTC'`, con las horas de pared de la sede. No usa el plugin `@fullcalendar/rrule`: el calendario muestra las ocurrencias de `expandEvents`, las mismas que usa el motor.
  - La sede elegida va en `?sede=` (`general` = horario de la empresa) y la fecha en `?fecha=`.
  - «Activar horario propio» ofrece copiar el horario general. Una sede con horario propio puede volver al general, y sus eventos se conservan.
  - El chunk de la ruta pesa 113 kB gzip (FullCalendar, `rrule` y el motor). El bundle público no cambia.
- **Verificación:**
  - Vitest 187/187 (4 de 4 corridas con cobertura).
  - pgTAP 260/260 tras `db reset`; `db lint` sin errores.
  - Worker 13/13.
  - E2E 19/19 (2 nuevas, repetibles: la prueba de UI deja la Sede Centro como estaba).
  - Capturas en escritorio y móvil, claro y oscuro, sin errores de consola ni desborde horizontal.
