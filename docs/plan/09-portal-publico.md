# Fase 09 — Portal público de la empresa

## Objetivo

Construir el sitio que ven los clientes en `https://{slug}.roquintech.com` sin iniciar sesión, siguiendo el flujo pedido:

1. Al cargar, se muestra la página configurada para la empresa.
2. Si la empresa tiene **más de una sede**, se muestran las imágenes de cada sede para elegir a cuál entrar. Con una sola sede se entra directamente.
3. La página de la sede muestra, en orden: **3.1** encabezado de la sede · **3.2** servicios en carrusel · **3.3** patrocinadores · **3.4** redes sociales · **3.5** footer de la empresa.

Además: detalle de servicio/producto, catálogo de productos y *Acerca de*.

## Prerrequisitos

Fases 05 y 06 (contenido y catálogo). Función `effective_catalog`, módulo `pricing.ts`.

## Tareas

> Heredado de la fase 05: el enlace «Acerca de» solo aparece si alguna sección es visible, y redes y patrocinadores respetan `is_visible`, `branches.show_sponsors` y la herencia empresa → sede (si la sede tiene redes propias, reemplazan a las de la empresa). El panel ya guarda todo eso.

### 1. RPC públicas (security definer, `grant execute to anon, service_role`)
- [x] `get_public_site(p_slug)` → `{ company: {name, logo, colors, footer, seo, contact}, branches: [{slug, name, city, cover_image, sort_order}] (solo activas), socials_company: [...], about_visible: bool }`.
- [x] `get_public_branch(p_slug, p_branch_slug)` → `{ branch: {name, header, address, phone, whatsapp, maps_url, timezone}, services: [...], products: [...], sponsors: [...visibles], socials: [...sede o heredadas], about_branch_visible }`. Cada ítem con `id, kind, name, short_description, cover, photos, details, price, final_price, discount {label, ends_at}, duration_minutes`.
- [x] `get_public_item(p_slug, p_branch_slug, p_item_id)` → ficha completa + add-ons disponibles (si es servicio).
- [x] `get_public_about(p_slug, p_branch_slug?)` → secciones visibles.
- [x] Precios calculados en SQL con la misma regla de `pricing.ts` (test de paridad).
- [x] Nunca devolver ítems/sedes inactivos ni contenido con `is_visible = false`.

### 2. Endpoints del Worker con caché
- [x] `GET /api/public/site`, `/api/public/branch/:branchSlug`, `/api/public/item/:branchSlug/:id`, `/api/public/about` → llaman la RPC y responden con `Cache-Control: public, max-age=60, stale-while-revalidate=300`, guardado en Cache API con clave por tenant. Purga al guardar en admin (fase 05).
- [x] HTMLRewriter (fase 03) amplía meta por ruta: en `/s/:branch/servicios/:id` → `og:title` = servicio, `og:image` = foto de portada.
- [x] `sitemap.xml` y `robots.txt` por tenant generados en el Worker.

### 3. Páginas
- [x] **Inicio `/`**
  - Varias sedes: hero de la empresa (logo, nombre, imagen hero) + rejilla de **tarjetas de sede** con su imagen de portada a ancho completo, nombre y ciudad; toda la tarjeta clicable → `/s/:branchSlug`. Recordar la última sede elegida (`localStorage`) y ofrecer "Continuar en {sede}".
  - Una sola sede: `replace` a `/s/:branchSlug`.
- [x] **Sede `/s/:branchSlug`**
  - **3.1 Encabezado**: imagen de la sede con overlay, título, subtítulo, dirección (enlace a Maps), botón WhatsApp/llamar, CTA "Reservar".
  - **3.2 Servicios (carrusel)**: Embla con tarjetas (foto, nombre, descripción corta, duración, precio y precio tachado si hay descuento, badge "Hasta el 30 nov"), flechas y puntos, *swipe* en móvil, autoplay opcional pausado al hover/foco, accesible (`aria-roledescription="carousel"`, botones con label). Clic → detalle; botón "Reservar" → asistente. Debajo, sección "Productos" (rejilla) si hay productos visibles.
  - **3.3 Patrocinadores**: logos en franja/rejilla con descripción al hover o debajo (oculto si no hay o la sede lo desactivó).
  - **3.4 Redes sociales**: iconos grandes con etiqueta (sede o heredados de la empresa).
  - **3.5 Footer**: configurado en la fase 05 (texto, dirección, enlaces, redes si `show_socials`, "Hecho con Servigo").
  - Selector de sede en el header si hay varias.
- [x] **Detalle de ítem** `/s/:branchSlug/servicios/:id` (y `/productos/:id`): galería (Embla + lightbox), precio, descuento con fecha límite, lista de detalles, descripción Markdown, productos complementarios (servicios), botón "Reservar" fijo en móvil.
- [x] **Acerca de** `/acerca` (y anclas por sede): secciones visibles con imagen.
- [x] Estados: skeletons de carga, vacío ("Pronto publicaremos nuestros servicios"), error con reintento, 404 de sede.

### 4. Calidad del front público
- [x] Mobile-first; probado a 360 px, 768 px y 1280 px.
- [x] Imágenes `loading="lazy"`, `width/height` explícitos, `srcset` con miniatura y versión grande; la primera imagen del encabezado con `fetchpriority="high"`.
- [x] Lighthouse móvil ≥ 90 en rendimiento, accesibilidad, buenas prácticas y SEO.
- [x] Bundle JS inicial de la ruta pública ≤ 150 KB gzip.

### 5. E2E (Playwright)
- [x] `public-site.spec.ts`: empresa con 2 sedes → elige sede → ve encabezado, carrusel con N servicios, patrocinadores, redes y footer en ese orden; empresa con 1 sede entra directo.

## Criterios de aceptación

- [x] El flujo 1 → 2 → 3 (3.1–3.5) se cumple tal cual en `demo` (2 sedes) y `spa` (1 sede).
- [x] Contenido oculto/inactivo nunca aparece (verificado en E2E).
- [x] Un cambio en admin se ve en el sitio público en ≤ 60 s (o al instante si se purga).
- [ ] Compartir el enlace de un servicio en WhatsApp muestra título e imagen correctos.

## Notas de ejecución

- **Datos.** Cinco RPC públicas (`20261125130057_public_site_rpc.sql`), todas `security definer` con `grant` a anon, sobre helpers internos sin `grant` (`public_company`, `public_branch`, `public_catalog`, `public_socials`, `public_about_visible`).
  - Precios: `public_catalog` sale de `effective_catalog` y los complementos de `effective_addons` (D24). `fase09_public_site.test.sql` compara el JSON con `effective_catalog` fila a fila.
  - Redes: la sede usa las suyas si tiene alguna fila propia, aunque esté oculta, como explica el panel (fase 05). Si no tiene, hereda las de la empresa.
  - Añadida `get_public_sitemap` para el `sitemap.xml`.
  - En el listado de la sede, cada ítem trae solo la portada. Las fotos, los detalles y la descripción vienen en `get_public_item`: así la página de sede pesa menos.
- **Worker** (`public-cache.ts`, `seo.ts`). Una lectura cacheada sirve tanto al endpoint como a los meta del HTML.
  - Purga: cada empresa tiene una versión en la Cache API, y purgar es cambiarla (D27).
  - `/s/:sede` y `/s/:sede/(servicios|productos)/:id` llevan título, descripción e imagen propios (`summary_large_image`). Si la sede o el ítem no existen, responden 404 con la SPA.
- **Purga desde el panel.** `usePurgePublicOnSave` (en `AdminLayout`) escucha la caché de mutaciones de TanStack Query: cualquier guardado correcto de owner/admin llama a `POST /api/admin/purge-public`. Varios guardados seguidos se agrupan en 800 ms. `purge-tenant` (fase 05) también purga.
  - La caché del propio navegador (`max-age=60`) puede mostrarle a quien edita la versión anterior hasta 60 s. Un visitante nuevo ve el cambio al instante: lo comprueba la E2E.
- **Peso** (build de producción, JS gzip descargado al abrir): 142 KB en inicio, sede y ficha. «Acerca de» añade 37 KB de Markdown solo si hay texto.
  - Base fija: React, React Router y TanStack Query suman ~137 KB.
  - Para entrar en el presupuesto (D27), el sitio público no carga Radix, Embla, sonner ni date-fns:
    - `Disclosure` reemplaza al menú y al panel lateral;
    - el carrusel y la galería usan `scroll-snap`;
    - el Toaster solo se monta en panel, acceso y consola;
    - `formatMoney` está en `@shared/money` y `messageOf` en `lib/messages`;
    - el lightbox y el Markdown se cargan al usarse.
- **Lighthouse móvil** (build de producción con `vite preview` detrás de un proxy local que comprime como Cloudflare; sin compresión, rendimiento baja a ~68 por los 378 KB sin gzip): 97–100 en rendimiento y 100 en accesibilidad, buenas prácticas y SEO, en inicio, sede, ficha y «Acerca de» de `demo` y `spa`. Para llegar ahí (D27):
  - **Esqueleto estático** (`src/worker/shell.ts`): el Worker pone en `#root` el encabezado y el título de la página (con la foto de portada si la hay), con las mismas clases que React. El elemento LCP se pinta antes del JS. React lo reemplaza al montar sin mover nada. La marca va en el `style` de `<html>`, sin destello de color.
  - **Datos en el HTML** (`window.__PUBLIC__`): el Worker incrusta, escapados, el sitio y la sede o ficha que ya leyó para los meta. `seedPublicData` los pone en la caché de TanStack Query: la primera página no espera a la API.
  - **Rutas públicas sin carga diferida**: layout, inicio, sede y ficha van en el bundle principal, sin otro salto de red (el panel también descarga ese código, que es poco). «Acerca de» sigue siendo *lazy*.
  - El carrusel usa `div` con `role="group"`: un `li` no admite ese rol (aviso de accesibilidad).
- **Carrusel.** Embla se cambió por `SnapCarousel` (`scroll-snap` nativo, D27): *swipe* y flechas, puntos por página y región accesible. Sin autoplay (era opcional): mejor para accesibilidad.
- **Pendiente de verificación manual:**
  - Vista previa real en WhatsApp: requiere producción. Los meta ya los comprueban la E2E y `public-site.test.ts`.
- **Rutas de la fase 10.** `/s/:sede/reservar/:serviceId?`, `/reserva/:code` y `/mis-reservas` siguen en «Muy pronto». Los botones «Reservar» ya apuntan a `bookingPath()`.
