# Fase 13 — Calidad, seguridad y lanzamiento

## Objetivo

Dejar la plataforma lista para empresas reales: seguridad revisada, pruebas E2E de los flujos críticos, accesibilidad, rendimiento, observabilidad, documentación de uso y checklist de lanzamiento, manteniendo costo 0.

## Prerrequisitos

Fases 01–12 completas.

## Tareas

### 1. Seguridad
- [x] Revisar *Security Advisor* y *Performance Advisor* de Supabase: 0 alertas. *(Esquema: `supabase db advisors --level warn --fail-on warn` en el job `db`, 0 avisos. Producción: checklist del runbook §16.)*
- [x] Auditoría RLS: script pgTAP que recorre `information_schema.tables` de `public` y falla si alguna tabla no tiene RLS o no tiene políticas.
- [x] Verificar que `anon` no tiene privilegios de tabla y que toda función `security definer` tiene `search_path = ''`.
- [x] La secret key de Supabase solo existe en secretos del Worker y de GitHub; buscar en el bundle (`grep sb_secret dist/`) → 0 resultados.
- [x] Cabeceras desde el Worker: `Content-Security-Policy` (permitir `self`, Supabase, `challenges.cloudflare.com`, Google Fonts si se usa), `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY` (salvo que se permita embeber el sitio público).
- [x] Sanitización de Markdown (`rehype-sanitize`) y SVG de logos (`DOMPurify` antes de subir). *(SVG: no aplica, solo se aceptan JPG, PNG y WebP, D22.)*
- [x] Rate limits y Turnstile probados (scripts de carga ligera con `autocannon` en local). *(Con una E2E en lugar de `autocannon`.)*
- [x] Pruebas de aislamiento manuales: con dos navegadores (empresa A y B) intentar leer/escribir IDs de la otra vía consola (`supabase.from(...).select()`). *(Automatizada en una E2E.)*
- [x] Política de privacidad y tratamiento de datos (Ley 1581 de 2012 en Colombia u otra aplicable): página `/privacidad` por tenant con plantilla editable; casilla de autorización de datos en la reserva.
- [x] Proceso para eliminar datos de un cliente a petición (RPC `anonymize_customer`).

### 2. Pruebas
- [x] E2E Playwright (Chromium + WebKit móvil) en CI:
  - Alta de empresa por superadmin → invitación → login owner.
  - Configurar sede, servicio con foto/descuento, campo adicional, ventana de atención.
  - Reserva pública completa y búsqueda por código y por teléfono.
  - Gestión: confirmar, reprogramar, cancelar.
  - Aislamiento: owner de A no accede a `/admin` de B.
- [x] Cobertura mínima: `src/shared` ≥ 90 %, total ≥ 70 %.
- [x] Prueba de concurrencia de reservas (20 peticiones simultáneas al mismo slot de capacidad 1 → exactamente 1 éxito).

### 3. Accesibilidad y UX
- [x] `@axe-core/playwright` en páginas públicas y principales de admin: 0 violaciones serias.
- [x] Navegación completa por teclado del asistente de reserva y del calendario.
- [x] Textos en español revisados (tildes, tono consistente "tú" o "usted" — decidir y aplicar).
- [x] Mensajes de error de Postgres/Supabase mapeados a mensajes amigables.

### 4. Rendimiento y costos
- [x] Lighthouse CI en PR para `/` y `/s/:branch` (presupuestos: LCP < 2.5 s en 4G, JS inicial ≤ 150 KB gzip).
- [ ] Revisar métricas del Worker (CPU p99 < 10 ms) y peticiones/día con margen frente a 100k. *(Manual en el panel de Cloudflare: runbook §4 y §16.)*
- [x] Revisar uso de Supabase (BD, storage, egress) y documentar en `docs/runbook.md` a qué volumen de empresas/reservas se acercan los límites gratuitos y qué hacer entonces.
- [ ] Alertas gratuitas: notificaciones de uso de Cloudflare y emails de uso de Supabase activados. *(Manual: runbook §13.)*

### 5. Observabilidad
- [x] Workers Observability (logs) activado; logs estructurados JSON con `tenant`, `route`, `status`, `duration`, sin datos personales.
- [x] Página `/api/health` con chequeo de BD; monitor externo gratuito (UptimeRobot Free o GitHub Action cada hora) con aviso por email.
- [x] Captura de errores del cliente: endpoint `/api/client-errors` que registra en logs del Worker (sin servicios de pago).

### 6. Documentación
- [x] `docs/manual-empresa.md`: guía paso a paso para empresas (configurar sedes, catálogo, horario, formularios, contenido, gestionar reservas) con capturas.
- [x] `docs/runbook.md` completo (fase 04 + incidentes comunes).
- [x] `docs/arquitectura.md` actualizada (desde `00`), diagrama ER y diagrama de secuencia de la reserva.
- [ ] CHANGELOG y versión `v1.0.0` etiquetada. *(CHANGELOG y `package.json` en 1.0.0; la etiqueta se crea tras desplegar, runbook §16.)*

### 7. Checklist de lanzamiento
- [ ] Backups automáticos funcionando y **restauración probada** en un proyecto local. *(Restauración probada en la fase 04; falta la primera ejecución programada del domingo.)*
- [ ] Keep-alive activo. *(Primera ejecución programada: jueves 26-nov 12:00 UTC.)*
- [ ] Seed de demo **no** aplicado en producción; empresa `demo` creada manualmente como vitrina comercial (opcional).
- [ ] Primer cliente real dado de alta, con acompañamiento en la configuración.
- [ ] Revisión final de facturación: 0 USD en Cloudflare, Supabase, GitHub y (si se usa) Resend.

## Criterios de aceptación

- [ ] Todos los checks anteriores marcados. *(Quedan los manuales de §4, §6 y §7, en el runbook §16.)*
- [x] CI verde con E2E, accesibilidad y Lighthouse.
- [ ] Release `v1.0.0` desplegada en `*.roquintech.com`.

## Notas de ejecución

- **Migración** `20261126074810_privacy_and_data_rights.sql` (D31):
  - `companies.privacy_policy` y `get_public_privacy`;
  - `bookings.privacy_consent_at` y `create_booking`, que exige `privacy_consent: true` (`SV003`);
  - `customers.anonymized_at` y `anonymize_customer` (solo owner; evento `anonymized`);
  - `dashboard_branches`: ahora responde 42501 a quien no es miembro.
- **Hallazgo de la prueba de aislamiento**: `dashboard_kpis` y compañía devolvían ceros, en vez de 42501, a quien no era miembro de la empresa. No filtraban datos, pero ahora rechazan igual que el resto del panel.
- **Auditoría pgTAP** (`fase13_security_audit.test.sql`): toda tabla con RLS y con alguna política, `search_path = ''` exacto en las 66 funciones definer y ninguna función definer de escritura ejecutable por `anon`. `anon.test.sql` ya tenía la lista cerrada de RPC de `anon`; se le sumó `get_public_privacy`.
- **CSP**:
  - nonce por respuesta: lo llevan los scripts que inserta el Worker y, con HTMLRewriter, los inline del HTML (en desarrollo, el preámbulo de Vite);
  - sin `unsafe-eval`, con Zod en modo `jitless` (`src/client/lib/zod-jitless.ts`, importado primero);
  - `browser-image-compression` descargaba su worker de jsDelivr: ahora se sirve desde `/assets` (`libURL`).
- **Errores del cliente**: `report-error.ts` envía errores, rechazos, errores de ruta y violaciones de CSP (máx. 5 por página). El Worker valida, limita a 10/min por IP (`CLIENT_ERROR_LIMITER`) y limpia correos, teléfonos, consultas, JWT y códigos.
- **Accesibilidad**: axe encontró y se corrigió:
  - contraste del contador de pendientes (blanco sobre `amber-500` → `amber-700`);
  - teclas de atajos del calendario;
  - hora de los eventos (opacidad 0,9; ahora el texto se elige blanco o negro según el color del evento);
  - mapa de calor desplazable sin foco.

  Lighthouse marcaba `target-size` en los enlaces del pie; ahora miden al menos 24 px. Los eventos del calendario son enfocables (`eventInteractive`).
- **Lighthouse**: `vite preview` no comprime, así que Lighthouse medía 465 KB de JS. CI corre el build de producción detrás de `scripts/gzip-proxy.mjs`.
  - Con el perfil 4G (9 Mbps, 170 ms, CPU ×4): rendimiento 0,97–0,99, LCP 1,6–1,9 s, accesibilidad 0,95–0,96 y SEO 1.
  - Con el «Slow 4G» por defecto de Lighthouse, el LCP simulado en local es ~2,9 s. En una carga real, el LCP es el `<h1>` del esqueleto: 0,26–0,77 s.
  - JS inicial: 144,5 KiB gzip (`scripts/check-bundle.mjs`).
- **E2E**: `e2e/fase13.spec.ts` (12 pruebas):
  - cabeceras y aislamiento;
  - concurrencia (20 → 1×201 y 19×409);
  - rate limit (6.ª búsqueda y 11.ª reserva → 429) y autorización;
  - axe y CSP en 8 páginas públicas y 8 del panel;
  - teclado en el asistente y el calendario;
  - política de privacidad y anonimización.

  Proyecto `mobile-webkit` (iPhone 13) para las pruebas `@mobile`. Se estabilizó el arrastre de la fase 11, que fallaba ~1 de cada 6 veces porque el evento quedaba en el borde de la ventana.
- **Cobertura**:
  - `src/shared` 97,5 % de sentencias;
  - total de la lógica (shared + Worker) 88,4 %.

  `catalog.ts` no tenía pruebas. El presupuesto de tiempo del motor de cupos es de 5 ms sin cobertura y 10 ms con instrumentación.
- **Capacidad**: una reserva ocupa ~1,7 KB con índices, más ~0,3 KB por evento (medido con 5.000 filas). Tabla de límites en el runbook §12.
