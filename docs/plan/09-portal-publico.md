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

### 1. RPC públicas (security definer, `grant execute to anon, service_role`)
- [ ] `get_public_site(p_slug)` → `{ company: {name, logo, colors, footer, seo, contact}, branches: [{slug, name, city, cover_image, sort_order}] (solo activas), socials_company: [...], about_visible: bool }`.
- [ ] `get_public_branch(p_slug, p_branch_slug)` → `{ branch: {name, header, address, phone, whatsapp, maps_url, timezone}, services: [...], products: [...], sponsors: [...visibles], socials: [...sede o heredadas], about_branch_visible }`. Cada ítem con `id, kind, name, short_description, cover, photos, details, price, final_price, discount {label, ends_at}, duration_minutes`.
- [ ] `get_public_item(p_slug, p_branch_slug, p_item_id)` → ficha completa + add-ons disponibles (si es servicio).
- [ ] `get_public_about(p_slug, p_branch_slug?)` → secciones visibles.
- [ ] Precios calculados en SQL con la misma regla de `pricing.ts` (test de paridad).
- [ ] Nunca devolver ítems/sedes inactivos ni contenido con `is_visible = false`.

### 2. Endpoints del Worker con caché
- [ ] `GET /api/public/site`, `/api/public/branch/:branchSlug`, `/api/public/item/:branchSlug/:id`, `/api/public/about` → llaman la RPC y responden con `Cache-Control: public, max-age=60, stale-while-revalidate=300`, guardado en Cache API con clave por tenant. Purga al guardar en admin (fase 05).
- [ ] HTMLRewriter (fase 03) amplía meta por ruta: en `/s/:branch/servicios/:id` → `og:title` = servicio, `og:image` = foto de portada.
- [ ] `sitemap.xml` y `robots.txt` por tenant generados en el Worker.

### 3. Páginas
- [ ] **Inicio `/`**
  - Varias sedes: hero de la empresa (logo, nombre, imagen hero) + rejilla de **tarjetas de sede** con su imagen de portada a ancho completo, nombre y ciudad; toda la tarjeta clicable → `/s/:branchSlug`. Recordar la última sede elegida (`localStorage`) y ofrecer "Continuar en {sede}".
  - Una sola sede: `replace` a `/s/:branchSlug`.
- [ ] **Sede `/s/:branchSlug`**
  - **3.1 Encabezado**: imagen de la sede con overlay, título, subtítulo, dirección (enlace a Maps), botón WhatsApp/llamar, CTA "Reservar".
  - **3.2 Servicios (carrusel)**: Embla con tarjetas (foto, nombre, descripción corta, duración, precio y precio tachado si hay descuento, badge "Hasta el 30 nov"), flechas y puntos, *swipe* en móvil, autoplay opcional pausado al hover/foco, accesible (`aria-roledescription="carousel"`, botones con label). Clic → detalle; botón "Reservar" → asistente. Debajo, sección "Productos" (rejilla) si hay productos visibles.
  - **3.3 Patrocinadores**: logos en franja/rejilla con descripción al hover o debajo (oculto si no hay o la sede lo desactivó).
  - **3.4 Redes sociales**: iconos grandes con etiqueta (sede o heredados de la empresa).
  - **3.5 Footer**: configurado en la fase 05 (texto, dirección, enlaces, redes si `show_socials`, "Hecho con Servigo").
  - Selector de sede en el header si hay varias.
- [ ] **Detalle de ítem** `/s/:branchSlug/servicios/:id` (y `/productos/:id`): galería (Embla + lightbox), precio, descuento con fecha límite, lista de detalles, descripción Markdown, productos complementarios (servicios), botón "Reservar" fijo en móvil.
- [ ] **Acerca de** `/acerca` (y anclas por sede): secciones visibles con imagen.
- [ ] Estados: skeletons de carga, vacío ("Pronto publicaremos nuestros servicios"), error con reintento, 404 de sede.

### 4. Calidad del front público
- [ ] Mobile-first; probado a 360 px, 768 px y 1280 px.
- [ ] Imágenes `loading="lazy"`, `width/height` explícitos, `srcset` con miniatura y versión grande; la primera imagen del encabezado con `fetchpriority="high"`.
- [ ] Lighthouse móvil ≥ 90 en rendimiento, accesibilidad, buenas prácticas y SEO.
- [ ] Bundle JS inicial de la ruta pública ≤ 150 KB gzip.

### 5. E2E (Playwright)
- [ ] `public-site.spec.ts`: empresa con 2 sedes → elige sede → ve encabezado, carrusel con N servicios, patrocinadores, redes y footer en ese orden; empresa con 1 sede entra directo.

## Criterios de aceptación

- [ ] El flujo 1 → 2 → 3 (3.1–3.5) se cumple tal cual en `demo` (2 sedes) y `spa` (1 sede).
- [ ] Contenido oculto/inactivo nunca aparece (verificado en E2E).
- [ ] Un cambio en admin se ve en el sitio público en ≤ 60 s (o al instante si se purga).
- [ ] Compartir el enlace de un servicio en WhatsApp muestra título e imagen correctos.
