# Servigo — instrucciones para agentes

## Antes de trabajar

Lee siempre `docs/plan/00-arquitectura-y-decisiones.md` y el archivo de la fase actual en `docs/plan/`. Las decisiones de `00` son vinculantes; si una fase necesita cambiarlas, actualiza primero `00` (registro de decisiones al final). Al terminar una tarea, márcala `- [x]` en el archivo de la fase.

Regla de oro: **costo 0**. No introduzcas servicios de pago.

## Comandos clave

- `pnpm db:start` y luego `pnpm dev` → http://demo.localhost:5273 (empresa) y http://localhost:5273 (plataforma)
- Antes de cada PR: `pnpm lint && pnpm typecheck && pnpm test` y `pnpm db:test`
- E2E local (con `pnpm dev` y la BD con seed): `PW_CHANNEL=msedge pnpm e2e`
- Tras una migración: `pnpm db:types`. Tras tocar `wrangler.jsonc` o `.dev.vars`: `pnpm cf:types`
- Migraciones nuevas: `pnpm exec supabase migration new <descripcion>`; nunca editar una ya aplicada en producción

## Convenciones

- `src/shared` es TS puro: nada de APIs de navegador ni de Workers (ESLint lo vigila).
- Alias: `@client/*`, `@worker/*`, `@shared/*`.
- UI en español; código, tablas y columnas en inglés.
- Componentes shadcn en `src/client/components/ui`. Al añadir uno con `pnpm dlx shadcn add`, revisa que el import de `cn` quede como `@client/lib/utils`: el CLI 4.x lo escribe como `"cn"` y añade un paquete npm `cn` que hay que quitar (`pnpm remove cn`).
- Puertos locales: app 5273; Supabase API 54421, BD 54422, Studio 54423, Mailpit 54424 (ver `00` D15).
- Git: ramas `feat/fase-XX-...`, Conventional Commits, PR a `main` con CI verde.
