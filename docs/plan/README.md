# Plan maestro — Servigo (SaaS multitenant de reservas, by Roquintech)

SaaS de reservas donde cada **empresa** (tenant) configura sus sedes, servicios, productos, disponibilidad y contenido, y sus **clientes** reservan sin iniciar sesión desde `https://{empresa}.roquintech.com`.

## Cómo usar este plan

- Cada fase es un archivo **autocontenido**: trae su contexto mínimo, prerrequisitos, tareas, especificación técnica y criterios de aceptación. Se puede ejecutar en una sesión independiente leyendo **solo** `00-arquitectura-y-decisiones.md` + el archivo de la fase.
- Las tareas usan casillas `- [ ]`. Al terminar una tarea se marca `- [x]` en el mismo archivo para que el avance quede versionado en git.
- Una fase está **terminada** cuando se cumplen todos sus *Criterios de aceptación*.
- Si una fase necesita cambiar algo decidido en `00`, se actualiza `00` primero (registro de decisiones al final).
- Regla de oro: **costo 0**. Ninguna tarea puede introducir un servicio de pago. Si algo solo existe en un plan de pago, se marca como *fuera de alcance* o se busca alternativa gratuita.

## Fases

| # | Archivo | Resultado | Depende de |
|---|---------|-----------|------------|
| 00 | [00-arquitectura-y-decisiones.md](00-arquitectura-y-decisiones.md) | Arquitectura, stack, convenciones y límites de los planes gratuitos | — |
| 01 | [01-entorno-local-y-repositorio.md](01-entorno-local-y-repositorio.md) | Repo en GitHub, monorepo, Docker Desktop + Supabase local, app arrancando, CI básica | 00 |
| 02 | [02-modelo-de-datos-y-seguridad.md](02-modelo-de-datos-y-seguridad.md) | Esquema completo, RLS, Storage, RPCs base, seeds y pruebas pgTAP | 01 |
| 03 | [03-multitenancy-autenticacion-y-shell.md](03-multitenancy-autenticacion-y-shell.md) | Resolución de tenant por subdominio, login admin, layouts, alta de empresas | 02 |
| 04 | [04-despliegue-cloudflare-y-cicd.md](04-despliegue-cloudflare-y-cicd.md) | `*.roquintech.com` en producción, CI completa (BD, E2E) + CD con GitHub Actions, backups | 03 |
| 05 | [05-empresa-sedes-y-contenido.md](05-empresa-sedes-y-contenido.md) | Perfil, marca, footer, sedes, Acerca de, patrocinadores, redes sociales | 03 |
| 06 | [06-catalogo-servicios-y-productos.md](06-catalogo-servicios-y-productos.md) | Servicios y productos con fotos, detalles, descuentos, por sede | 05 |
| 07 | [07-informacion-adicional.md](07-informacion-adicional.md) | Formularios dinámicos por servicio o generales | 06 |
| 08 | [08-disponibilidad-y-calendario.md](08-disponibilidad-y-calendario.md) | Calendario estilo Google por sede, ventanas de atención / no disponibilidad, motor de cupos | 06 |
| 09 | [09-portal-publico.md](09-portal-publico.md) | Sitio público: selector de sede, encabezado, carrusel, patrocinadores, redes, footer | 05, 06 |
| 10 | [10-flujo-de-reserva-y-consulta.md](10-flujo-de-reserva-y-consulta.md) | Asistente de reserva, código, confirmación, búsqueda de reservas | 07, 08, 09 |
| 11 | [11-gestion-de-reservas.md](11-gestion-de-reservas.md) | Bandeja de reservas para la empresa: estados, filtros, edición | 10 |
| 12 | [12-dashboard.md](12-dashboard.md) | KPIs y gráficas por empresa y sede | 11 |
| 13 | [13-calidad-seguridad-y-lanzamiento.md](13-calidad-seguridad-y-lanzamiento.md) | Hardening, accesibilidad, rendimiento, E2E, checklist de lanzamiento | todas |

```
00 → 01 → 02 → 03 ─┬─ 04 (se puede hacer en paralelo a 05+ y conviene hacerlo pronto)
                   └─ 05 → 06 ─┬─ 07 ─┐
                               ├─ 08 ─┼─ 10 → 11 → 12 → 13
                               └─ 09 ─┘
```

## Glosario

| Término | Significado |
|---------|-------------|
| Servigo / Plataforma | El producto SaaS de reservas (`servigo.roquintech.com`). |
| Roquintech | Empresa matriz, dueña de `roquintech.com`, con varios productos; Servigo es uno de ellos. |
| Empresa / tenant | Negocio que contrata la plataforma; tiene un `slug` que es su subdominio. |
| Sede (`branch`) | Ubicación física de una empresa. Puede tener disponibilidad y catálogo propios. |
| Ítem de catálogo | Servicio (reservable, con duración) o producto (se vende, puede añadirse a una reserva). |
| Ventana de atención | Bloque de tiempo en el que se aceptan reservas. |
| Ventana de no disponibilidad | Bloque que resta tiempo a las ventanas de atención (festivo, almuerzo, mantenimiento). |
| Información adicional | Campos configurables que el cliente responde al reservar. |
| Cliente final | Persona que reserva; no tiene cuenta. |
| Miembro | Usuario autenticado de una empresa (owner, admin, staff). |
| Superadmin | Operador de Servigo (equipo Roquintech) que da de alta empresas. |
