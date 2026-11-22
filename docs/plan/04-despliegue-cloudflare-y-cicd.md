# Fase 04 — Despliegue en Cloudflare y CI/CD

## Objetivo

Publicar Servigo en `https://servigo.roquintech.com` (plataforma) y `https://*.roquintech.com` (empresas) con un único Worker, Supabase en la nube (plan Free), y GitHub Actions que validen cada PR, apliquen migraciones y desplieguen al hacer merge en `main`. Todo en planes gratuitos.

> Conviene ejecutar esta fase justo después de la 03 para que todo lo siguiente se despliegue de forma continua.

## Prerrequisitos

- Fase 03 completa.
- Dominio `roquintech.com` con nameservers apuntando a Cloudflare (zona en plan Free).
- Cuenta Supabase (Free) y repositorio GitHub.

## Tareas

### 1. Supabase producción
- [ ] Crear proyecto `servigo-prod` (región más cercana a los usuarios, p. ej. `us-east-1` o `sa-east-1`). Guardar contraseña de BD en un gestor de contraseñas.
- [ ] (Opcional) proyecto `servigo-staging` — el plan Free permite 2 proyectos activos.
- [ ] Auth → URL Configuration: `Site URL = https://servigo.roquintech.com`; *Redirect URLs*: `https://*.roquintech.com/**`.
- [ ] Auth → deshabilitar registro público (`Allow new users to sign up = off`): solo invitaciones.
- [ ] (Opcional, gratis) SMTP personalizado con Resend Free para que las invitaciones/recuperaciones no se limiten: verificar `mail.roquintech.com` con registros DNS en Cloudflare.
- [ ] `supabase link --project-ref <ref>` y `supabase db push` inicial.
- [ ] Ejecutar seed **mínimo** de producción (solo primer superadmin) — nunca el seed de demo.

### 2. Cloudflare
- [ ] DNS:
  - `A * 192.0.2.1` *proxied* (comodín; IP ficticia, el Worker responde la ruta; permitido y gratuito en el plan Free). Lo comparten todos los productos de Roquintech.
  - `A @` / `www`: los gestiona la web corporativa de Roquintech (fuera de alcance). Mientras no exista, una *Redirect Rule* gratuita de Cloudflare envía `roquintech.com` → `https://servigo.roquintech.com`.
  - La zona `roquintech.com` es compartida: cualquier cambio de DNS, SSL o reglas afecta a todos los productos. Documentarlo en el runbook.
- [ ] SSL/TLS → modo **Full (strict)**; *Always Use HTTPS* activado; HSTS tras validar.
- [ ] Universal SSL cubre `roquintech.com` y `*.roquintech.com` (un nivel). No usar sub-subdominios (`a.b.roquintech.com`).
- [ ] `wrangler.jsonc` → entorno `production`:
  ```jsonc
  "env": {
    "production": {
      "routes": [
        { "pattern": "*.roquintech.com/*", "zone_name": "roquintech.com" }
      ],
      "vars": { "ROOT_DOMAIN": "roquintech.com", "PLATFORM_SUBDOMAIN": "servigo", "SUPABASE_URL": "https://<ref>.supabase.co" }
    }
  }
  ```
  Un producto futuro de Roquintech declara su propia route específica (`otroproducto.roquintech.com/*`), que gana sobre el comodín de Servigo, y su nombre se inserta antes en `reserved_slugs`.
- [ ] Secretos: `wrangler secret put SUPABASE_SECRET_KEY --env production`, `TURNSTILE_SECRET_KEY`.
- [ ] Turnstile: crear widget (modo *Managed*) con dominios `roquintech.com` (cubre subdominios). Site key como variable pública `VITE_TURNSTILE_SITE_KEY`.
- [ ] Rate limiting binding en `wrangler.jsonc` (`"ratelimits"` / `unsafe.bindings` según versión vigente de Wrangler) para `/api/bookings/*`: 10 req/min por IP para crear, 20 req/min para buscar.
- [ ] Reglas de caché: assets con hash `max-age=31536000, immutable`; `index.html` `no-cache`.
- [ ] Imágenes: **sin** proxy en el Worker (ver `00` D14). Verificar que las URLs públicas de `media` respondan con `Cache-Control: max-age=31536000` y que la CSP de producción incluya el host de Supabase en `img-src`.

### 3. GitHub Actions
- [ ] Ampliar `ci.yml` (creado en fase 01 con install, `lint`, `typecheck`, `test`, `build`):
  - Job `db`: `supabase start` (Docker disponible en runners Ubuntu), `supabase db reset`, `supabase test db`, `supabase db lint`.
  - Job `e2e` (desde fase 09): Playwright contra `wrangler dev` + Supabase local.
- [ ] `deploy.yml` (push a `main`, con `environment: production` y aprobación manual opcional):
  1. `supabase db push` (secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`).
  2. `pnpm build` con `VITE_*` de producción.
  3. `wrangler deploy --env production` (secret `CLOUDFLARE_API_TOKEN` con permisos *Workers Scripts:Edit*, *Workers Routes:Edit*, `CLOUDFLARE_ACCOUNT_ID`).
  4. Smoke test: `curl https://demo.roquintech.com/api/health`.
- [ ] `keepalive.yml`: cron `0 12 * * 1,4` → `curl` a `/api/health?db=1` (llama `ping()`), evita la pausa por inactividad de Supabase Free.
- [ ] `backup.yml`: cron semanal → `supabase db dump --data-only` y `--schema` → `gzip` → cifrado con `age` (destinatario = clave pública en `secrets`/repo; la privada nunca en GitHub) → artefacto (retención 90 días). Sin cifrar **no**: el repo es público (`00` D17). Documentar restauración en `docs/runbook.md`.
- [ ] Dependabot para npm y GitHub Actions (mensual).
- [ ] Proteger `main`: requerir `ci` verde y 1 aprobación (o solo CI si es un único desarrollador).

### 4. Previews
- [ ] Opcional: `wrangler versions upload` en PR → URL de preview `*.workers.dev` usando `?tenant=demo` y Supabase staging.

### 5. Runbook
- [ ] `docs/runbook.md`: cómo desplegar, revertir (`wrangler rollback`), restaurar backup, rotar secretos, crear superadmin, dar de alta empresa, ver logs (`wrangler tail` / Observability).

## Criterios de aceptación

- [ ] `https://servigo.roquintech.com` muestra la landing de Servigo; `https://servigo.roquintech.com/console` la consola superadmin; `https://www.roquintech.com` redirige a `roquintech.com`; `https://<empresa>.roquintech.com` el sitio de la empresa, todos con candado TLS válido.
- [ ] Un PR con un test roto bloquea el merge.
- [ ] Merge a `main` aplica migraciones y despliega sin intervención.
- [ ] Workflow de backup genera un artefacto cifrado que solo se puede abrir con la clave privada (probar restauración en local).
- [ ] Factura de Cloudflare, Supabase y GitHub: **0 USD**. Revisar que no se activó ningún add-on.
