# Fase 05 — Empresa, sedes y contenido

## Objetivo

Que la empresa configure desde `/admin` su perfil y marca, el footer, sus sedes (con independencia de disponibilidad y catálogo), la sección *Acerca de* (general y por sede), patrocinadores por sede y redes sociales por sede, cada uno con control de visibilidad para los clientes.

## Prerrequisitos

Fase 03. Tablas: `companies`, `branches`, `about_sections`, `sponsors`, `social_links`; bucket `media`.

## Tareas

### 1. Subida de imágenes (componente reutilizable)
- [ ] `ImageUploader` (`src/client/components/media/`): arrastrar/soltar o seleccionar, recorte opcional (`react-easy-crop`) con relación de aspecto configurable (logo 1:1, portada 16:9, patrocinador libre), compresión en el navegador con `browser-image-compression` → WebP calidad 0.82, máx. 1600 px; miniatura 400 px.
- [ ] Ruta `{company_id}/{entidad}/{uuid}.webp`; al reemplazar, borrar el archivo anterior.
- [ ] Mostrar uso de almacenamiento de la empresa (RPC `company_storage_usage`) y bloquear al superar la cuota blanda.
- [ ] Helper `mediaUrl(path, variant?)` → `{SUPABASE_URL}/storage/v1/object/public/media/{path}` (URL directa, ver `00` D14). Las subidas usan nombre con hash de contenido y `cacheControl: '31536000'`.
- [ ] Validar tipo MIME y tamaño antes de subir; mensajes de error claros.

### 2. Perfil de empresa — `/admin/configuracion/empresa`
- [ ] Datos: nombre, razón social, NIT/ID, email, teléfono, WhatsApp, zona horaria (combo IANA con búsqueda), moneda, locale.
- [ ] Marca: logo, favicon, imagen hero, color primario y secundario (selector + previsualización en vivo de botón/encabezado y alerta si el contraste no cumple AA).
- [ ] SEO: título, descripción, imagen para compartir.
- [ ] Tras guardar, invalidar cache del tenant en el Worker (`POST /api/admin/purge-tenant` que borra la clave de Cache API) para que el sitio público lo refleje en segundos.

### 3. Footer — `/admin/contenido/footer`
- [ ] Texto libre (Markdown limitado: negrita, enlaces), dirección, enlaces personalizados (lista ordenable), interruptores "Mostrar redes sociales" y "Mostrar ‘Hecho con Servigo’".
- [ ] Vista previa en vivo del footer.

### 4. Sedes — `/admin/sedes`
- [ ] Lista con tarjeta por sede (imagen, nombre, ciudad, estado), reordenable por arrastre (`@dnd-kit`), activar/inactivar.
- [ ] Formulario: nombre, slug (autogenerado y editable, único en la empresa), dirección, ciudad, teléfono, WhatsApp, email, enlace de Google Maps, zona horaria (por defecto la de la empresa).
- [ ] Imágenes: **imagen de portada** (la que se muestra en el selector de sedes del inicio) y **encabezado** (título, subtítulo, imagen, opacidad del overlay) con vista previa.
- [ ] Interruptores:
  - **Disponibilidad propia** (`own_availability`): explicación "Si está apagado, esta sede usa el horario general de la empresa".
  - **Catálogo propio** (`own_catalog`): "Si está apagado, se ofrecen todos los servicios y productos activos". Al encenderlo por primera vez, copiar todos los ítems activos a `branch_catalog_items` para partir de algo.
- [ ] No permitir inactivar la última sede activa. No permitir borrar sedes con reservas (solo inactivar).

### 5. Acerca de — `/admin/contenido/acerca`
- [ ] Pestaña **General**: título, cuerpo (editor Markdown simple con vista previa, p. ej. `@uiw/react-md-editor` o textarea + `react-markdown` con `rehype-sanitize`), imagen, interruptor **Visible para clientes**.
- [ ] Pestaña por **sede**: mismo formulario, independiente, con su propio interruptor de visibilidad.
- [ ] Si nada es visible, el enlace "Acerca de" no aparece en el sitio público.

### 6. Patrocinadores — `/admin/contenido/patrocinadores`
- [ ] Selector de sede (o "Aplicar a varias sedes" al crear: duplica el registro por sede).
- [ ] Lista ordenable: imagen (logo), nombre, descripción, URL opcional, interruptor **Visible**.
- [ ] Interruptor de sección por sede "Mostrar sección de patrocinadores" (guardado en `branches.header` o columna `show_sponsors` — añadir migración).

### 7. Redes sociales — `/admin/contenido/redes`
- [ ] Nivel **empresa** (heredado por todas las sedes) y nivel **sede** (si una sede define las suyas, reemplazan a las de la empresa para esa sede — mostrar aviso explicativo).
- [ ] Por enlace: red (`social_network` con icono), etiqueta, URL (validación por red: WhatsApp acepta número y lo convierte a `https://wa.me/57...`, email → `mailto:`, teléfono → `tel:`), visible, orden.

### 8. Configuración de reservas — `/admin/configuracion/reservas`
- [ ] Editar `companies.booking_settings`: confirmación automática, anticipación mínima, días máximos hacia adelante, paso de los horarios, permitir cancelación del cliente y límite en horas, email obligatorio, texto de términos y condiciones.

## Criterios de aceptación

- [ ] Cambiar color primario y logo se refleja en admin y en el sitio público tras guardar.
- [ ] Crear 2 sedes con portada distinta; ambas aparecen ordenadas según el arrastre.
- [ ] Una sede con *Acerca de* oculto no lo muestra; la general visible sí.
- [ ] Patrocinadores y redes respetan la visibilidad y la herencia empresa → sede.
- [ ] Ninguna imagen subida supera 400 KB; se borran los archivos reemplazados.
- [ ] Un usuario `staff` no ve estos menús y RLS rechaza sus escrituras (prueba manual + pgTAP existente).
