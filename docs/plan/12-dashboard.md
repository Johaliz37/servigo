# Fase 12 — Dashboard

## Objetivo

Página de inicio de `/admin` con indicadores y gráficas del negocio, filtrable por sede y rango de fechas, calculados en Postgres para no transferir datos crudos.

## Prerrequisitos

Fase 11. Tablas `bookings`, `booking_items`, `customers`, `availability_events`. Motor de disponibilidad (para ocupación).

## Tareas

### 1. RPC de métricas (security invoker → respeta RLS y sedes del staff)
- [x] `dashboard_kpis(p_company, p_branch null, p_from, p_to)` → `{ bookings_total, by_status{...}, revenue_expected (confirmed+completed), revenue_completed, avg_ticket, new_customers, returning_customers, cancellation_rate, no_show_rate }` + mismos valores del periodo anterior equivalente para calcular variación %.
- [x] `dashboard_timeseries(p_company, p_branch, p_from, p_to, p_bucket 'day'|'week'|'month')` → reservas e ingresos por bucket en la zona de la empresa.
- [x] `dashboard_top_services(...)`, `dashboard_top_products(...)` (cantidad e ingresos).
- [x] `dashboard_heatmap(...)` → reservas por día de semana × hora.
- [x] `dashboard_by_branch(...)` → comparación entre sedes (solo owner/admin).
- [x] Índices necesarios verificados con `explain analyze` sobre el seed ampliado (10k reservas).

### 2. Ocupación
- [x] En el Worker o cliente: minutos ofertados (ventanas `open` − `closed` × capacidad, vía motor de fase 08) vs. minutos reservados → % ocupación por sede y por servicio en el rango. Limitar a 31 días por cálculo.

### 3. UI `/admin`
- [x] Barra: selector de sede (global), rango (Hoy · 7 días · 30 días · Este mes · Personalizado).
- [x] Fila de **tarjetas KPI**: Reservas, Ingresos esperados, Ticket promedio, Ocupación, Cancelaciones — con variación vs. periodo anterior (flecha y color).
- [x] **Próximas reservas de hoy** (lista corta con acciones rápidas confirmar/llamar) y **Pendientes por confirmar**.
- [x] Gráficas (Recharts vía `chart` de shadcn, colores de la marca): línea/área de reservas e ingresos en el tiempo; barras horizontales de top servicios y productos; mapa de calor día×hora; barras por sede; dona de estados.
- [x] Estados vacíos útiles ("Aún no tienes reservas: comparte tu enlace {slug}.roquintech.com" con botón copiar y QR generado en el cliente con `qrcode`).
- [x] Carga perezosa de Recharts; skeletons; refresco al recibir eventos Realtime de nuevas reservas.
- [x] Staff: ve solo KPIs de sus sedes, sin comparación entre sedes ni ingresos si se decide restringir (flag en `booking_settings.staff_can_see_revenue`).

## Criterios de aceptación

- [x] Con el seed, los KPIs coinciden con consultas SQL manuales de verificación (test pgTAP por cada RPC).
- [x] Cambiar sede/rango actualiza todo en < 1 s con 10k reservas.
- [x] Las cifras se muestran en la moneda y zona horaria de la empresa.
- [x] Staff no obtiene datos de sedes no asignadas llamando la RPC directamente.

## Notas de ejecución

- **RPC** (`20261125231722_dashboard_metrics.sql`): `dashboard_kpis` (periodo y anterior de la misma duración), `dashboard_timeseries` (día, semana o mes, con buckets vacíos), `dashboard_top_services`, `dashboard_top_products`, `dashboard_heatmap` y `dashboard_by_branch` (solo owner/admin; staff recibe 42501).
  - **Cambio respecto al plan: security definer, no invoker** (D30). Con RLS la política `can_access_branch` se evaluaba en cada fila: unos 100 ms por consulta y 3,2 s los KPIs con 10.000 reservas. Ahora cada RPC calcula una vez las sedes visibles (`dashboard_branches`, con `can_access_branch`) y filtra por ellas. Staff que pide otra sede o toda la empresa solo suma las suyas (pgTAP). Las funciones internas que devuelven filas completas no se exponen.
  - **Rendimiento** con 10.000 reservas extra (transacción revertida, como owner): KPIs de 30 días 26 ms, de 180 días 55 ms; serie, tops, mapa de calor y sedes de 3 a 8 ms. Bastan los índices `(company_id, branch_id, starts_at)` y `bookings_customer_idx`.
  - **Definiciones**: reservas = todas las del periodo (por inicio); ingresos esperados = confirmed + completed; ticket promedio = ingresos esperados / nº de confirmed + completed; cliente nuevo = su primera reserva no cancelada (en las sedes visibles) cae en el periodo; tasas de cancelación y no asistencia sobre el total. Zona: la de la sede elegida o la de la empresa.
  - **Ingresos para staff**: `booking_settings.staff_can_see_revenue` (por defecto sí; interruptor en Configuración → Reservas). Si está apagado, las RPC devuelven los ingresos en null para staff.
- **Ocupación** (`occupancy` en `@shared/dashboard`, en el navegador con el motor de la fase 08, en tramos de 31 días): por servicio, minutos reservados (bloques con buffers de reservas no canceladas, recortados al rango) / (tiempo libre del servicio × su capacidad); por sede, todo lo reservado / (unión del tiempo libre × la mayor capacidad). Las reservas con «No asistió» cuentan: el cupo se ocupó.
- **UI** (`features/dashboard`): rango en la URL (`?rango=today|7d|custom&desde=&hasta=`; por defecto 30 días), tarjetas KPI con variación (flecha + texto, verde o rojo según convenga), próximas de hoy y pendientes con «Confirmar» y llamar, estado vacío con enlace y QR (`qrcode`, diferido).
  - Gráficas según la guía de visualización: series de reservas e ingresos en **dos gráficas** (nunca dos ejes), Recharts en un chunk diferido (`TimeChart`, ~100 KB gzip, solo en el inicio del panel); rankings como listas de barras HTML; mapa de calor con rampa secuencial de un tono; **barra segmentada de estados en lugar de la dona** (una dona compara mal valores cercanos); ocupación por servicio.
  - **Colores**: paleta validada para daltonismo (claro y oscuro, `dashboard.css`), no los de la marca: cada empresa elige los suyos sin comprobar contraste. Validador: pasa en ambos modos; en claro tres tonos quedan bajo 3:1, por eso cada gráfica tiene «Ver tabla» y la leyenda lleva números.
  - Se refresca con los eventos de Realtime de la fase 11 y tras cada cambio de estado.
- **Pruebas**: pgTAP `fase12_dashboard.test.sql` (24, datos conocidos con el cálculo a mano), unitarias `src/shared/fase12.test.ts`, E2E `e2e/fase12.spec.ts` (3).
