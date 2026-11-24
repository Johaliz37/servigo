# Runbook de producción

Operación diaria de Servigo en producción. Las decisiones de fondo están en [plan/00](plan/00-arquitectura-y-decisiones.md) y el montaje inicial en [plan/04](plan/04-despliegue-cloudflare-y-cicd.md).

Los comandos son para Git Bash o PowerShell, desde la raíz del repo, salvo que se indique otra cosa.

## 1. Mapa

| Pieza                   | Dónde                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Plataforma              | `https://servigo.roquintech.com` (landing) y `/console` (superadmin)                  |
| Empresas                | `https://{slug}.roquintech.com` y `/admin`                                            |
| Worker                  | Cloudflare → Workers & Pages → **`servigo-production`**, ruta `*.roquintech.com/*`    |
| Base de datos y Auth    | Supabase, proyecto `servigo` (ref `pkrwxmsqibjmmpzmswzm`, plan Free)                  |
| Correo saliente         | Resend, dominio `mail.roquintech.com` → SMTP de Supabase Auth                         |
| Antibots                | Cloudflare Turnstile, widget `Servigo` (hostname `roquintech.com`)                    |
| CI/CD                   | GitHub Actions: `ci`, `deploy`, `keepalive`, `backup`; entorno `production`           |
| Clave privada de backup | Solo en el gestor de contraseñas («Servigo – clave de backups (age)»). Nunca en GitHub |

### Secretos y variables

Todo vive en GitHub → Settings → Environments → `production`, salvo `BACKUP_AGE_RECIPIENT`, que es una variable del repositorio. Los secretos del Worker los sube `deploy` en cada despliegue, con `wrangler deploy --secrets-file`. **No** se usa `wrangler secret put`: lo que se cambie a mano en Cloudflare se pisa en el siguiente despliegue.

| Nombre                          | Tipo     | Para qué                                     | Dónde se genera                                                   |
| ------------------------------- | -------- | -------------------------------------------- | ----------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`          | secreto  | Desplegar el Worker                          | Cloudflare → Manage account → Account API tokens (expira 1 año)   |
| `CLOUDFLARE_ACCOUNT_ID`         | variable | Cuenta de Cloudflare                         | Cloudflare → Overview del dominio                                 |
| `SUPABASE_ACCESS_TOKEN`         | secreto  | CLI: migraciones y backups                   | Supabase → Account → Access Tokens (expira 23-nov-2027)           |
| `SUPABASE_DB_PASSWORD`          | secreto  | Conexión a Postgres                          | Supabase → Project Settings → Database → Reset password           |
| `SUPABASE_PROJECT_REF`          | variable | Proyecto (solo el ref, sin URL)              | URL del panel de Supabase                                         |
| `SUPABASE_SECRET_KEY`           | secreto  | Worker: lecturas por slug, invitaciones      | Supabase → Project Settings → API Keys → Secret keys              |
| `TURNSTILE_SECRET_KEY`          | secreto  | Worker: validar Turnstile (fase 10)          | Cloudflare → Application security → Turnstile → Servigo           |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | variable | Cliente y Worker (`SUPABASE_PUBLISHABLE_KEY`) | Supabase → Project Settings → API Keys → Publishable key          |
| `VITE_TURNSTILE_SITE_KEY`       | variable | Widget de Turnstile en el navegador          | Turnstile → Servigo                                               |
| `BACKUP_AGE_RECIPIENT`          | variable | Clave pública que cifra los backups          | `age-keygen` (ver §8)                                             |

`SUPABASE_URL` no es un secreto: está en `wrangler.jsonc` (`env.production.vars`) y `deploy` verifica que coincida con `SUPABASE_PROJECT_REF`.

## 2. Desplegar

- **Automático**: al fusionar un PR en `main`, `ci` corre sobre el commit. Si queda en verde, `deploy` hace, en este orden:
  1. `supabase db push`: aplica las migraciones nuevas. Nunca carga el seed.
  2. `CLOUDFLARE_ENV=production pnpm build`.
  3. `wrangler deploy` con los secretos.
  4. Un smoke test contra `servigo.roquintech.com`.
- **Manual**, para volver a desplegar `main` (por ejemplo tras rotar un secreto): GitHub → Actions → **deploy** → _Run workflow_, o bien:

  ```sh
  gh workflow run deploy --ref main
  gh run watch
  ```

- Nunca despliegues desde tu máquina. Con el plugin de Vite, `wrangler deploy` sin `CLOUDFLARE_ENV=production` publicaría la configuración local.

Si falla un paso, el job se detiene: si fallan las migraciones no se despliega el Worker, y si falla el smoke test el Worker nuevo ya está publicado. En ese caso, ver §3.

## 3. Revertir

**Worker** (código). Vuelve a la versión anterior en segundos:

- Cloudflare → Workers & Pages → `servigo-production` → **Deployments** → en la versión buena, **Rollback**.
- O desde la terminal, tras `pnpm exec wrangler login`:

  ```sh
  pnpm exec wrangler deployments list --name servigo-production
  pnpm exec wrangler rollback --name servigo-production            # a la anterior
  pnpm exec wrangler rollback <version-id> --name servigo-production
  ```

Después, revierte también el commit en `main` con un PR. Si no, el siguiente despliegue vuelve a publicar el código malo.

**Base de datos**. Las migraciones no se revierten: se corrige con una migración nueva, hacia adelante, en un PR. Nunca se edita una migración ya aplicada. Si hubo pérdida de datos, ver §8.

## 4. Logs y diagnóstico

- Cloudflare → `servigo-production` → **Observability**: logs y errores, con 3 días de retención en Free.
- En vivo:

  ```sh
  pnpm exec wrangler tail servigo-production --format pretty
  ```

- Supabase → Logs: Postgres, Auth (correos enviados y fallidos) y API.
- Resend → Emails: entregas, rebotes y spam.
- Salud del Worker y de la BD: `https://servigo.roquintech.com/api/health?db=1`.

## 5. Rotar secretos

1. Genera el valor nuevo en el servicio (columna «Dónde se genera» de §1).
2. Cárgalo en GitHub. Te pide el valor sin mostrarlo:

   ```sh
   gh secret set NOMBRE --env production
   ```

3. Si el Worker usa ese secreto (`SUPABASE_SECRET_KEY`, `TURNSTILE_SECRET_KEY`), vuelve a desplegar (§2, manual).
4. Revoca el valor viejo en el servicio y verifica `/api/health?db=1`.

Casos concretos:

- **Contraseña de la BD**: Supabase → Project Settings → Database → _Reset database password_, y después `gh secret set SUPABASE_DB_PASSWORD --env production`.
- **Token de Cloudflare** (expira al año): crea uno nuevo con la misma plantilla (_Edit Cloudflare Workers_, sin filtro de IP), cárgalo y borra el viejo.
- **Token de Supabase** (expira el 23-nov-2027): mismos permisos que el actual (ver §10).
- **Clave de backup**: genera un par nuevo (§8), actualiza `BACKUP_AGE_RECIPIENT` y **conserva la clave privada vieja** mientras haya backups cifrados con ella (90 días).

## 6. Superadmin y alta de empresas

**Crear un superadmin.** El registro público está cerrado.

1. Supabase → Authentication → Users → _Add user → Create new user_: correo, contraseña y _Auto Confirm User_.
2. En el SQL Editor:

   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'operador@ejemplo.com';
   ```

3. Entra en `https://servigo.roquintech.com/console/login`.

**Dar de alta una empresa.** En `/console` → _Nueva empresa_. Se crea la sede principal y se invita al owner por correo. El enlace dura 24 h; si caduca, usa _Reenviar invitación_ en la lista.

**Suspender o reactivar.** Desde la lista de `/console`. El cambio es inmediato: se purga la caché del tenant.

## 7. Keep-alive (Supabase Free)

`keepalive` llama a `/api/health?db=1` lunes y jueves. Supabase pausa un proyecto Free tras 7 días sin actividad.

- **GitHub desactiva los cron** de un repo público tras **60 días sin commits**. Los PR mensuales de Dependabot suelen evitarlo. Si llega el aviso por correo, entra en Actions → `keepalive` → _Enable workflow_.
- Si el proyecto se pausó: Supabase → proyecto → **Restore project**. Tarda unos minutos y conserva los datos.

## 8. Backups

`backup` corre los domingos a las 07:00 UTC, y a mano con _Run workflow_. Hace tres volcados:

- `roles.sql`
- `schema.sql`
- `data.sql`: incluye `auth.users`, todo `public` y los metadatos de Storage.

Los comprime, los **cifra con `age`** y los guarda como artefacto 90 días.

**No incluye los archivos de Storage** (imágenes del bucket `media`), solo sus filas. Si se pierden, las empresas vuelven a subirlas.

### Descargar y descifrar

Necesitas `age` (`winget install FiloSottile.age`) y la clave privada del gestor de contraseñas.

```sh
gh run list --workflow backup --limit 5                         # elige el run
gh run download <run-id> --dir backup                           # baja servigo-AAAAMMDD-HHMM.tar.gz.age
# Pega la nota del gestor en un archivo temporal (fuera del repo):
age -d -i ~/servigo-backup.key backup/*/servigo-*.tar.gz.age | tar -xzf - -C backup
rm ~/servigo-backup.key                                         # no dejes la clave en disco
```

Quedan `backup/roles.sql`, `backup/schema.sql` y `backup/data.sql`. Contienen **datos personales**: no los subas al repo y bórralos al terminar.

### Restaurar

Procedimiento probado en la fase 04. Las migraciones crean el esquema y el backup aporta los datos.

1. **Base destino con el esquema al día**:
   - **En producción**, si el proyecto se perdió: crea un proyecto nuevo, actualiza `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, las claves y `SUPABASE_URL` en `wrangler.jsonc`, y ejecuta `deploy`, que aplica las migraciones.
   - **En local**, para un simulacro: `pnpm exec supabase db reset --no-seed`.
2. **Cargar los datos**. Desactiva triggers y FKs durante la carga y vacía antes las dos tablas que las migraciones ya rellenan:

   ```sh
   { echo '\set ON_ERROR_STOP on'; echo 'begin;'; echo 'set session_replication_role = replica;'
     echo 'truncate public.reserved_slugs; delete from storage.buckets;'
     cat backup/data.sql; echo 'commit;'; } > backup/restore.sql
   ```

   - **Local**:

     ```sh
     docker exec -i supabase_db_servigo psql -U postgres -d postgres < backup/restore.sql
     ```

   - **Producción**: usa la cadena de Supabase → **Connect** → _Session pooler_. Funciona con IPv4.

     ```sh
     docker run --rm -i -e PGPASSWORD postgres:17 psql "postgresql://postgres.<ref>@<host-del-pooler>:5432/postgres" < backup/restore.sql
     ```

     Define antes `PGPASSWORD` con la contraseña de la BD. En PowerShell: `$env:PGPASSWORD = Read-Host`.

3. Verifica:
   - Conteos (`select count(*) from public.companies;`, `auth.users`, `public.bookings`).
   - Inicio de sesión de un usuario.
   - `/api/health?db=1`.
4. Si `ON_ERROR_STOP` corta por un `permission denied` en una tabla interna nueva de Supabase, añádela al `-x` de `backup.yml`. Ese backup se carga quitando su bloque `COPY … \.` de `data.sql`.

Haz un simulacro local cada pocos meses para confirmar que la clave privada sigue abriendo los backups.

### Generar un par de claves nuevo

```sh
age-keygen -o servigo-backup.key      # imprime "Public key: age1…"
gh variable set BACKUP_AGE_RECIPIENT --body "age1…"
```

Guarda el contenido de `servigo-backup.key` en el gestor y borra el archivo.

## 9. Zona DNS compartida (`roquintech.com`)

La zona la comparten todos los productos de Roquintech y el correo corporativo. **Cualquier cambio de DNS, SSL o reglas afecta a todos.**

| Registro                                                                    | Uso                                                  | No tocar                                               |
| --------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `A *`, `A @` y `A www` → `192.0.2.1` (Proxied)                              | Comodín de Servigo; IP ficticia, responde el Worker  | No apagar el proxy                                     |
| MX, TXT SPF raíz, `autodiscover`, `enterpriseenrollment`, `enterpriseregistration` | Microsoft 365 (correo de Roquintech)                 | Sí: es el correo corporativo                           |
| `resend._domainkey.mail`, `send.mail`, `rsend.mail`                         | Resend (correos de Servigo)                          | Sin ellos no salen invitaciones                        |
| `_dmarc`                                                                    | DMARC `p=none`                                       | Endurecer solo tras revisar informes                   |
| `monicarobles` (Worker)                                                     | Otro sitio, como Custom Domain                       | Gana sobre el comodín                                  |

- **Redirect Rule** «apex y www a servigo»: `roquintech.com` y `www.roquintech.com` → `https://servigo.roquintech.com` (301). Se quita cuando exista la web corporativa.
- **SSL/TLS** en _Full (strict)_ y _Always Use HTTPS_. HSTS se activa cuando todo esté estable (6 meses, _Include subdomains_). Es difícil de deshacer.
- **Producto o sitio nuevo en un subdominio**:
  1. Comprueba que ninguna empresa use ese slug: `select 1 from companies where slug = 'x'`.
  2. Reserva el nombre con una migración: `insert into reserved_slugs (slug, reason) values ('x', 'roquintech_product')`.
  3. Crea su ruta específica o su Custom Domain.
- Universal SSL cubre un solo nivel: `a.roquintech.com` sí, `a.b.roquintech.com` no.

## 10. Configuración que no está en el repo

`supabase/config.toml` solo aplica en local. En el panel de Supabase de producción hay que mantener a mano:

- **Authentication → URL Configuration**: _Site URL_ `https://servigo.roquintech.com`; _Redirect URLs_ `https://*.roquintech.com/**`.
- **Sign In / Providers**:
  - _Allow new users to sign up_: **off**.
  - Contraseña mínima: 8.
  - _Email OTP Expiration_: 86400 (24 h).
- **Emails → SMTP**:
  - Host `smtp.resend.com`, puerto 465, usuario `resend`, contraseña = API key de Resend.
  - Remitente `no-reply@mail.roquintech.com`.
- **Emails → Templates**: _Invite_, _Magic Link_ y _Reset Password_ con el contenido de `supabase/templates/*.html` y los asuntos de `config.toml`. Si cambias una plantilla en el repo, cópiala aquí.
- **Rate Limits**: emails por hora en 30.
- **Token de CI (`github-servigo`)**:
  - lectura y escritura: _Database_ y _Migrations_;
  - lectura: _Project Settings_, _Advisors_, _API Keys_, _Auth Config_, _Data API Config_, _Database Config_, _Connection Pooling_ y _Storage Config_.

  Si el CLI pide otro permiso, por ejemplo _Production Branches: Read_, edita el token.

En GitHub, la rama `main` está protegida:

- PR obligatorio;
- checks `ci` y `db`;
- historial lineal;
- sin force push ni borrado.

## 11. Costo 0

Revisión mensual:

- Cloudflare → Billing.
- Supabase → Organization → Billing: plan Free, sin _add-ons_ ni _compute_ extra.
- Resend → Usage: menos de 3 000 al mes.
- GitHub → Settings → Billing.

Si algo aparece con importe, se desactiva antes de seguir.
