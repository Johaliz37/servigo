# Fase 01 — Entorno local y repositorio

## Objetivo

Tener el repositorio en GitHub con la estructura definida en `00 §5`, Supabase corriendo localmente en Docker Desktop y la app (SPA + Worker) arrancando en `http://demo.localhost:5273` con un "hola tenant".

## Prerrequisitos

- Windows 11 con Docker Desktop (WSL2 backend) en ejecución.
- Node.js 24 LTS, pnpm 10 (`corepack enable`), Git, GitHub CLI (`gh`).
- Supabase CLI (`pnpm add -D supabase` y usar `pnpm supabase ...`, o `scoop install supabase`).
- Cuenta GitHub y cuenta Cloudflare (gratuitas).

## Alcance

Incluye: repo, tooling, Supabase local, Worker + Vite, lint/format/test, Docker Compose opcional para la app, documentación de arranque.
No incluye: esquema de datos (fase 02), despliegue (fase 04).

## Tareas

### 1. Repositorio
- [x] `git init`, rama `main`, `.gitignore` (node, `.wrangler/`, `.dev.vars`, `supabase/.temp`, `.env*` salvo `.env.example`, `playwright-report/`).
- [ ] Crear repo privado: `gh repo create servigo --private --source . --push`.
- [ ] Protección de `main`: requerir PR y el check `ci` verde (se activa en esta fase, ver §6).
- [x] `README.md` raíz con: qué es, requisitos, arranque rápido, enlace a `docs/plan/README.md`.
- [x] `CLAUDE.md` / `AGENTS.md` con comandos clave y la regla "leer `docs/plan/00` + fase actual".

### 2. Proyecto app
- [x] `pnpm create cloudflare@latest . --framework=react` (plantilla Vite + React + Worker con `@cloudflare/vite-plugin`) o equivalente manual.
- [x] Reorganizar a `src/client`, `src/worker`, `src/shared` (ver `00 §5`). Alias TS `@client/*`, `@worker/*`, `@shared/*`.
- [x] `wrangler.jsonc`:
  ```jsonc
  {
    "name": "servigo",
    "main": "src/worker/index.ts",
    "compatibility_date": "2026-10-01",
    "compatibility_flags": ["nodejs_compat"],
    "assets": {
      "directory": "./dist/client",
      "not_found_handling": "single-page-application",
      "run_worker_first": ["/*", "!/assets/*"]
    },
    "vars": { "ROOT_DOMAIN": "localhost", "SUPABASE_URL": "http://127.0.0.1:54421" },
    "observability": { "enabled": true }
  }
  ```
  Secretos locales en `.dev.vars` (`SUPABASE_SECRET_KEY`, `TURNSTILE_SECRET_KEY`); plantilla en `.dev.vars.example`.
- [x] Hono en el Worker: `GET /api/health` → `{ ok: true, tenant }`.
- [x] Función `resolveTenant(host, rootDomain, searchParams)` en `src/shared/tenant.ts` con tests (casos de `00 §4`).
- [x] Instalar dependencias base: `react-router`, `@tanstack/react-query`, `@supabase/supabase-js`, `zod`, `react-hook-form`, `@hookform/resolvers`, `date-fns`, `@date-fns/tz`, `hono`.
- [x] Tailwind v4 + `pnpm dlx shadcn@latest init` (estilo *new-york*, base `neutral`, CSS variables). Añadir componentes: button, input, label, card, dialog, sheet, dropdown-menu, select, checkbox, radio-group, switch, tabs, table, badge, toast (sonner), form, popover, calendar, carousel, skeleton, avatar, separator, textarea, tooltip.
- [x] Página temporal que muestra el tenant resuelto.

### 3. Supabase local (Docker Desktop)
- [x] `pnpm supabase init` → `supabase/config.toml`.
- [x] En `config.toml`:
  - `[auth] site_url = "http://localhost:5273"`
  - `additional_redirect_urls = ["http://*.localhost:5273/**", "http://localhost:5273/**"]`
  - `[auth.email] enable_confirmations = false` (local).
  - `[storage] file_size_limit = "2MiB"`.
- [x] `pnpm supabase start` → anotar URL, publishable key y secret key en `.env.local` / `.dev.vars`.
- [x] `src/client/lib/supabase.ts` con `createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)`.
- [x] Studio local en `http://127.0.0.1:54423`, Mailpit (correos locales) en `http://127.0.0.1:54424`.

### 4. Calidad
- [x] ESLint (flat config, `typescript-eslint`, `react-hooks`, `jsx-a11y`) + Prettier (+ `prettier-plugin-tailwindcss`).
- [x] Vitest (`vitest`, `@testing-library/react`, `jsdom`) — test de `resolveTenant`.
- [x] Playwright instalado (los E2E se escriben desde la fase 09).
- [x] Scripts en `package.json`:
  ```json
  {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "deploy": "pnpm build && wrangler deploy",
    "lint": "eslint .",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "e2e": "playwright test",
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:test": "supabase test db",
    "db:types": "supabase gen types typescript --local > src/shared/database.types.ts",
    "cf:types": "wrangler types"
  }
  ```
- [x] `lefthook` o `husky` + `lint-staged` (opcional) para formatear en pre-commit.

### 5. Docker Compose opcional para la app
Supabase ya corre en Docker vía CLI. Para quien prefiera no instalar Node en Windows:
- [x] `docker-compose.yml` con servicio `web` (`node:24-alpine`, monta el repo, `pnpm install && pnpm dev --host 0.0.0.0`, puerto 5273, `extra_hosts: host.docker.internal:host-gateway`, `SUPABASE_URL=http://host.docker.internal:54421`).
- [x] Documentar en README ambas opciones (nativo recomendado por rendimiento de archivos en Windows).

### 6. CI mínima desde el día 1
La CI arranca aquí para que todo el código de las fases siguientes entre validado; la fase 04 la amplía (BD, E2E) y añade el CD.
- [x] `.github/workflows/ci.yml` (en `pull_request` y `push` a `main`): `pnpm/action-setup` + `actions/setup-node` (Node 24, cache pnpm) → `pnpm install --frozen-lockfile` → `lint` → `typecheck` → `test` → `build`.
- [x] `concurrency` por rama con `cancel-in-progress: true` (ahorra minutos del plan Free).
- [ ] Activar la protección de `main` exigiendo el check `ci`.

## Criterios de aceptación

- [x] `pnpm db:start && pnpm dev` levanta todo; `http://demo.localhost:5273` muestra "Tenant: demo" y `http://localhost:5273` muestra "Plataforma".
- [x] `http://demo.localhost:5273/api/health` responde `{ ok: true, tenant: "demo" }`.
- [x] `pnpm lint && pnpm typecheck && pnpm test` pasan.
- [ ] Repo en GitHub con el primer commit y README de arranque.
- [ ] Un PR a `main` ejecuta `ci.yml` y no se puede fusionar si falla.
- [x] `http://demo.localhost:5273/s/cualquier-ruta` (enlace profundo) también pasa por el Worker (se ve el tenant inyectado), no solo `/`.

## Notas de ejecución

- El proyecto se armó a mano (no con `create cloudflare`, que no acepta un directorio con contenido). Versiones: ver `00` D16.
- Puertos propios: app en 5273 y Supabase en 544xx (ver `00` D15).
- shadcn 4 sin `init`: `components.json`, `src/client/lib/utils.ts` y el tema de `index.css` se escribieron a mano. El CLI reescribe el import de `cn` como paquete `"cn"`; hay que corregirlo tras cada `shadcn add` (ver `CLAUDE.md`).
- El `carousel` de shadcn se ajustó para cumplir `react-hooks/set-state-in-effect`.
- `pnpm format:check` también corre en la CI.

## Entregables

Repo con estructura base, `wrangler.jsonc`, `supabase/config.toml`, `.env.example`, `.dev.vars.example`, README, scripts.
