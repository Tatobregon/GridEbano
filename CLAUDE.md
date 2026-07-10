# CLAUDE.md — Contexto del proyecto

> Este archivo lo lee Claude Code automáticamente al abrir la carpeta. Resume todo el
> trabajo de planificación hecho previamente, para continuar sin perder contexto.

## Objetivo

Auto-hospedar **AsTeRICS Grid** (app de Comunicación Aumentativa y Alternativa, open source,
AGPL-3.0) en una versión **congelada y estable**, para que las actualizaciones que publica
el desarrollador upstream no rompan funcionalidades de las que dependen usuarios reales.
Estrategia: clonar una versión estable concreta y actualizar a mano solo cuando una nueva
versión upstream esté probada.

Repo upstream: https://github.com/asterics/AsTeRICS-Grid

## Fase actual

**Entorno de desarrollo LOCAL** en la máquina del usuario (Windows + Docker Desktop + WSL2),
sirviendo todo por `localhost` sobre HTTP. Más adelante se migrará a un servidor (DonWeb
Cloud Server) con dominios + HTTPS. Ver `docs/runbook-prod.md` para esa fase.

> Importante: `http://localhost` es "contexto seguro" en los navegadores, así que el service
> worker (offline), la síntesis de voz y el micrófono funcionan sin HTTPS. Por eso en local
> no usamos Caddy ni certificados. Limitación: accesible solo desde esta misma máquina.

## Arquitectura

Tres servicios en Docker Compose (`docker-compose.yml`):

- **couchdb** (CouchDB 3.4) — base de datos. Una base por usuario online. Puerto 5984.
- **couch-auth** (node, del repo upstream `superlogin/start.js`) — registro/login, crea las
  bases por usuario. Puerto 3000. Lee config desde variables de entorno (ya inyectadas por Compose).
- **frontend** (nginx) — sirve el build estático de AsTeRICS Grid + el mirror self-hosteado del
  repo de tableros en `/Asterics-AAC-Data/` (same-origin). Puerto 9095.

El navegador: carga el frontend desde `:9095`, se autentica contra couch-auth en `:3000`, y
PouchDB sincroniza directamente contra la base personal del usuario en CouchDB `:5984`.

## Decisiones tomadas (no re-litigar sin avisar al usuario)

1. **Modo ONLINE** (no offline). El usuario necesita que los comunicadores estén respaldados
   del lado servidor, no solo en el dispositivo.
2. **Cifrado E2E:** los datos en CouchDB están cifrados con la contraseña del usuario. El admin
   NO puede leerlos, pero SÍ puede **restaurarlos** desde un snapshot (la contraseña no cambia).
   El borrado de un usuario se sincroniza al servidor, así que el sync solo NO protege contra
   borrados accidentales → por eso hacemos snapshots del volumen de CouchDB.
3. **Backup = snapshots del volumen `couchdb-data`** (`scripts/backup.sh`). Sin export `.grd`
   automatizado por ahora.
4. **Cuentas creadas por el admin** (no auto-registro abierto). Ver `scripts/crear-usuario.sh`.
5. **Sin confirmación por email** → no se necesita SMTP. `superlogin/start.js` ya viene con
   `sendConfirmEmail: false` y `requireEmailConfirm: false`.
6. **Release pineado:** `release-2026-06-03-09.11/+0200` (último estable al planificar).
   Escala estimada: ~100 usuarios/año.

## Las CINCO modificaciones críticas al código upstream (ya implementadas en Dockerfile.frontend)

1. En `src/js/service/loginService.js`, la URL del backend está hardcodeada a
   `https://login1.couchdb.asterics-foundation.org`. Se reemplaza por la nuestra
   (`AUTH_BASE_URL`, en local `http://localhost:3000`).
2. El entorno se inyecta vía placeholder `#ASTERICS_GRID_ENV#`. Si se compila sin el script de
   release oficial, la app cree estar en modo dev. Se setea a `PROD` y se pone un número de
   versión (`ASTERICS_VERSION`), que además invalida el cache del service worker al actualizar.
3. **Repo de tableros self-hosteado** (desacople total de la fundación): la URL
   `https://asterics.github.io/Asterics-AAC-Data/` (hardcodeada en `constants.js` y
   `boardService.js`) se reemplaza por la ruta root-relative `/Asterics-AAC-Data/`. Una etapa
   `boards` del Dockerfile clona ese repo PINEADO (`BOARDS_COMMIT` en el compose) y el nginx lo
   sirve same-origin. Así tableros, imágenes y miniaturas predefinidas salen de NUESTRO servidor.
   El metadata usa rutas relativas (verificado: 0 URLs absolutas a asterics.github.io).
4. **Sync resiliente** (`src/js/service/data/pouchDbAdapter.js`): el upstream replica con
   `retry: false` (asume server estable). En nuestro setup, cualquier blip transitorio dispara el
   handler de error → `triggerConnectionLost()` cancela el sync y muestra la X **para siempre**.
   Se cambia a `retry: true` para que PouchDB reintente solo. (2 ocurrencias.)
5. **Cache-busting del service worker** (`serviceWorker.js`): el release oficial ya reemplazó el
   placeholder `#ASTERICS_GRID_VERSION#`, así que nuestro `serviceWorker.js` quedaba IDÉNTICO en
   cada build y el navegador nunca actualizaba (servía el bundle viejo cacheado). Se versiona
   `APP_CACHE_NAME` con `ASTERICS_VERSION` (`app-cache-<version>`) → cada build cambia el SW y el
   navegador actualiza solo. **Por eso, al cambiar el frontend, hay que subir `ASTERICS_VERSION`.**

## Fixes aplicados al levantar por primera vez (2026-06-29, entorno Windows)

Al levantar el stack por primera vez aparecieron dos problemas, ya resueltos en los archivos:

1. **`npm ci` fallaba** en `Dockerfile.frontend` y `Dockerfile.couchauth`: el repo upstream NO
   commitea `package-lock.json`, y `npm ci` lo exige. → Cambiado a **`npm install`** en ambos.
2. **couchdb crasheaba con exit 1 y CERO logs** (crash-loop). Causa: el entrypoint de la imagen
   `couchdb:3.4` corre `find /opt/couchdb -exec chown -f couchdb:couchdb`; el `docker.ini`
   bind-montado desde Windows aparece como `root` y, con `:ro`, el chown falla en un FS read-only
   → `find` devuelve !=0 → `set -e` mata el arranque antes de loggear. → Se quitó **`:ro`** del
   mount del `docker.ini` en `docker-compose.yml`. (Es específico de bind-mounts de Windows; en
   Linux con el archivo ya en uid couchdb no se dispara.)

Verificado: los 3 servicios quedan `running`, registro de usuario OK y se crea la base personal
`asterics-grid-data$<hash>` en CouchDB. Usuario de prueba creado: `pruebauno` / `Clave123`.

## Cómo levantar

```bash
docker compose up -d --build
# Inicializar bases (idempotente):
docker compose exec couchdb bash -lc '
  for db in _users _replicator _global_changes auth-users; do
    curl -s -X PUT http://admin:localdev123@127.0.0.1:5984/$db; echo " -> $db";
  done'
# Vista 'view-usernames' en auth-users — OBLIGATORIA: sin ella couch-auth CRASHEA (unhandled
# rejection) cuando la UI valida nombres vía /user/validate-username. Persiste en el volumen.
curl -s -X PUT http://admin:localdev123@localhost:5984/auth-users/_design/views \
  -H 'Content-Type: application/json' \
  -d '{"views":{"view-usernames":{"map":"function (doc) { if (doc.key) { emit(doc.key, null); } }"}}}'; echo
docker compose restart couch-auth
# Abrir: http://localhost:9095
# Test de humo: crear un "usuario online" desde la UI y verificar que el sync queda en verde.
```

## Próximos pasos / TODO

- [x] Levantar el stack local — los 3 servicios `running`, registro vía API OK (usuario `pruebauno`).
      Falta el último paso manual: abrir http://localhost:9095, loguearse y ver el sync en verde.
- [ ] Crear las primeras cuentas con `scripts/crear-usuario.sh`.
- [x] Ciclo de backup + restore: PROBADO end-to-end en vivo. `scripts/backup.sh` (snapshot del
      volumen, rotación 14 días) y `scripts/restore.sh <archivo.tgz> [--yes]` (para couchdb → saca
      snapshot de seguridad `pre-restore_*.tgz` → vacía → extrae → arranca). Ambos portables a
      Windows/Git Bash (`MSYS_NO_PATHCONV=1`; restore hace `cd` + compose sin `-f`). Restore
      verificado: doc_counts vuelven idénticos. Falta: agendar (cron en prod) y copiar OFFSITE.
- [x] Vista `view-usernames` en `auth-users` (design doc `_design/views`): CREADA. Resultó NO
      opcional — sin ella, el endpoint `/user/validate-username` (custom en `superlogin/start.js`,
      hace `authUsers.view('views','view-usernames')` sin try/catch) tira un 404 → unhandled
      rejection → couch-auth crashea en loop. Síntomas en la UI: "No se pudo verificar el nombre
      de usuario" y, por el crash, queda "no conectado." (que de por sí es la etiqueta `notLoggedIn`,
      no un error de red). Ya incluida en el paso de inicialización de "Cómo levantar".
- [x] Auto-hospedar el repo de datos de tableros (`Asterics-AAC-Data`): HECHO. Mirror pineado
      (`BOARDS_COMMIT`) servido same-origin por el nginx en `/Asterics-AAC-Data/`; URLs repunteadas
      en `constants.js` y `boardService.js`. Desacople 100% de asterics.github.io.
- [~] "Producción temporal" en la PC vía **Tailscale Funnel** (para testear desde otra PC sin pagar
      server): expuesto en `https://pc-tato.taila78f74.ts.net` (+ `:8443` login, `:10000` db).
      Clave admin de CouchDB endurecida. Requiere Docker Desktop corriendo. Detalle en la memoria
      del proyecto y en el runbook. Al mudar a server real: rebuild con la URL nueva (o dominio fijo).
- [ ] Migración a producción: ver `docs/runbook-prod.md` (agregar Caddy + 3 subdominios + HTTPS;
      cambiar `AUTH_BASE_URL`, `DB_SERVER_PUBLIC_URL` y CORS `origins` a los dominios reales;
      claves fuertes; backups fuera del server).

## Notas de licencia

AGPL-3.0: se modificó `loginService.js` (cambio de config). Servir una versión modificada
obliga a poner el código fuente a disposición de los usuarios. Se cumple publicando el fork
o linkeando a un repo con los cambios.

## Estructura

```
asterics-grid/
├── CLAUDE.md                  ← este archivo
├── README.md                  ← quickstart para humanos
├── docker-compose.yml         ← stack local (couchdb + couch-auth + frontend)
├── Dockerfile.frontend        ← build del frontend con las 2 mods críticas
├── Dockerfile.couchauth       ← servicio de auth (del repo upstream)
├── couchdb-config/docker.ini  ← single-node + CORS
├── scripts/crear-usuario.sh   ← alta de cuentas (admin)
├── scripts/backup.sh          ← snapshot del volumen de CouchDB
└── docs/
    ├── runbook-local.md       ← guía detallada de esta fase (local)
    └── runbook-prod.md        ← guía de la fase de producción (servidor)
```
