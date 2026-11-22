# Fase 13 — Calidad, seguridad y lanzamiento

## Objetivo

Dejar la plataforma lista para empresas reales: seguridad revisada, pruebas E2E de los flujos críticos, accesibilidad, rendimiento, observabilidad, documentación de uso y checklist de lanzamiento, manteniendo costo 0.

## Prerrequisitos

Fases 01–12 completas.

## Tareas

### 1. Seguridad
- [ ] Revisar *Security Advisor* y *Performance Advisor* de Supabase: 0 alertas.
- [ ] Auditoría RLS: script pgTAP que recorre `information_schema.tables` de `public` y falla si alguna tabla no tiene RLS o no tiene políticas.
- [ ] Verificar que `anon` no tiene privilegios de tabla y que toda función `security definer` tiene `search_path = ''`.
- [ ] La secret key de Supabase solo existe en secretos del Worker y de GitHub; buscar en el bundle (`grep sb_secret dist/`) → 0 resultados.
- [ ] Cabeceras desde el Worker: `Content-Security-Policy` (permitir `self`, Supabase, `challenges.cloudflare.com`, Google Fonts si se usa), `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY` (salvo que se permita embeber el sitio público).
- [ ] Sanitización de Markdown (`rehype-sanitize`) y SVG de logos (`DOMPurify` antes de subir).
- [ ] Rate limits y Turnstile probados (scripts de carga ligera con `autocannon` en local).
- [ ] Pruebas de aislamiento manuales: con dos navegadores (empresa A y B) intentar leer/escribir IDs de la otra vía consola (`supabase.from(...).select()`).
- [ ] Política de privacidad y tratamiento de datos (Ley 1581 de 2012 en Colombia u otra aplicable): página `/privacidad` por tenant con plantilla editable; casilla de autorización de datos en la reserva.
- [ ] Proceso para eliminar datos de un cliente a petición (RPC `anonymize_customer`).

### 2. Pruebas
- [ ] E2E Playwright (Chromium + WebKit móvil) en CI:
  - Alta de empresa por superadmin → invitación → login owner.
  - Configurar sede, servicio con foto/descuento, campo adicional, ventana de atención.
  - Reserva pública completa y búsqueda por código y por teléfono.
  - Gestión: confirmar, reprogramar, cancelar.
  - Aislamiento: owner de A no accede a `/admin` de B.
- [ ] Cobertura mínima: `src/shared` ≥ 90 %, total ≥ 70 %.
- [ ] Prueba de concurrencia de reservas (20 peticiones simultáneas al mismo slot de capacidad 1 → exactamente 1 éxito).

### 3. Accesibilidad y UX
- [ ] `@axe-core/playwright` en páginas públicas y principales de admin: 0 violaciones serias.
- [ ] Navegación completa por teclado del asistente de reserva y del calendario.
- [ ] Textos en español revisados (tildes, tono consistente "tú" o "usted" — decidir y aplicar).
- [ ] Mensajes de error de Postgres/Supabase mapeados a mensajes amigables.

### 4. Rendimiento y costos
- [ ] Lighthouse CI en PR para `/` y `/s/:branch` (presupuestos: LCP < 2.5 s en 4G, JS inicial ≤ 150 KB gzip).
- [ ] Revisar métricas del Worker (CPU p99 < 10 ms) y peticiones/día con margen frente a 100k.
- [ ] Revisar uso de Supabase (BD, storage, egress) y documentar en `docs/runbook.md` a qué volumen de empresas/reservas se acercan los límites gratuitos y qué hacer entonces.
- [ ] Alertas gratuitas: notificaciones de uso de Cloudflare y emails de uso de Supabase activados.

### 5. Observabilidad
- [ ] Workers Observability (logs) activado; logs estructurados JSON con `tenant`, `route`, `status`, `duration`, sin datos personales.
- [ ] Página `/api/health` con chequeo de BD; monitor externo gratuito (UptimeRobot Free o GitHub Action cada hora) con aviso por email.
- [ ] Captura de errores del cliente: endpoint `/api/client-errors` que registra en logs del Worker (sin servicios de pago).

### 6. Documentación
- [ ] `docs/manual-empresa.md`: guía paso a paso para empresas (configurar sedes, catálogo, horario, formularios, contenido, gestionar reservas) con capturas.
- [ ] `docs/runbook.md` completo (fase 04 + incidentes comunes).
- [ ] `docs/arquitectura.md` actualizada (desde `00`), diagrama ER y diagrama de secuencia de la reserva.
- [ ] CHANGELOG y versión `v1.0.0` etiquetada.

### 7. Checklist de lanzamiento
- [ ] Backups automáticos funcionando y **restauración probada** en un proyecto local.
- [ ] Keep-alive activo.
- [ ] Seed de demo **no** aplicado en producción; empresa `demo` creada manualmente como vitrina comercial (opcional).
- [ ] Primer cliente real dado de alta, con acompañamiento en la configuración.
- [ ] Revisión final de facturación: 0 USD en Cloudflare, Supabase, GitHub y (si se usa) Resend.

## Criterios de aceptación

- [ ] Todos los checks anteriores marcados.
- [ ] CI verde con E2E, accesibilidad y Lighthouse.
- [ ] Release `v1.0.0` desplegada en `*.roquintech.com`.
