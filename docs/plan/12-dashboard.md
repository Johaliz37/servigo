# Fase 12 — Dashboard

## Objetivo

Página de inicio de `/admin` con indicadores y gráficas del negocio, filtrable por sede y rango de fechas, calculados en Postgres para no transferir datos crudos.

## Prerrequisitos

Fase 11. Tablas `bookings`, `booking_items`, `customers`, `availability_events`. Motor de disponibilidad (para ocupación).

## Tareas

### 1. RPC de métricas (security invoker → respeta RLS y sedes del staff)
- [ ] `dashboard_kpis(p_company, p_branch null, p_from, p_to)` → `{ bookings_total, by_status{...}, revenue_expected (confirmed+completed), revenue_completed, avg_ticket, new_customers, returning_customers, cancellation_rate, no_show_rate }` + mismos valores del periodo anterior equivalente para calcular variación %.
- [ ] `dashboard_timeseries(p_company, p_branch, p_from, p_to, p_bucket 'day'|'week'|'month')` → reservas e ingresos por bucket en la zona de la empresa.
- [ ] `dashboard_top_services(...)`, `dashboard_top_products(...)` (cantidad e ingresos).
- [ ] `dashboard_heatmap(...)` → reservas por día de semana × hora.
- [ ] `dashboard_by_branch(...)` → comparación entre sedes (solo owner/admin).
- [ ] Índices necesarios verificados con `explain analyze` sobre el seed ampliado (10k reservas).

### 2. Ocupación
- [ ] En el Worker o cliente: minutos ofertados (ventanas `open` − `closed` × capacidad, vía motor de fase 08) vs. minutos reservados → % ocupación por sede y por servicio en el rango. Limitar a 31 días por cálculo.

### 3. UI `/admin`
- [ ] Barra: selector de sede (global), rango (Hoy · 7 días · 30 días · Este mes · Personalizado).
- [ ] Fila de **tarjetas KPI**: Reservas, Ingresos esperados, Ticket promedio, Ocupación, Cancelaciones — con variación vs. periodo anterior (flecha y color).
- [ ] **Próximas reservas de hoy** (lista corta con acciones rápidas confirmar/llamar) y **Pendientes por confirmar**.
- [ ] Gráficas (Recharts vía `chart` de shadcn, colores de la marca): línea/área de reservas e ingresos en el tiempo; barras horizontales de top servicios y productos; mapa de calor día×hora; barras por sede; dona de estados.
- [ ] Estados vacíos útiles ("Aún no tienes reservas: comparte tu enlace {slug}.roquintech.com" con botón copiar y QR generado en el cliente con `qrcode`).
- [ ] Carga perezosa de Recharts; skeletons; refresco al recibir eventos Realtime de nuevas reservas.
- [ ] Staff: ve solo KPIs de sus sedes, sin comparación entre sedes ni ingresos si se decide restringir (flag en `booking_settings.staff_can_see_revenue`).

## Criterios de aceptación

- [ ] Con el seed, los KPIs coinciden con consultas SQL manuales de verificación (test pgTAP por cada RPC).
- [ ] Cambiar sede/rango actualiza todo en < 1 s con 10k reservas.
- [ ] Las cifras se muestran en la moneda y zona horaria de la empresa.
- [ ] Staff no obtiene datos de sedes no asignadas llamando la RPC directamente.
