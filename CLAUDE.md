# CLAUDE.md — Contexto del proyecto

> Este archivo lo lee Claude Code automáticamente al abrir la carpeta. Es el mapa del proyecto:
> qué es, cómo está armado HOY, qué se decidió y qué trampas ya conocemos. Si algo acá contradice
> al código, manda el código (y hay que corregir este archivo).

## Objetivo

Auto-hospedar **AsTeRICS Grid** (app de Comunicación Aumentativa y Alternativa, open source,
AGPL-3.0) en una versión **congelada y estable** para los usuarios de Ébano Soluciones (~100/año),
para que las actualizaciones del upstream no rompan lo que usan personas reales. Se actualiza a
mano, solo cuando una versión nueva esté probada.

- Upstream: https://github.com/asterics/AsTeRICS-Grid — release pineado `release-2026-06-03-09.11/+0200`
- Este repo (público, por AGPL): https://github.com/Tatobregon/GridEbano

## Fase actual

- **Local (PC Windows + Docker Desktop + Git Bash):** entorno de pruebas, expuesto con Tailscale
  Funnel. Sin Caddy.
- **Producción:** migrando a un **Cloud Server de DonWeb** (Ubuntu 24.04) con dominio propio y HTTPS
  vía Caddy. La guía paso a paso es `docs/runbook-prod.md`.

La **app que ven los usuarios quedó como se quiere** (branding, reloj de dwell, solo-login, tableros
propios). Los cambios de infraestructura no deben alterar ese comportamiento visible.

## Arquitectura (igual en local y en prod)

```
Navegador ──HTTPS──► [Caddy (solo prod) | Tailscale Funnel (local)] ──► nginx (servicio frontend, :80)
   nginx = puerta única, same-origin:
     /                          → build estático de AsTeRICS Grid + mirror de tableros /Asterics-AAC-Data/
     /auth/login|logout|logout-all|refresh → couch-auth:3000   (resto de /auth/ → 404)
     /admin/*, /crear-usuario-ebano-soluciones → panel de alta de usuarios (couch-auth)
     /couchdb/<base de usuario> → couchdb:5984   (/couchdb/_* → 404: sin Fauxton ni _session públicos)
     /user/*, /api/*, /.git, /node_modules → 404
```

Servicios en `docker-compose.yml` (proyecto con `name: asterics-grid` fijo):
- **couchdb** (couchdb:3.4) — una base por usuario (`asterics-grid-data$<hash>`), volumen
  `asterics-grid_couchdb-data`. Puerto solo en 127.0.0.1:5984.
- **couch-auth** (node:22, `superlogin/start.js` del upstream + patches) — login, crea las bases de
  usuario. 127.0.0.1:3000.
- **frontend** (nginx:stable-alpine) — app + reverse proxy. 127.0.0.1:9095.
- **caddy** (caddy:2, **perfil `prod`**) — HTTPS automático. Solo arranca con `COMPOSE_PROFILES=prod`
  en el `.env` (el server). Puertos públicos 80/443.

Configuración por entorno en `.env` (no versionado; plantilla en `.env.example`):
`COUCHDB_PASSWORD`, `REGISTER_SECRET`, `ADMIN_UI_PASSWORD` (solo letras y números: van dentro de
URLs), `AUTH_BASE_URL` (https://dominio, sin barra final; se HORNEA en el bundle), `ASTERICS_VERSION`,
y en prod `COMPOSE_PROFILES=prod`, `SITE_DOMAIN`, `ACME_EMAIL`, `RCLONE_DESTINO`, `BACKUP_PING_URL`.
`DB_SERVER_PUBLIC_URL` ya no va en el `.env`: el compose la arma como `${AUTH_BASE_URL}/couchdb/`.

## Decisiones tomadas (no re-litigar sin avisar al usuario)

1. **Modo online** con sync (respaldo del lado servidor), no solo-offline.
2. **Cuentas creadas solo por el admin** (panel web o `scripts/crear-usuario.sh`). Registro público
   bloqueado en couch-auth (guard con `X-Register-Secret`, fail-closed) y en nginx.
3. **Sin email/SMTP** (`start.js` ya trae `sendConfirmEmail: false`).
4. **Política de contraseñas "admin custodia"**: el admin guarda las contraseñas de los usuarios en
   un gestor (ver `docs/politica-contrasenas.md`).
5. **Backups en dos capas:** cron nocturno (00:30) con `backup.sh --consistente` → `.tgz` del volumen
   de CouchDB en `backups/` (14 días), y las **Copias de Seguridad de DonWeb** (plan Premium Diario,
   30 copias del server entero en infraestructura separada) se llevan esos `.tgz`. `backup-offsite.sh`
   (rclone) queda para la PC o para copiar a otro proveedor.
6. **Versión congelada**: tag del upstream + commit de tableros (`BOARDS_COMMIT`) + dependencias
   congeladas en `locks/` (se instalan con `npm ci`).

## Modificaciones al upstream (todas en tiempo de build, sin fork)

`Dockerfile.frontend` (cada `sed` va seguido de un `grep -q` que hace fallar el build si no aplicó;
los patches `.js` abortan si no encuentran su ancla):
1. `loginService.js`: URL de login de la fundación → `AUTH_BASE_URL`.
2. `constants.js` + `boardService.js`: tableros → `/Asterics-AAC-Data/` (mirror propio, same-origin).
3. `pouchDbAdapter.js`: `retry: false` → `retry: true`. **Efecto conocido:** con el server caído el
   ícono de la nube puede quedar en verde (PouchDB informa la falla como `paused`). Pendiente de
   decisión del usuario; no cambiar sin avisar.
4. `serviceWorker.js`: `APP_CACHE_NAME` versionado con `ASTERICS_VERSION` → **al cambiar el frontend,
   subir `ASTERICS_VERSION`**.
5. Placeholders de entorno → `PROD` + versión.
6. Patches JS (`scripts/patch-*.js`): link a la fuente en "Acerca de" (AGPL), limpieza del SW,
   neutralización de podcast/CORS-proxy de la fundación, UI solo-login (sin registro ni usuario
   offline), reloj de dwell en hovering, branding EBANO, quitar "Acerca de" y "Ayuda" del menú.
7. `node_modules/` y `.git/` se borran antes de copiar al nginx (no se publican).

`Dockerfile.couchauth`: `patch-couchauth.js` (guard de registro) y `patch-admin-endpoints.js`
(`/admin/verificar` y `/admin/crear-usuario`; el hash de la contraseña replica al de la app:
`sha256('STATIC_USER_PW_SALT' + clave)`). Runtime en `node:22-bookworm-slim`, usuario `node`.

## Trampas conocidas (ya resueltas; no reintroducir)

- **Vista `view-usernames` en `auth-users` es obligatoria**: sin ella couch-auth crashea en loop.
  La crea `scripts/arrancar.sh`.
- **Usuarios creados sin el hash de la app no pueden entrar.** Crear solo con el panel o el script.
- **`name: asterics-grid` en el compose**: los scripts de backup/restore usan el volumen
  `asterics-grid_couchdb-data`. Sin el nombre fijo, el volumen dependía de la carpeta y el backup
  salía vacío.
- **`docker.ini` se monta SIN `:ro`** (el entrypoint de couchdb hace chown y con `:ro` muere sin logs)
  y como `00-custom.ini` (así CouchDB no escribe el hash del admin en nuestro archivo).
- **nginx cachea las IPs internas**: si se recrea couch-auth/couchdb, reiniciar `frontend`
  (`arrancar.sh` ya lo hace).
- **Scripts**: comparten `scripts/lib.sh`; andan en Git Bash (Windows) y en Linux. En Windows hace
  falta `MSYS_NO_PATHCONV=1` (lo exporta `lib.sh`) y `docker compose` con `cd` en vez de `-f`.
  Tienen que estar commiteados como ejecutables (`git update-index --chmod=+x scripts/*.sh`).
- **Cifrado**: la clave de cifrado de los datos se deriva del mismo hash que la app manda al login,
  así que NO es E2E frente a quien opera el servidor. No prometer eso a clientes.
- **Restore** (`restore.sh`) restaura TODO el volumen; no sirve para recuperar lo que borró un solo
  usuario (su dispositivo re-sube el borrado). Pendiente: script de restore por usuario.

## Archivos

```
docker-compose.yml        stack (couchdb, couch-auth, frontend, caddy[prod])
Dockerfile.frontend       build del frontend con todas las modificaciones
Dockerfile.couchauth      couch-auth + patches
caddy/Caddyfile           HTTPS de producción
nginx/default.conf        puerta única: proxy, lista blanca de rutas, headers, rate limits, IP real
nginx/admin-crear-usuario.html   panel de alta de usuarios
couchdb-config/docker.ini single-node (sin CORS: todo es same-origin)
locks/                    package-lock.json congelados (frontend y couch-auth)
scripts/lib.sh            funciones comunes de los scripts
scripts/arrancar.sh       levanta + inicializa bases/vista + verifica (PC y server)
scripts/preparar-server.sh    prepara un Ubuntu 24.04 nuevo (Docker, firewall, fail2ban, swap...)
scripts/verificar-sitio.sh    chequeo desde afuera: lo necesario anda, lo sensible da 404
scripts/crear-usuario.sh / borrar-usuario.sh
scripts/backup.sh / backup-offsite.sh / restore.sh / parchear.sh
docs/runbook-prod.md      despliegue y operación en DonWeb (paso a paso)
docs/checklist-operacion.md   rescate en la PC local
avances/                  estado del proyecto, auditorías y revisiones
```
