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
- [ ] **Barra superior**: botón "Hoy", flechas ‹ ›, título del rango ("noviembre de 2026"), selector de vista (Día · Semana · Mes · Agenda) como `Select` a la derecha, selector de **sede** (y opción "Horario general de la empresa").
- [ ] **Panel izquierdo** (colapsable): botón "+ Crear" con sombra redondeada, **mini‑calendario** de mes (shadcn `Calendar`) que navega el principal, lista "Mis calendarios" con checkboxes de capas y su color: *Atención* (verde), *No disponible* (gris rayado/rojo), *Reservas* (color primario de la empresa), y filtro por servicio.
- [ ] **Rejilla**: líneas de hora tenues, columna de horas a la izquierda, encabezados de día con número grande en círculo para "hoy", **línea roja de hora actual** (`nowIndicator`), franja de "todo el día" arriba, eventos con esquinas redondeadas, texto blanco, hora + título; eventos superpuestos lado a lado.
- [ ] Tipografía y espaciado limpios (fondo blanco, bordes `#dadce0`‑like vía tokens), responsive: en móvil vista por defecto Día/Agenda y panel izquierdo en `Sheet`.
- [ ] Atajos de teclado como Google: `t` hoy, `d` día, `w` semana, `m` mes, `a` agenda, `c` crear, `j/k` siguiente/anterior, `Esc` cerrar.

### Interacciones
- [ ] **Seleccionar arrastrando** en la rejilla → popover rápido (como Google) con título, tipo (Atención / No disponible), horas y botón "Más opciones" que abre el diálogo completo.
- [ ] **Clic en evento** → popover de detalle con acciones Editar, Duplicar, Eliminar.
- [ ] **Arrastrar** para mover y **estirar** el borde inferior para cambiar duración (`editable`, `eventResizableFromStart: false`).
- [ ] **Diálogo completo** del evento:
  - Tipo, título, notas, color, todo el día, fecha/hora inicio y fin (en zona de la sede).
  - **Repetir**: "No se repite · Cada día · Cada semana el {día} · Cada mes el {n} · Cada año · Todos los días laborables (lun–vie) · Personalizado…". Personalizado: cada N días/semanas/meses, días de la semana (chips L M X J V S D), termina: nunca / el {fecha} / tras N veces. Se traduce a RRULE con `rrule` y se muestra el texto legible (`rrule.toText()` traducido al español).
  - Aplica a servicios: todos o selección (`service_ids`).
  - Capacidad en esta ventana (opcional).
- [ ] **Editar/borrar un evento recurrente** → diálogo idéntico al de Google: *"Este evento" · "Este y los siguientes" · "Todos los eventos"*:
  - Este evento: crea excepción (`exdates` + evento hijo con `recurrence_parent_id`) o solo `exdates` al borrar.
  - Este y los siguientes: corta la serie original con `UNTIL` y crea una serie nueva desde la ocurrencia.
  - Todos: modifica la serie.
- [ ] **Deshacer** (toast "Evento eliminado · Deshacer" durante 5 s).
- [ ] **Capa Reservas**: muestra las reservas (solo lectura aquí, clic → abre detalle de la fase 11 si existe; si no, popover básico) con nombre del cliente y servicio.
- [ ] **Vista previa de disponibilidad**: toggle "Mostrar horarios reservables" que pinta como *background events* los slots calculados por el motor para el servicio filtrado — permite a la empresa verificar su configuración.
- [ ] Plantillas rápidas: "Horario de oficina L–V 8:00–18:00", "Sábados 9:00–13:00", "Almuerzo diario 12:00–13:00 (no disponible)", "Festivo (todo el día, no disponible)". Importar festivos de Colombia del año (lista estática en `src/shared/holidays/co.ts`, gratis, sin API).
- [ ] Si la sede tiene `own_availability = false`, mostrar banner "Esta sede usa el horario general de la empresa" con botón "Ver horario general" / "Activar horario propio" (al activarlo ofrecer copiar los eventos generales).
- [ ] Persistencia: hooks `useAvailabilityEvents(branchId|null, range)` y mutaciones optimistas con TanStack Query; staff solo ve/edita sedes asignadas.

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
- [ ] Cambio de horario de verano (usar zona `America/Santiago` o `Europe/Madrid` en tests aunque Colombia no tenga DST).
- [ ] Evento que cruza medianoche.
- [ ] `closed` que parte una ventana en dos.
- [ ] Excepción de una ocurrencia y serie cortada ("este y los siguientes").
- [ ] Capacidad 3 con 2 reservas → `remaining: 1`; reserva cancelada no cuenta.
- [ ] Buffers impiden un slot pegado al cierre.
- [ ] Rendimiento: 31 días, 20 eventos, 500 reservas < 5 ms en Node (presupuesto de CPU del Worker Free = 10 ms).

### Endpoint
- [ ] `GET /api/public/slots?branch=&service=&from=&to=` en el Worker: obtiene datos con RPC `get_slot_inputs(branch, service, from, to)` (security definer, devuelve solo lo necesario: eventos, bloques de reservas sin datos personales, settings, servicio), ejecuta el motor, cachea 30 s por clave.

## Criterios de aceptación

- [ ] Crear "L–V 8:00–17:00 cada semana" + "Almuerzo 12–13 no disponible" + festivo; la vista previa muestra slots correctos para un servicio de 45 min con paso 30 min.
- [ ] Editar "solo este evento" un martes no afecta a los demás martes; "este y los siguientes" corta la serie.
- [ ] Arrastrar y redimensionar persiste tras recargar.
- [ ] Una sede con `own_availability=false` usa los eventos de nivel empresa en `/api/public/slots`.
- [ ] Suite del motor pasa, incluidos los casos borde y el presupuesto de rendimiento.
- [ ] Revisión visual lado a lado con Google Calendar (captura en el PR).
