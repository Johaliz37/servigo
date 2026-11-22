# Servigo

SaaS multitenant de reservas de Roquintech. Cada empresa tiene su sitio en `https://{empresa}.roquintech.com`: los clientes reservan sin cuenta y la empresa administra todo en `/admin`.

Stack: React + Vite (SPA) servida por un Cloudflare Worker (Hono) y Supabase (Postgres, Auth, Storage). Todo en planes gratuitos.

El plan de trabajo está en [docs/plan/README.md](docs/plan/README.md).

## Requisitos

- Node.js 24 y pnpm 10 (`npm i -g pnpm@10` o `corepack enable pnpm`)
- Docker Desktop en ejecución (para Supabase local)
- Git y GitHub CLI (`gh`)

## Arranque rápido

```sh
pnpm install
cp .env.example .env.local        # completar con lo que imprime db:start
cp .dev.vars.example .dev.vars    # completar SUPABASE_SECRET_KEY
pnpm db:start                     # Supabase en Docker
pnpm dev                          # app + Worker
```

| URL                                   | Qué es                                                |
| ------------------------------------- | ----------------------------------------------------- |
| http://localhost:5273                 | Plataforma Servigo (local)                            |
| http://demo.localhost:5273            | Sitio de la empresa `demo`                            |
| http://localhost:5273/?tenant=demo    | Alternativa si el navegador no resuelve `*.localhost` |
| http://demo.localhost:5273/api/health | Salud del Worker                                      |
| http://127.0.0.1:54423                | Supabase Studio                                       |
| http://127.0.0.1:54424                | Mailpit (correos locales)                             |

Los puertos (5273 y 544xx) no son los de por defecto, para convivir con otros proyectos Vite y Supabase en la misma máquina.

### Opción Docker para la app

Si prefieres no instalar Node, `docker compose up` corre la app en un contenedor (Supabase sigue con `pnpm db:start`). Añade `SUPABASE_URL=http://host.docker.internal:54421` a `.dev.vars`. En Windows el modo nativo es bastante más rápido.

## Comandos

| Comando                                  | Qué hace                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`                               | Servidor de desarrollo (Vite + Worker en workerd)                                |
| `pnpm build`                             | Typecheck + build de producción                                                  |
| `pnpm lint` / `pnpm format`              | ESLint / Prettier                                                                |
| `pnpm typecheck`                         | TypeScript (cliente, Worker y config)                                            |
| `pnpm test`                              | Tests unitarios (Vitest)                                                         |
| `pnpm e2e`                               | Tests E2E (Playwright)                                                           |
| `pnpm db:start` / `db:stop` / `db:reset` | Supabase local                                                                   |
| `pnpm db:test`                           | Tests pgTAP                                                                      |
| `pnpm db:types`                          | Regenera `src/shared/database.types.ts`                                          |
| `pnpm cf:types`                          | Regenera `worker-configuration.d.ts` tras cambiar `wrangler.jsonc` o `.dev.vars` |

## Estructura

```
src/client/   SPA React (app/, features/, components/ui/, lib/)
src/worker/   Worker Hono: /api, inyección de tenant y meta
src/shared/   TS puro compartido (tenant, esquemas Zod, motor de disponibilidad)
supabase/     config.toml, migraciones, seed y tests pgTAP
e2e/          Playwright
```
