# Fase 05 — Empresa, sedes y contenido

## Objetivo

Que la empresa configure desde `/admin` su perfil y marca, el footer, sus sedes (con independencia de disponibilidad y catálogo), la sección *Acerca de* (general y por sede), patrocinadores por sede y redes sociales por sede, cada uno con control de visibilidad para los clientes.

## Prerrequisitos

Fase 03. Tablas: `companies`, `branches`, `about_sections`, `sponsors`, `social_links`; bucket `media`.

## Tareas

### 1. Subida de imágenes (componente reutilizable)
- [x] `ImageUploader` (`src/client/components/media/`): arrastrar/soltar o seleccionar, recorte opcional (`react-easy-crop`) con relación de aspecto configurable (logo 1:1, portada 16:9, patrocinador libre), compresión en el navegador con `browser-image-compression` → WebP calidad 0.82, máx. 1600 px; miniatura 400 px.
- [x] Ruta `{company_id}/{entidad}/{uuid}.webp`; al reemplazar, borrar el archivo anterior.
- [x] Mostrar uso de almacenamiento de la empresa (RPC `company_storage_usage`) y bloquear al superar la cuota blanda.
- [x] Helper `mediaUrl(path, variant?)` → `{SUPABASE_URL}/storage/v1/object/public/media/{path}` (URL directa, ver `00` D14). Las subidas usan nombre con hash de contenido y `cacheControl: '31536000'`.
- [x] Validar tipo MIME y tamaño antes de subir; mensajes de error claros.

### 2. Perfil de empresa — `/admin/configuracion/empresa`
- [x] Datos: nombre, razón social, NIT/ID, email, teléfono, WhatsApp, zona horaria (combo IANA con búsqueda), moneda, locale.
- [x] Marca: logo, favicon, imagen hero, color primario y secundario (selector + previsualización en vivo de botón/encabezado y alerta si el contraste no cumple AA).
- [x] SEO: título, descripción, imagen para compartir.
- [x] Tras guardar, invalidar cache del tenant en el Worker (`POST /api/admin/purge-tenant` que borra la clave de Cache API) para que el sitio público lo refleje en segundos.

### 3. Footer — `/admin/contenido/footer`
- [x] Texto libre (Markdown limitado: negrita, enlaces), dirección, enlaces personalizados (lista ordenable), interruptores "Mostrar redes sociales" y "Mostrar ‘Hecho con Servigo’".
- [x] Vista previa en vivo del footer.

### 4. Sedes — `/admin/sedes`
- [x] Lista con tarjeta por sede (imagen, nombre, ciudad, estado), reordenable por arrastre (`@dnd-kit`), activar/inactivar.
- [x] Formulario: nombre, slug (autogenerado y editable, único en la empresa), dirección, ciudad, teléfono, WhatsApp, email, enlace de Google Maps, zona horaria (por defecto la de la empresa).
- [x] Imágenes: **imagen de portada** (la que se muestra en el selector de sedes del inicio) y **encabezado** (título, subtítulo, imagen, opacidad del overlay) con vista previa.
- [x] Interruptores:
  - **Disponibilidad propia** (`own_availability`): explicación "Si está apagado, esta sede usa el horario general de la empresa".
  - **Catálogo propio** (`own_catalog`): "Si está apagado, se ofrecen todos los servicios y productos activos". Al encenderlo por primera vez, copiar todos los ítems activos a `branch_catalog_items` para partir de algo.
- [x] No permitir inactivar la última sede activa. No permitir borrar sedes con reservas (solo inactivar).

### 5. Acerca de — `/admin/contenido/acerca`
- [x] Pestaña **General**: título, cuerpo (editor Markdown simple con vista previa, p. ej. `@uiw/react-md-editor` o textarea + `react-markdown` con `rehype-sanitize`), imagen, interruptor **Visible para clientes**.
- [x] Pestaña por **sede**: mismo formulario, independiente, con su propio interruptor de visibilidad.
- [ ] Si nada es visible, el enlace "Acerca de" no aparece en el sitio público.

### 6. Patrocinadores — `/admin/contenido/patrocinadores`
- [x] Selector de sede (o "Aplicar a varias sedes" al crear: duplica el registro por sede).
- [x] Lista ordenable: imagen (logo), nombre, descripción, URL opcional, interruptor **Visible**.
- [x] Interruptor de sección por sede "Mostrar sección de patrocinadores" (guardado en `branches.header` o columna `show_sponsors` — añadir migración).

### 7. Redes sociales — `/admin/contenido/redes`
- [x] Nivel **empresa** (heredado por todas las sedes) y nivel **sede** (si una sede define las suyas, reemplazan a las de la empresa para esa sede — mostrar aviso explicativo).
- [x] Por enlace: red (`social_network` con icono), etiqueta, URL (validación por red: WhatsApp acepta número y lo convierte a `https://wa.me/57...`, email → `mailto:`, teléfono → `tel:`), visible, orden.

### 8. Configuración de reservas — `/admin/configuracion/reservas`
- [x] Editar `companies.booking_settings`: confirmación automática, anticipación mínima, días máximos hacia adelante, paso de los horarios, permitir cancelación del cliente y límite en horas, email obligatorio, texto de términos y condiciones.

## Criterios de aceptación

- [x] Cambiar color primario y logo se refleja en admin y en el sitio público tras guardar.
- [x] Crear 2 sedes con portada distinta; ambas aparecen ordenadas según el arrastre.
- [ ] Una sede con *Acerca de* oculto no lo muestra; la general visible sí.
- [ ] Patrocinadores y redes respetan la visibilidad y la herencia empresa → sede.
- [x] Ninguna imagen subida supera 400 KB; se borran los archivos reemplazados.
- [x] Un usuario `staff` no ve estos menús y RLS rechaza sus escrituras (prueba manual + pgTAP existente).

## Notas de ejecución

- **Imágenes** (`src/client/lib/media.ts`, `components/media/ImageUploader.tsx`, D22):
  - **Proceso.** Se recorta con `react-easy-crop` y se comprime con `browser-image-compression` a WebP: calidad 0.82, que baja si hace falta hasta quedar en 400 KB o menos, y 1600 px de lado mayor. Se genera además una miniatura `.thumb.webp` de 400 px.
  - **Entrada.** Solo se aceptan JPG, PNG y WebP, de hasta 15 MB antes de comprimir. Todo se convierte a WebP; el SVG queda fuera porque no se puede rasterizar de forma fiable.
  - **Ruta.** `{company}/{entidad}/{uuid}-{hash12}.webp`, con `cacheControl` de 1 año.
  - **Archivos viejos.** Se borran tras guardar el formulario (`cleanupReplaced`), no al elegir la imagen nueva, para que el sitio no quede sin imagen si el usuario cancela. Las subidas de un formulario cancelado quedan huérfanas: solo ocupan cuota.
  - **Cuota.** Uso con `company_storage_usage`; las subidas se bloquean al llegar a 100 MB.
- **Patrocinadores en varias sedes.** Cada copia recibe su propio archivo (`storage.copy`), así borrar o reemplazar la imagen en una sede no rompe las demás.
- **Migración `branches_content_rules`:**
  - `branches.show_sponsors`.
  - Triggers: al menos una sede activa por empresa; no borrar sedes con reservas, salvo cuando se borra la empresa entera en cascada; copiar los ítems activos a `branch_catalog_items` al encender «Catálogo propio» por primera vez.
  - RPC `reorder_rows(tabla, ids)`: atómica, con los permisos del usuario (RLS). Si alguna fila no se puede mover, falla entera con 42501.
  - pgTAP: 13 asserts nuevos, 199 en total.
- **Purga de la caché.** `POST /api/admin/purge-tenant` (solo owner y admin, comprobado con `has_company_role`) borra la caché del tenant y devuelve la empresa recién leída. El panel la aplica sin recargar: el `TenantProvider` ahora se puede actualizar y reaplica la marca y el favicon. Solo purgan los cambios que ve el Worker (perfil, marca, SEO); footer y reservas no purgan.
- **Contraste.** Con texto blanco o casi negro, cualquier color primario supera 4.5:1 en los botones. El aviso AA se basa en el riesgo real: el primario sobre el fondo blanco del sitio (enlaces, títulos, bordes). Avisa si no llega a 3:1.
- **Íconos de redes.** `simple-icons` (CC0). LinkedIn ya no está en ese paquete, así que usa un ícono genérico. `lucide-react` 1.x no trae logos de marcas.
- **Markdown.** `react-markdown` con `rehype-sanitize`, sin HTML. El footer solo admite negrita, cursiva y enlaces; Acerca de añade títulos, listas y citas.
- **Pendiente para la fase 09** (sitio público con `get_public_site`): mostrar u ocultar el enlace «Acerca de» según la visibilidad, y la herencia empresa → sede de redes y patrocinadores. El modelo y la administración ya lo soportan, pero la página pública aún no lee ese contenido. Por eso quedan abiertos la tarea §5.3 y los criterios 3 y 4.
- **Verificación:**
  - Vitest 74/74, pgTAP 199/199.
  - E2E: 12/12 (6 de la fase 05, en serie porque comprimir imágenes en paralelo satura el servidor de desarrollo). Las pruebas son repetibles.
  - Capturas en escritorio y en móvil oscuro, sin errores de consola ni desborde horizontal.
  - El bundle público no incluye las librerías nuevas.
