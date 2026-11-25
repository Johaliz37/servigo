# Fase 07 — Información adicional (formularios dinámicos)

## Objetivo

Que la empresa defina campos de "información adicional" que el cliente debe diligenciar al reservar, **generales** (todas las reservas) o **por servicio**, eligiendo cómo se pide cada dato: texto libre, lista de ítems, check o lista de opciones. Incluye el renderizador y el validador compartidos que usarán la reserva (fase 10) y la gestión de reservas (fase 11).

## Prerrequisitos

Fase 06. Tabla `booking_fields` (ver fase 02 §2.4).

## Tipos de campo

| Tipo UI (español) | `field_type` | Control | Valor guardado (`jsonb`) |
|-------------------|--------------|---------|--------------------------|
| Texto corto | `text` | `Input` | `"string"` |
| Texto libre (párrafo) | `textarea` | `Textarea` | `"string"` |
| Lista de ítems (una opción) | `select` | `Select` desplegable | `"value"` |
| Lista de ítems (varias) | `multiselect` | Checkboxes / combobox múltiple | `["v1","v2"]` |
| Lista de opciones | `radio` | `RadioGroup` | `"value"` |
| Check (sí/no, acepto) | `checkbox` | `Checkbox` | `true/false` |
| Número | `number` | `Input type=number` | `123` |
| Fecha | `date` | `Calendar` popover | `"YYYY-MM-DD"` |

## Tareas

### 1. Esquema y validación compartida (`src/shared/booking-fields.ts`)
- [x] Tipos TS de `BookingField` y `FieldAnswer`.
- [x] `buildAnswersSchema(fields): z.ZodObject` → genera el esquema Zod dinámico: requerido, longitudes, min/max, `pattern`, opciones válidas (rechazar valores que no estén en `options`), checkbox requerido = debe ser `true`.
- [x] `fieldsForService(allFields, serviceId)` → generales + del servicio, solo activos, ordenados (generales primero, luego los del servicio, cada grupo por `sort_order`).
- [x] Tests unitarios por tipo de campo.

### 2. Administración — `/admin/formularios`
- [x] Dos áreas: **Campos generales** y **Campos por servicio** (selector de servicio a la izquierda, al estilo de un constructor de formularios).
- [x] Constructor:
  - Botón "Añadir campo" → elegir tipo (tarjetas con icono y descripción).
  - Por campo: etiqueta, texto de ayuda, placeholder, obligatorio, activo, validaciones según tipo; para `select`/`multiselect`/`radio`: editor de opciones (añadir, renombrar, reordenar, eliminar; `value` autogenerado estable a partir del label al crear y **no** cambia al renombrar).
  - Reordenar campos por arrastre (`@dnd-kit`).
  - Duplicar campo; copiar campos de otro servicio.
- [x] Panel de **vista previa** en vivo usando el mismo `DynamicFields` del sitio público.
- [x] Eliminar un campo con respuestas existentes → solo se inactiva (las respuestas guardan snapshot de `label` y `type`).
- [x] Atajo desde la ficha del servicio (fase 06): pestaña "Información adicional" con enlace/embebido del constructor filtrado por ese servicio.

### 3. Renderizador (`src/client/features/booking/DynamicFields.tsx`)
- [x] Recibe `fields` y se integra con `react-hook-form` (`useFormContext`), con `aria-describedby` para ayuda y errores, `required` marcado visualmente.
- [x] Modo `readOnly` para mostrar respuestas en la confirmación y en el detalle de reserva (fase 11), formateando cada tipo (checkbox → "Sí/No", multiselect → lista).

## Criterios de aceptación

- [x] Crear 2 campos generales (texto, checkbox "Acepto políticas" obligatorio) y 2 del servicio "Masaje" (lista de opciones "Presión: suave/media/fuerte", lista de ítems "Zonas", varias). La vista previa los muestra en ese orden.
- [x] `buildAnswersSchema` rechaza: checkbox obligatorio sin marcar, opción inexistente, texto que excede `maxLength`.
- [x] Renombrar una opción no rompe respuestas ya guardadas.
- [x] Un servicio sin campos propios muestra solo los generales.

## Notas de ejecución

- **Módulo compartido** (`src/shared/booking-fields.ts`): tipos, `buildAnswersSchema`, `fieldsForService`, `defaultAnswers`, `toAnswerRows` (filas para `booking_answers`, con copia de `label` y `type`, sin respuestas vacías) y `formatAnswer`. También incluye el esquema del editor de campos y la conversión editor ↔ fila.
  - **Respuestas opcionales vacías:** quedan `undefined` y no se guardan.
  - **Checkbox:** siempre se guarda (`true` o `false`); si es obligatorio, debe ser `true`.
  - **Topes de texto:** se aplican aunque la empresa no ponga máximo: 500 caracteres en texto corto y 5000 en texto libre.
  - **Número:** acepta coma decimal.
  - **Fecha:** formato `YYYY-MM-DD` y debe ser una fecha real (se rechaza el 29/02 de un año no bisiesto).
  - **Patrón:** debe cubrir todo el valor (`^(?:…)$`) y puede llevar un mensaje propio. Es opcional y para usuarios avanzados.
  - 28 tests unitarios (151 en total).
- **Opciones con `value` estable:**
  - Se genera del texto al crear la opción: `slugify`, y si ya existe se añade `-2`, `-3`…
  - No cambia al renombrar; el editor muestra «Valor guardado».
  - Las respuestas guardan el `value`, y `formatAnswer` busca el texto actual. Si la opción se borró, muestra el `value` guardado.
- **Migración `booking_fields_rules`:**
  - Trigger `booking_fields_validate`, que exige la forma del jsonb:
    - opciones solo en listas, únicas, con valor `[a-z0-9-]` y texto de 1 a 100 caracteres, máximo 50;
    - `validation` solo con las claves del tipo y valores numéricos;
    - el mínimo no puede superar al máximo.
  - Un campo con respuestas no se borra: se inactiva.
  - `reorder_rows` incluye `booking_fields`.
  - pgTAP: 12 asserts nuevos (239 en total). El seed pasa las reglas.
- **Constructor (`/admin/formularios`):**
  - **Grupos:** a la izquierda, «Campos generales» y la lista de servicios con su conteo; en móvil es un selector. El grupo elegido va en la URL (`?servicio=`), y de ahí sale el atajo desde la ficha del servicio.
  - **Crear y editar:** el tipo se elige en tarjetas y no cambia después, para no romper las respuestas. Cada campo se edita en un panel lateral.
  - **Acciones por campo:** arrastrar para ordenar, interruptor de activo, duplicar y eliminar (o inactivar si ya tiene respuestas). También se pueden copiar los campos activos de otro grupo.
  - **Vista previa:** usa el mismo `DynamicFields` que el sitio, con «Probar validación».
- **Renderizador** (`src/client/features/booking/DynamicFields.tsx`):
  - `DynamicFields` trabaja con `useFormContext`, con las respuestas en `answers.<id>`. Los obligatorios llevan asterisco y «(obligatorio)» para lectores de pantalla; la ayuda y los errores se enlazan con `aria-describedby`.
  - Los select opcionales tienen la opción «Sin respuesta».
  - La fecha se elige en un calendario emergente.
  - El modo lectura es `AnswersView` (confirmación de la reserva y detalle en la fase 11).
- **Ficha del servicio:** nueva pestaña «Información adicional» con los campos que se piden al reservarlo (generales y propios) y un enlace al constructor ya filtrado por ese servicio.
- `react-day-picker` se añadió a `optimizeDeps`: Vite lo descubría al navegar y recargaba la página.
- **Verificación:**
  - Vitest 151/151, pgTAP 239/239 tras `db reset`, `db lint` sin errores.
  - E2E 17/17 (2 nuevas, repetibles).
  - Capturas en escritorio y en móvil oscuro, sin errores de consola ni desborde horizontal.
