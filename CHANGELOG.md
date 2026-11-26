# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado [SemVer](https://semver.org/lang/es/). Las decisiones de cada cambio están en [docs/plan/00](docs/plan/00-arquitectura-y-decisiones.md).

## [1.0.0] — 2026-11-26

Primera versión para empresas reales.

### Añadido

- **Fase 13: calidad, seguridad y lanzamiento** (D31)
  - Política de privacidad por empresa en `/privacidad`: plantilla basada en la Ley 1581 de 2012, editable desde **Sitio público → Privacidad**.
  - Autorización de datos obligatoria en la reserva web: el navegador, el Worker y la BD la exigen, y la BD guarda la fecha.
  - Derecho de supresión: el owner elimina los datos personales de un cliente (`anonymize_customer`) y se conservan sus reservas.
  - Cabeceras de seguridad desde el Worker:
    - CSP con nonce;
    - `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` y `Permissions-Policy`.
  - Logs JSON por petición y `POST /api/client-errors` para errores del navegador y violaciones de CSP, sin datos personales.
  - Workflow `uptime`: revisa la salud cada hora y avisa por correo.
  - CI:
    - job `e2e` en Chromium y Safari de iPhone;
    - axe sin violaciones serias;
    - Lighthouse CI con perfil 4G;
    - presupuesto de JS;
    - búsqueda de secretos en el bundle;
    - _advisors_ de Supabase.
  - Pruebas de aislamiento entre empresas, concurrencia (20 reservas al mismo cupo → 1) y rate limit. También se navega por teclado el asistente de reserva y el calendario.
  - Documentación: [manual para empresas](docs/manual-empresa.md), [arquitectura](docs/arquitectura.md) y un runbook con capacidad, alertas, incidentes y checklist de lanzamiento.
- **Fase 12: dashboard**. Indicadores con la variación frente al periodo anterior, series, rankings, mapa de calor, ocupación y comparación entre sedes (D30).
- **Fase 11: gestión de reservas**:
  - bandeja en vivo;
  - estados con historial;
  - reprogramar, editar y reserva manual;
  - agenda imprimible, CSV, clientes y WhatsApp (D29).
- **Fase 10: reserva pública**. Asistente, código de reserva, consulta por código o teléfono y cancelación. Incluye Turnstile y rate limit (D28).
- **Fase 09: sitio público**. Inicio, sedes, fichas, «Acerca de» y SEO por empresa, con esqueleto estático para un LCP rápido (D27).
- **Fase 08: disponibilidad**. Calendario tipo Google con recurrencias y motor de cupos compartido (D26).
- **Fase 07: información adicional**. Formularios dinámicos por empresa y servicio (D25).
- **Fase 06: catálogo**. Servicios y productos con fotos, detalles, descuentos y precios por sede (D24).
- **Fase 05: empresa, sedes y contenido**. Marca, imágenes WebP, sedes, «Acerca de», patrocinadores, redes y pie de página (D22, D23).
- **Fase 04: despliegue**. Cloudflare Workers, CI de base de datos, backups cifrados y runbook (D20, D21).
- **Fase 03: multitenancy y acceso**. Subdominio por empresa, invitaciones, roles y consola del superadmin (D18, D19).
- **Fase 02: modelo de datos**. Esquema multitenant con RLS, Storage y pruebas pgTAP.
- **Fase 01: entorno**. Worker + SPA, entorno local y CI básica.

[1.0.0]: https://github.com/Johaliz37/servigo/releases/tag/v1.0.0
