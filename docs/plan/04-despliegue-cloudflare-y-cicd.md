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
- [x] Crear proyecto `servigo-prod` (región más cercana a los usuarios, p. ej. `us-east-1` o `sa-east-1`). Guardar contraseña de BD en un gestor de contraseñas.
- [ ] (Opcional) proyecto `servigo-staging` — el plan Free permite 2 proyectos activos.
- [x] Auth → URL Configuration: `Site URL = https://servigo.roquintech.com`; *Redirect URLs*: `https://*.roquintech.com/**`.
- [x] Auth → deshabilitar registro público (`Allow new users to sign up = off`): solo invitaciones.
- [x] (Opcional, gratis) SMTP personalizado con Resend Free para que las invitaciones/recuperaciones no se limiten: verificar `mail.roquintech.com` con registros DNS en Cloudflare.
- [x] `supabase link --project-ref <ref>` y `supabase db push` inicial.
- [ ] Ejecutar seed **mínimo** de producción (solo primer superadmin) — nunca el seed de demo.

### 2. Cloudflare
- [x] DNS:
  - `A * 192.0.2.1` *proxied* (comodín; IP ficticia, el Worker responde la ruta; permitido y gratuito en el plan Free). Lo comparten todos los productos de Roquintech.
  - `A @` / `www`: los gestiona la web corporativa de Roquintech (fuera de alcance). Mientras no exista, una *Redirect Rule* gratuita de Cloudflare envía `roquintech.com` → `https://servigo.roquintech.com`.
  - La zona `roquintech.com` es compartida: cualquier cambio de DNS, SSL o reglas afecta a todos los productos. Documentarlo en el runbook.
- [x] SSL/TLS → modo **Full (strict)**; *Always Use HTTPS* activado; HSTS tras validar.
- [x] Universal SSL cubre `roquintech.com` y `*.roquintech.com` (un nivel). No usar sub-subdominios (`a.b.roquintech.com`).
- [x] `wrangler.jsonc` → entorno `production`:
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
- [x] Secretos: `wrangler secret put SUPABASE_SECRET_KEY --env production`, `TURNSTILE_SECRET_KEY`.
- [x] Turnstile: crear widget (modo *Managed*) con dominios `roquintech.com` (cubre subdominios). Site key como variable pública `VITE_TURNSTILE_SITE_KEY`.
- [x] Rate limiting binding en `wrangler.jsonc` (`"ratelimits"` / `unsafe.bindings` según versión vigente de Wrangler) para `/api/bookings/*`: 10 req/min por IP para crear, 20 req/min para buscar.
- [x] Reglas de caché: assets con hash `max-age=31536000, immutable`; `index.html` `no-cache`.
- [ ] Imágenes: **sin** proxy en el Worker (ver `00` D14). Verificar que las URLs públicas de `media` respondan con `Cache-Control: max-age=31536000` y que la CSP de producción incluya el host de Supabase en `img-src`.

### 3. GitHub Actions
- [x] Ampliar `ci.yml` (creado en fase 01 con install, `lint`, `typecheck`, `test`, `build`):
  - Job `db`: `supabase start` (Docker disponible en runners Ubuntu), `supabase db reset`, `supabase test db`, `supabase db lint`.
  - Job `e2e` (desde fase 09): Playwright contra `wrangler dev` + Supabase local.
- [x] `deploy.yml` (push a `main`, con `environment: production` y aprobación manual opcional):
  1. `supabase db push` (secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`).
  2. `pnpm build` con `VITE_*` de producción.
  3. `wrangler deploy --env production` (secret `CLOUDFLARE_API_TOKEN` con permisos *Workers Scripts:Edit*, *Workers Routes:Edit*, `CLOUDFLARE_ACCOUNT_ID`).
  4. Smoke test: `curl https://demo.roquintech.com/api/health`.
- [x] `keepalive.yml`: cron `0 12 * * 1,4` → `curl` a `/api/health?db=1` (llama `ping()`), evita la pausa por inactividad de Supabase Free.
- [x] `backup.yml`: cron semanal → `supabase db dump --data-only` y `--schema` → `gzip` → cifrado con `age` (destinatario = clave pública en `secrets`/repo; la privada nunca en GitHub) → artefacto (retención 90 días). Sin cifrar **no**: el repo es público (`00` D17). Documentar restauración en `docs/runbook.md`.
- [x] Dependabot para npm y GitHub Actions (mensual).
- [x] Proteger `main`: requerir `ci` verde y 1 aprobación (o solo CI si es un único desarrollador).

### 4. Previews
- [ ] Opcional: `wrangler versions upload` en PR → URL de preview `*.workers.dev` usando `?tenant=demo` y Supabase staging.

### 5. Runbook
- [x] `docs/runbook.md`: cómo desplegar, revertir (`wrangler rollback`), restaurar backup, rotar secretos, crear superadmin, dar de alta empresa, ver logs (`wrangler tail` / Observability).

## Criterios de aceptación

- [ ] `https://servigo.roquintech.com` muestra la landing de Servigo; `https://servigo.roquintech.com/console` la consola superadmin; `https://www.roquintech.com` redirige a `roquintech.com`; `https://<empresa>.roquintech.com` el sitio de la empresa, todos con candado TLS válido.
- [ ] Un PR con un test roto bloquea el merge.
- [x] Merge a `main` aplica migraciones y despliega sin intervención.
- [ ] Workflow de backup genera un artefacto cifrado que solo se puede abrir con la clave privada (probar restauración en local).
- [ ] Factura de Cloudflare, Supabase y GitHub: **0 USD**. Revisar que no se activó ningún add-on.

## Notas de ejecución

- **Cuentas** (hechas por la persona dueña de las cuentas, 23–24 nov. 2026):
  - Zona `roquintech.com` activa en Cloudflare, compartida con Microsoft 365 y con el Custom Domain `monicarobles` (D21).
  - Proyecto Supabase `servigo` (ref `pkrwxmsqibjmmpzmswzm`, East US).
  - Resend verificado en `mail.roquintech.com`.
  - Turnstile.
  - Tokens:
    - Cloudflare: plantilla *Edit Cloudflare Workers*, 1 año.
    - Supabase: con alcance al proyecto, 1 año (permisos en `docs/runbook.md` §10).
  - Entorno `production` en GitHub, con despliegue limitado a `main`.
  - Protección de `main`.
- **Cambios respecto al plan:**
  - **Secretos del Worker.** No se usa `wrangler secret put`: los secretos viven en el entorno `production` de GitHub y `deploy` los sube con `wrangler deploy --secrets-file` (D20). Con el plugin de Vite, el entorno se elige al compilar (`CLOUDFLARE_ENV=production`) y `wrangler deploy` no acepta `--env`. El Worker se llama `servigo-production`, sin `workers.dev`. Se quitó el script `pnpm deploy`.
  - **Disparo del despliegue.** `deploy` corre por `workflow_run` cuando `ci` termina en verde, y despliega el commit exacto que validó la CI.
  - **Smoke test.** No usa `demo.roquintech.com`, porque en producción no hay seed. Comprueba cuatro cosas:
    - `/api/health?db=1` en la plataforma, que valida la publishable key;
    - la landing;
    - la salud de un subdominio inexistente;
    - el 404 de ese subdominio, que valida la secret key.
  - **Cabeceras de caché.** Las de `/assets/*` salen de `public/_headers` (Workers Static Assets). El HTML ya salía con `no-cache` y `vary: Host` desde la fase 03. Ambas cosas se verificaron con `vite preview`.
  - **Rate limiting.** Los bindings `BOOKING_CREATE_LIMITER` (10/min) y `BOOKING_LOOKUP_LIMITER` (20/min) quedan declarados en local y en producción; se aplican en las rutas de reservas en la fase 10.
  - **Job `db` de la CI.** Ejecuta, sobre Supabase local sin los servicios que no hacen falta:
    - `db reset` y `test db`;
    - `db lint --fail-on error`;
    - una comprobación de que `database.types.ts` está al día.
  - **Backups.**
    - Se vuelcan `roles.sql`, `schema.sql` y `data.sql` (`--use-copy`), sin `storage.buckets_vectors` ni `storage.vector_indexes`, que `postgres` no puede escribir al restaurar. Se cifran con `age` y se suben 90 días.
    - Ciclo probado en local: volcado, cifrado, descifrado, `db reset --no-seed`, carga con `session_replication_role = replica` y verificación. Los conteos coinciden (5 usuarios, 2 empresas, 20 reservas) y el login funciona.
    - Los archivos de Storage no entran en el backup (`docs/runbook.md` §8).
  - **Slugs reservados.** Migración `reserve_existing_subdomains` con `monicarobles`, `enterpriseenrollment`, `enterpriseregistration`, `lyncdiscover`, `sip` y `msoid`, más su test pgTAP: 183 asserts en total.
  - **Dominio raíz.** `roquintech.com` y `www` van a `servigo.roquintech.com` con una *Redirect Rule* (no a `roquintech.com`, que aún no existe).
- **Primer despliegue (24-nov-2026):**
  - `deploy` aplicó las 14 migraciones, publicó `servigo-production` y pasó el smoke test, tras la aprobación manual del entorno (*Required reviewers*, activado a propósito).
  - **Incidente:** la ruta `*.roquintech.com/*` capturó `monicarobles.roquintech.com`, que solo tenía Custom Domain. Un Custom Domain **no** gana sobre una ruta comodín. Se resolvió añadiendo la ruta `monicarobles.roquintech.com/*` → `photo-monica-robles`, y ahora el smoke test vigila esos hosts (`FOREIGN_HOSTS`).
  - La *Redirect Rule* tenía dos condiciones unidas con `and`, así que nunca se cumplía; se dejó una sola condición con los dos hosts.
- **Pendiente tras el primer despliegue:**
  - el primer superadmin (`docs/runbook.md` §6);
  - los criterios de aceptación;
  - HSTS.
- **Pendiente en otras fases:** `Cache-Control` de las imágenes de `media` y CSP. Se verifican cuando exista la subida de imágenes (fase 05) y las cabeceras de seguridad (fase 13).
- **Omitidos (opcionales):** proyecto staging y previews por PR.
