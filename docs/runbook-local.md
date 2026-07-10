# AsTeRICS Grid — Entorno de desarrollo local (tu propia compu)

Variante del runbook para correr todo en tu máquina como servidor de desarrollo, sin dominios, sin certificados y sin host pagado. Reutiliza los mismos contenedores que la versión de producción; lo único que cambia es el networking (todo por `localhost`) y que no hay TLS.

- **Por qué funciona sin HTTPS:** los navegadores tratan `http://localhost` como *contexto seguro*, así que el service worker (offline), la síntesis de voz y el micrófono andan igual.
- **Release pineado:** `release-2026-06-03-09.11/+0200`
- **Límite:** accesible solo desde esta misma máquina (ver nota de LAN al final).

```
  Navegador (en esta PC)
        │  http://localhost
        ├──► :9095  frontend (nginx, app estática)
        ├──► :3000  couch-auth (node)
        └──► :5984  CouchDB
                       │ (couch-auth le habla internamente como "couchdb:5984")
                       └─ volumen couchdb-data  ──►  backups (tar)
```

---

## 1. Prerequisitos (Windows)

1. Instalar **Docker Desktop** y activar el backend **WSL2** (Settings → General → "Use the WSL 2 based engine", y en Resources → WSL Integration habilitá tu distro Ubuntu).
2. Instalar una distro **WSL Ubuntu** si no la tenés: en PowerShell como admin → `wsl --install -d Ubuntu`.
3. **Todo lo que sigue se corre dentro de la terminal WSL Ubuntu.** Docker Desktop expone los puertos al `localhost` de Windows, así que después abrís la app desde el navegador de Windows normalmente.

Verificá dentro de WSL:

```bash
docker --version
docker compose version
```

> Si estás en Linux/Mac: instalás Docker + Compose normalmente y corrés los mismos comandos. En Mac, `localhost` también es contexto seguro, así que aplica igual.

---

## 2. Estructura del proyecto

```bash
mkdir -p ~/asterics-grid/{couchdb-config,scripts,backups}
cd ~/asterics-grid
```

Archivos que vas a crear:

```
~/asterics-grid/
├── docker-compose.yml
├── Dockerfile.frontend
├── Dockerfile.couchauth
├── couchdb-config/docker.ini
└── scripts/  (crear-usuario.sh, backup.sh)
```

> El nombre de la carpeta (`asterics-grid`) define el prefijo del volumen: `asterics-grid_couchdb-data`. Confirmalo luego con `docker volume ls`.

---

## 3. Config de CouchDB (`couchdb-config/docker.ini`)

CORS apuntando al origen del frontend local (`http://localhost:9095`):

```bash
cat > ~/asterics-grid/couchdb-config/docker.ini <<'EOF'
[couchdb]
single_node = true

[chttpd]
enable_cors = true

[cors]
origins = http://localhost:9095
credentials = true
methods = GET, PUT, POST, HEAD, DELETE
headers = accept, authorization, content-type, origin, referer, x-csrf-token

[httpd]
enable_cors = true
EOF
```

---

## 4. Dockerfile del frontend (`Dockerfile.frontend`)

Igual que el de producción, pero el backend se parametriza con una **URL completa** (`AUTH_BASE_URL`) para poder usar `http://localhost:3000`.

```bash
cat > ~/asterics-grid/Dockerfile.frontend <<'EOF'
FROM node:18-bullseye AS build
ARG ASTERICS_TAG
ARG AUTH_BASE_URL
ARG ASTERICS_VERSION
WORKDIR /src

RUN git clone https://github.com/asterics/AsTeRICS-Grid.git . \
    && git checkout "tags/${ASTERICS_TAG}"

# (1) Apuntar el frontend a TU couch-auth (URL completa, sirve para http://localhost:3000)
RUN sed -i "s#https://login1.couchdb.asterics-foundation.org#${AUTH_BASE_URL}#g" \
    src/js/service/loginService.js

# (2) Entorno PROD + versión (la versión invalida el cache del service worker al actualizar)
RUN sed -i "s/#ASTERICS_GRID_ENV#/PROD/g"            src/js/util/constants.js \
    && sed -i "s/#ASTERICS_GRID_VERSION#/${ASTERICS_VERSION}/g" src/js/util/constants.js \
    && sed -i "s/#ASTERICS_GRID_VERSION#/${ASTERICS_VERSION}/g" src/vue-components/views/aboutView.vue \
    && sed -i "s/#ASTERICS_GRID_VERSION#/${ASTERICS_VERSION}/g" serviceWorker.js

RUN npm install
RUN npx webpack --config webpack.config.js --env production \
    && node scripts/getServiceWorkerCachePaths.js

FROM nginx:1.27-alpine
COPY --from=build /src/ /usr/share/nginx/html/
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location = /serviceWorker.js { add_header Cache-Control "no-cache"; }' \
  '  location = /index.html       { add_header Cache-Control "no-cache"; }' \
  '  location / { try_files $uri $uri/ /index.html; }' \
  '}' > /etc/nginx/conf.d/default.conf
EOF
```

---

## 5. Dockerfile de couch-auth (`Dockerfile.couchauth`)

Idéntico al de producción:

```bash
cat > ~/asterics-grid/Dockerfile.couchauth <<'EOF'
FROM node:18-bullseye
ARG ASTERICS_TAG
WORKDIR /app
RUN git clone https://github.com/asterics/AsTeRICS-Grid.git . \
    && git checkout "tags/${ASTERICS_TAG}"
RUN npm install
EXPOSE 3000
CMD ["node", "superlogin/start.js"]
EOF
```

---

## 6. docker-compose.yml (versión local, sin Caddy)

```bash
cat > ~/asterics-grid/docker-compose.yml <<'EOF'
services:
  couchdb:
    image: couchdb:3.4
    restart: unless-stopped
    environment:
      COUCHDB_USER: admin
      COUCHDB_PASSWORD: localdev123     # solo local
    ports:
      - "5984:5984"
    volumes:
      - couchdb-data:/opt/couchdb/data
      # SIN :ro: en bind-mounts de Windows el archivo aparece como root y el chown del
      # entrypoint de couchdb falla en read-only → crash silencioso (exit 1, sin logs).
      - ./couchdb-config/docker.ini:/opt/couchdb/etc/local.d/zz-docker.ini

  couch-auth:
    build:
      context: .
      dockerfile: Dockerfile.couchauth
      args:
        ASTERICS_TAG: "release-2026-06-03-09.11/+0200"
    restart: unless-stopped
    environment:
      DB_SERVER_PUBLIC_URL: http://localhost:5984   # lo que usa el NAVEGADOR
      DB_SERVER_PROTOCOL: http://
      DB_SERVER_HOST: couchdb:5984                   # lo que usa couch-auth interno
      DB_SERVER_USER: admin
      DB_SERVER_PASSWORD: localdev123
      CAUTH_USER_DB: auth-users
      CAUTH_COUCH_AUTH_DB: _users
    ports:
      - "3000:3000"
    depends_on: [couchdb]

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
      args:
        ASTERICS_TAG: "release-2026-06-03-09.11/+0200"
        AUTH_BASE_URL: "http://localhost:3000"
        ASTERICS_VERSION: "localdev-1"
    restart: unless-stopped
    ports:
      - "9095:80"
    depends_on: [couch-auth]

volumes:
  couchdb-data:
EOF
```

> Las contraseñas son triviales a propósito: esto es local. Cuando pases a producción, volvés al runbook de servidor (dominios, Caddy, claves fuertes).

---

## 7. Levantar y probar

```bash
cd ~/asterics-grid
docker compose up -d --build
docker compose logs -f      # mirá la primera build (clona y compila el frontend; tarda)
```

Inicializar las bases (idempotente):

```bash
docker compose exec couchdb bash -lc '
  for db in _users _replicator _global_changes auth-users; do
    curl -s -X PUT http://admin:localdev123@127.0.0.1:5984/$db; echo " -> $db";
  done
'
```

Crear la vista `view-usernames` en `auth-users` (**obligatoria**: sin ella couch-auth crashea cuando la UI valida un nombre de usuario):

```bash
curl -s -X PUT http://admin:localdev123@localhost:5984/auth-users/_design/views \
  -H 'Content-Type: application/json' \
  -d '{"views":{"view-usernames":{"map":"function (doc) { if (doc.key) { emit(doc.key, null); } }"}}}'
echo
docker compose restart couch-auth
```

Verificación:

```bash
curl -s http://localhost:5984/ ; echo                 # CouchDB responde
curl -s http://localhost:3000/auth/session ; echo     # couch-auth responde
```

Ahora abrí en el navegador de Windows: **http://localhost:9095**

Test de humo: creá un **usuario online** desde la UI y confirmá que el ícono de sincronización (barra inferior) queda en verde. Eso valida que frontend + couch-auth + CouchDB se están hablando.

---

## 8. Crear cuentas vos mismo

Reglas (según el código): minúsculas / dígitos / `_` / `-`, entre **3 y 16 caracteres**; contraseña mínima 6.

```bash
cat > ~/asterics-grid/scripts/crear-usuario.sh <<'EOF'
#!/bin/bash
# Uso: ./crear-usuario.sh <usuario> <contraseña> [email]
set -e
AUTH_URL="http://localhost:3000"
USER="$1"; PASS="$2"; EMAIL="${3:-$1@local.invalid}"
[ -z "$USER" ] || [ -z "$PASS" ] && { echo "Uso: $0 <usuario> <contraseña> [email]"; exit 1; }
curl -s -X POST "$AUTH_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"confirmPassword\":\"$PASS\"}"
echo
EOF
chmod +x ~/asterics-grid/scripts/crear-usuario.sh

# Ejemplo:
# ./scripts/crear-usuario.sh juanperez MiClave123
```

---

## 9. Backups (mismo concepto que en prod) — PROBADO end-to-end

Los scripts ya están en `scripts/` (portables a Windows/Git Bash y a Linux). El ciclo se probó
de verdad: se restauró un backup en una instancia limpia y los `doc_count` volvieron idénticos.

**Hacer un backup** (snapshot del volumen, rotación 14 días):

```bash
./scripts/backup.sh
# -> backups/couchdb_<FECHA>.tgz
```

**Restaurar** un snapshot (para couchdb → snapshot de seguridad del estado actual → vacía → extrae → arranca):

```bash
./scripts/restore.sh backups/couchdb_<FECHA>.tgz          # pide confirmación ('si')
./scripts/restore.sh backups/couchdb_<FECHA>.tgz --yes    # sin preguntar (para automatización)
```

> `restore.sh` siempre saca un `pre-restore_<FECHA>.tgz` del estado ACTUAL antes de pisar nada,
> así un restore equivocado también es reversible.

**Notas de portabilidad (por qué los scripts tienen sus vueltas):** en Windows/Git Bash la
conversión de paths mangleaba los montajes del contenedor → los scripts exportan `MSYS_NO_PATHCONV=1`
(inocuo en Linux). Y `restore.sh` corre `docker compose` con `cd` al dir del proyecto (sin `-f`)
porque el binario Windows de compose no entiende paths estilo `/c/Users/...` pasados a `-f`.

**Agendado / offsite (pendiente para producción):** en el server Linux se agenda con **cron**
(el daemon de Docker está siempre arriba). En local, Docker Desktop no arranca solo, así que lo
más confiable es correr `backup.sh` a mano antes de pruebas grandes, o una tarea de Windows Task
Scheduler asumiendo que Docker Desktop esté abierto. En prod, además, hay que **copiar los `.tgz`
fuera del server** (si se muere el server, el backup no se muere con él).

---

## 10. Operación diaria

```bash
docker compose ps                      # estado
docker compose logs -f couch-auth      # logs
docker compose down                    # apagar (los datos quedan en el volumen)
docker compose up -d                   # volver a levantar
```

**Si cambiás algo y el navegador sigue mostrando lo viejo:** es el service worker cacheando. Subí `ASTERICS_VERSION` en el compose (ej. `localdev-2`), rebuildeá el frontend (`docker compose up -d --build frontend`) y hacé un *hard reload* (Ctrl+Shift+R), o desregistrá el SW desde DevTools → Application → Service Workers.

**Si el sync queda en X / la app se cuelga "cargando" / los datos no suben:** el navegador sincroniza directo contra `http://localhost:5984`, y el reenvío de puerto de Docker Desktop para 5984 a veces se rompe (conexión reseteada) tras rebuildear un solo servicio. Verificá: `curl -m8 http://localhost:5984/` desde el host (si da error pero `docker compose exec couchdb curl http://127.0.0.1:5984/_all_dbs` lista las bases, es esto). Fix: `docker compose down && docker compose up -d` (el volumen se mantiene). Para evitarlo, tras cualquier rebuild corré `docker compose up -d` completo (no un solo servicio) y chequeá que `localhost:5984` responda.

---

## 11. De local a producción (cuando estés listo)

El salto es chico justamente porque los contenedores son los mismos. Pasás al runbook de servidor y solo cambia:

1. Agregás **Caddy** adelante y los **3 subdominios** con DNS.
2. `AUTH_BASE_URL` pasa de `http://localhost:3000` a `https://auth.tudominio.com`.
3. `DB_SERVER_PUBLIC_URL` pasa de `http://localhost:5984` a `https://db.tudominio.com`.
4. CORS `origins` pasa a `https://grid.tudominio.com`.
5. Contraseñas fuertes y backups fuera del server.

El volumen `couchdb-data` con los datos podés incluso migrarlo (tar acá, untar allá), aunque como vas a arrancar de cero probablemente no haga falta.

---

## Nota: acceso desde otros dispositivos (tablet/celu)

El modo `localhost` no es accesible desde otra máquina, y sobre la IP de LAN (`http://192.168.x.x`) se rompe el contexto seguro (no andaría el modo offline ni la voz). Si necesitás que un usuario pruebe en su propio dispositivo dentro de tu red, las opciones son:

- **mkcert**: generás un certificado local de confianza y servís por HTTPS en la LAN (hay que instalar la CA de mkcert en cada dispositivo).
- **Túnel** (ej. Cloudflare Tunnel / ngrok): expone tu localhost con una URL HTTPS pública temporal, sin tocar DNS.

Avisame si llegás a ese punto y lo agregamos.
