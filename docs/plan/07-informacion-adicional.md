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
- [ ] Tipos TS de `BookingField` y `FieldAnswer`.
- [ ] `buildAnswersSchema(fields): z.ZodObject` → genera el esquema Zod dinámico: requerido, longitudes, min/max, `pattern`, opciones válidas (rechazar valores que no estén en `options`), checkbox requerido = debe ser `true`.
- [ ] `fieldsForService(allFields, serviceId)` → generales + del servicio, solo activos, ordenados (generales primero, luego los del servicio, cada grupo por `sort_order`).
- [ ] Tests unitarios por tipo de campo.

### 2. Administración — `/admin/formularios`
- [ ] Dos áreas: **Campos generales** y **Campos por servicio** (selector de servicio a la izquierda, al estilo de un constructor de formularios).
- [ ] Constructor:
  - Botón "Añadir campo" → elegir tipo (tarjetas con icono y descripción).
  - Por campo: etiqueta, texto de ayuda, placeholder, obligatorio, activo, validaciones según tipo; para `select`/`multiselect`/`radio`: editor de opciones (añadir, renombrar, reordenar, eliminar; `value` autogenerado estable a partir del label al crear y **no** cambia al renombrar).
  - Reordenar campos por arrastre (`@dnd-kit`).
  - Duplicar campo; copiar campos de otro servicio.
- [ ] Panel de **vista previa** en vivo usando el mismo `DynamicFields` del sitio público.
- [ ] Eliminar un campo con respuestas existentes → solo se inactiva (las respuestas guardan snapshot de `label` y `type`).
- [ ] Atajo desde la ficha del servicio (fase 06): pestaña "Información adicional" con enlace/embebido del constructor filtrado por ese servicio.

### 3. Renderizador (`src/client/features/booking/DynamicFields.tsx`)
- [ ] Recibe `fields` y se integra con `react-hook-form` (`useFormContext`), con `aria-describedby` para ayuda y errores, `required` marcado visualmente.
- [ ] Modo `readOnly` para mostrar respuestas en la confirmación y en el detalle de reserva (fase 11), formateando cada tipo (checkbox → "Sí/No", multiselect → lista).

## Criterios de aceptación

- [ ] Crear 2 campos generales (texto, checkbox "Acepto políticas" obligatorio) y 2 del servicio "Masaje" (lista de opciones "Presión: suave/media/fuerte", lista de ítems "Zonas", varias). La vista previa los muestra en ese orden.
- [ ] `buildAnswersSchema` rechaza: checkbox obligatorio sin marcar, opción inexistente, texto que excede `maxLength`.
- [ ] Renombrar una opción no rompe respuestas ya guardadas.
- [ ] Un servicio sin campos propios muestra solo los generales.
