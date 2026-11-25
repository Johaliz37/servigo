# Fase 10 — Flujo de reserva y consulta de reservas (cliente final)

## Objetivo

Que un cliente, sin iniciar sesión, reserve un servicio en una sede: elige servicio → fecha y hora → añade productos disponibles → llena sus datos (nombre, teléfono, email opcional) y la información adicional → confirma y recibe un **código**. Y que pueda **buscar** sus reservas por código o por teléfono/email.

## Prerrequisitos

Fases 07 (campos dinámicos), 08 (motor y `/api/public/slots`), 09 (portal y RPC públicas). Tablas `bookings`, `booking_items`, `booking_answers`, `booking_events`, `customers`.

## Tareas

### 1. Asistente de reserva `/s/:branchSlug/reservar/:serviceId?`
Pasos con barra de progreso, estado en la URL (`?step=&date=&slot=`) y en `sessionStorage` para no perder datos al recargar. Resumen lateral (escritorio) / inferior plegable (móvil) con servicio, fecha, add-ons y **total en vivo** (`pricing.ts`).

- [ ] **Paso 1 · Servicio** (se omite si viene en la URL): lista de servicios activos de la sede con precio y duración.
- [ ] **Paso 2 · Fecha y hora**: calendario de mes con días sin cupo deshabilitados (consulta `/api/public/slots` por mes), lista de horas como chips agrupados en Mañana / Tarde / Noche, "Quedan 2 cupos" cuando `remaining` es bajo. Horas en zona de la sede con aviso si el navegador está en otra zona.
- [ ] **Paso 3 · Productos** (se omite si no hay add-ons): tarjetas con foto, precio (con descuento), selector de cantidad hasta `max_quantity` y `stock`.
- [ ] **Paso 4 · Tus datos**: nombre (obligatorio), teléfono (obligatorio, `react-phone-number-input` con país por defecto de la empresa, normalizado E.164), email (opcional, obligatorio si `require_email`), notas; luego `DynamicFields` (generales + del servicio); casilla de términos si la empresa tiene `terms_text`.
- [ ] **Paso 5 · Confirmar**: resumen completo, widget **Turnstile** (invisible/managed), botón "Confirmar reserva" con estado de carga y doble clic bloqueado.
- [ ] Si el horario se ocupó entre tanto (`409 SLOT_TAKEN`), volver al paso 2 manteniendo el resto y mostrar mensaje.

### 2. Creación segura
- [ ] `POST /api/bookings` (Worker):
  1. Rate limit por IP.
  2. Verificar Turnstile (`https://challenges.cloudflare.com/turnstile/v0/siteverify`).
  3. Validar cuerpo con Zod (`src/shared/schemas/booking.ts`) + `buildAnswersSchema` con los campos reales del servicio.
  4. Obtener `get_slot_inputs` y validar con el motor que el slot existe.
  5. Llamar RPC `create_booking(payload)` con la secret key.
- [ ] RPC `create_booking` (security definer, solo `service_role`), en una transacción:
  - `pg_advisory_xact_lock(hashtext(branch_id || service_id))`.
  - Revalidar: empresa activa, sede activa, servicio en `effective_catalog`, add-ons permitidos (`service_products` + `allow_in_booking` + activo en sede), stock.
  - Contar reservas solapadas `pending|confirmed` → si `≥ capacidad` → `raise exception 'SLOT_TAKEN'`.
  - Calcular precios en SQL (descuentos vigentes a `now()`), generar `code` único (8 caracteres Crockford, reintento ante colisión), *upsert* de `customers` por `(company_id, phone)`.
  - Insertar `bookings` (estado `confirmed` si `auto_confirm`, si no `pending`), `booking_items`, `booking_answers` (con snapshot de label/tipo), `booking_events('created')`, descontar stock.
  - Devolver `{ code, status, starts_at, total }`.
- [ ] Respuesta del Worker: `201 { code }` → redirige a `/reserva/:code?t={token}` (token firmado HMAC con `code+phone`, validez 30 días, permite ver la reserva sin volver a escribir el teléfono).

### 3. Confirmación `/reserva/:code`
- [ ] Muestra código grande con botón copiar, estado (Pendiente/Confirmada), servicio, sede (dirección y mapa), fecha/hora, productos, total "a pagar en la sede", respuestas de información adicional.
- [ ] Botones: **Añadir a Google Calendar** (enlace `calendar.google.com/calendar/render?action=TEMPLATE...`), **Descargar .ics** (generado en el cliente), **Enviar por WhatsApp a la empresa** (`wa.me/{whatsapp}?text=Hola, mi reserva {code}...`), **Compartir**.
- [ ] Si se accede sin token, pedir teléfono o email para ver detalles (ver §4).
- [ ] (Opcional) Cancelar reserva si `allow_customer_cancel` y faltan más de `cancel_limit_hours` → `POST /api/bookings/:code/cancel` (Turnstile + token) → RPC `cancel_booking_public`.

### 4. Búsqueda `/mis-reservas`
- [ ] Pestañas: **Por código** (código + teléfono **o** email para verificar) y **Por contacto** (teléfono o email).
- [ ] `POST /api/bookings/lookup` (Turnstile + rate limit estricto 5/min/IP) → RPC `find_bookings(company_id, code?, phone?, email?)`:
  - Por código: requiere que el contacto coincida → devuelve detalle completo + token.
  - Por contacto: devuelve lista de reservas de esa empresa (próximas primero, últimos 12 meses) con datos **mínimos**: código, servicio, sede, fecha, estado, y el nombre **enmascarado** ("Ju*** Pé***"). Clic → detalle (emite token).
- [ ] Respuesta idéntica en tiempo y forma cuando no hay resultados (evita enumeración): "Si existen reservas con esos datos, aparecerán aquí".
- [ ] Solo devuelve reservas del tenant actual (aislamiento por `company_id` del Host).

### 5. Notificaciones (costo 0)
- [ ] Sin SMS ni WhatsApp API. La empresa ve la reserva al instante en admin (fase 11, con Supabase Realtime gratuito).
- [ ] (Opcional) Email de confirmación vía Resend Free si el cliente dio email y la empresa lo habilita; plantilla simple HTML. Si se activa, documentar el límite (100/día) y degradar sin error si se supera.

### 6. Pruebas
- [ ] Unit: esquemas Zod, generación de código, token HMAC, `.ics`.
- [ ] pgTAP: `create_booking` rechaza slot lleno, producto no permitido, servicio inactivo, sede de otra empresa; concurrencia (dos transacciones al mismo slot de capacidad 1 → una falla).
- [ ] E2E `booking.spec.ts`: reserva completa con 1 add-on y campos adicionales → código visible → buscar por teléfono → aparece.

## Criterios de aceptación

- [ ] Un cliente reserva desde el móvil en < 1 minuto sin cuenta y obtiene código.
- [ ] Imposible reservar un horario lleno, fuera de ventana, en el pasado o con productos no permitidos, aunque se manipule la petición.
- [ ] Búsqueda por código exige contacto coincidente; búsqueda por contacto no expone datos personales completos.
- [ ] El total mostrado al cliente coincide al centavo con el guardado en BD.
- [ ] La reserva aparece en el calendario y la bandeja de la empresa.

> **Heredado de la fase 06 (D24).** `create_booking` calcula los precios con `effective_catalog(sede, now())` y `effective_addons(servicio, sede, now())`, nunca con fórmulas propias. Así coincide con `bookingTotals` de `pricing.ts`:
> - el descuento de cada producto se aplica por unidad;
> - `products_total` es antes de descuentos;
> - `discount_total` suma servicio y productos.
>
> `effective_addons` ya filtra `allow_in_booking`, la disponibilidad en la sede y el stock, y limita la cantidad máxima al stock.

> **Heredado de la fase 07 (D25).**
> - El paso de información adicional usa `fieldsForService` + `DynamicFields` + `buildAnswersSchema`, y guarda con `toAnswerRows`.
> - `create_booking` debe revalidar las respuestas en SQL con las mismas reglas:
>   - obligatorios, y check obligatorio = `true`;
>   - opciones que existan;
>   - longitudes con los topes de 500 y 5000 caracteres;
>   - min y max;
>   - fecha real;
>   - patrón con `~` anclado.
> - Los patrones son expresiones regulares de JS. En SQL se evalúan con la sintaxis de Postgres: lo común (clases, cuantificadores, alternancia) coincide.
> - Lo que conviene probar con un caso de paridad, como en los precios: patrones con `\p{…}` (solo JS con `u`) o lookarounds.
