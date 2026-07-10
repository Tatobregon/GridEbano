# AsTeRICS Grid — Runbook de auto-hospedaje (Cloud Server DonWeb)

Guía paso a paso para clonar y servir una versión **congelada y estable** de AsTeRICS Grid en tu propio servidor, con sincronización online (CouchDB + couch-auth) y backups controlados por vos.

- **Release pineado:** `release-2026-06-03-09.11/+0200` (último estable al momento de armar esto)
- **Stack:** Docker + Docker Compose → CouchDB · couch-auth · nginx (frontend) · Caddy (reverse proxy + HTTPS automático)
- **SO recomendado en DonWeb:** Ubuntu 24.04 LTS

> **Convención:** en toda la guía reemplazá `tudominio.com` por tu dominio real. Las contraseñas de ejemplo (`CAMBIAME...`) **tenés que cambiarlas**.

---

## 0. Arquitectura de un vistazo

```
                          Internet (HTTPS 443)
                                  │
                          ┌───────▼────────┐
                          │     Caddy      │  ← TLS automático (Let's Encrypt)
                          └───┬───┬────┬───┘
        grid.tudominio.com ───┘   │    └─── db.tudominio.com
        auth.tudominio.com ───────┘
            │                │              │
     ┌──────▼─────┐   ┌──────▼──────┐  ┌────▼──────┐
     │  frontend  │   │  couch-auth │  │  CouchDB  │
     │  (nginx)   │   │  (node:3000)│  │  (:5984)  │
     │ app estát. │   └──────┬──────┘  └────┬──────┘
     └────────────┘          │ admin        │ volumen
                             └──────────────┤ couchdb-data
                                            │ (/opt/couchdb/data)
                                            ▼
                                      BACKUPS (tar nocturno)
```

**Flujo:** el navegador carga el frontend desde `grid.…`, se autentica contra `auth.…` (couch-auth), y la librería PouchDB del navegador sincroniza directamente contra la base personal del usuario en `db.…` (CouchDB). Los datos van **cifrados de extremo a extremo**: ni vos como admin podés leerlos, pero **sí podés restaurarlos** desde un snapshot porque la contraseña del usuario no cambia.

---

## 1. Prerequisitos

1. Un **Cloud Server** de DonWeb con Ubuntu 24.04 y acceso root (SSH).
2. Un **dominio** registrado y con acceso a su zona DNS.
3. Puertos **80** y **443** abiertos en el firewall del server (los únicos que exponemos).

Conectate por SSH e instalá Docker:

```bash
# Como root
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh
# Verificá
docker --version
docker compose version
```

(Opcional pero recomendado) firewall mínimo:

```bash
apt -y install ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

> ⚠️ No abras 5984 (CouchDB) ni 3000 (couch-auth) al público. Solo se acceden a través de Caddy por HTTPS.

---

## 2. DNS — tres registros A

En el panel DNS de tu dominio, creá tres registros **A** apuntando a la **IP pública de tu Cloud Server**:

| Nombre               | Tipo | Valor (IP del server) |
|----------------------|------|-----------------------|
| `grid.tudominio.com` | A    | `TU.IP.DEL.SERVER`    |
| `auth.tudominio.com` | A    | `TU.IP.DEL.SERVER`    |
| `db.tudominio.com`   | A    | `TU.IP.DEL.SERVER`    |

Esperá a que propaguen (`dig grid.tudominio.com +short` debe devolver tu IP) **antes** de levantar Caddy, porque necesita resolver los dominios para emitir los certificados.

---

## 3. Estructura del proyecto en el server

```bash
mkdir -p /opt/asterics-grid/{caddy,couchdb-config,scripts,backups}
cd /opt/asterics-grid
```

Vas a crear estos archivos (los detallamos abajo):

```
/opt/asterics-grid/
├── docker-compose.yml
├── .env
├── Dockerfile.frontend
├── Dockerfile.couchauth
├── caddy/Caddyfile
├── couchdb-config/docker.ini
└── scripts/backup.sh
```

---

## 4. Variables de entorno (`.env`)

```bash
cat > /opt/asterics-grid/.env <<'EOF'
# ---- Dominios ----
DOMAIN_GRID=grid.tudominio.com
DOMAIN_AUTH=auth.tudominio.com
DOMAIN_DB=db.tudominio.com

# ---- CouchDB admin ----
COUCHDB_USER=admin
COUCHDB_PASSWORD=CAMBIAME_couch_admin_largo

# ---- couch-auth -> CouchDB ----
# El frontend (navegador) accede a la base personal por esta URL pública:
DB_SERVER_PUBLIC_URL=https://db.tudominio.com
# couch-auth accede a CouchDB internamente por la red de Docker:
DB_SERVER_PROTOCOL=http://
DB_SERVER_HOST=couchdb:5984
DB_SERVER_USER=admin
DB_SERVER_PASSWORD=CAMBIAME_couch_admin_largo
CAUTH_USER_DB=auth-users
CAUTH_COUCH_AUTH_DB=_users

# ---- Release a pinear ----
ASTERICS_TAG=release-2026-06-03-09.11/+0200
ASTERICS_VERSION=selfhost-2026-06-03
EOF
```

> `DB_SERVER_PASSWORD` debe ser **igual** a `COUCHDB_PASSWORD`.

---

## 5. Config de CouchDB (`couchdb-config/docker.ini`)

CouchDB necesita modo single-node y **CORS habilitado** para que el navegador (origen `grid.…`) pueda sincronizar contra `db.…`.

```bash
cat > /opt/asterics-grid/couchdb-config/docker.ini <<'EOF'
[couchdb]
single_node = true

[chttpd]
enable_cors = true
; CouchDB 3 requiere admin (no admin party)

[cors]
origins = https://grid.tudominio.com
credentials = true
methods = GET, PUT, POST, HEAD, DELETE
headers = accept, authorization, content-type, origin, referer, x-csrf-token

[httpd]
enable_cors = true
EOF
```

> Cambiá `https://grid.tudominio.com` por tu dominio real. Si querés permitir más orígenes (ej. un subdominio de staging), separalos con coma.

---

## 6. Dockerfile del frontend (`Dockerfile.frontend`)

Compila el release pineado **con las dos modificaciones críticas** (URL del backend + entorno PROD) y lo sirve con nginx.

```bash
cat > /opt/asterics-grid/Dockerfile.frontend <<'EOF'
# ---------- build ----------
FROM node:18-bullseye AS build
ARG ASTERICS_TAG
ARG DOMAIN_AUTH
ARG ASTERICS_VERSION
WORKDIR /src

# Clonar el release estable pineado (el tag contiene "/" y "+", por eso se entrecomilla)
RUN git clone https://github.com/asterics/AsTeRICS-Grid.git . \
    && git checkout "tags/${ASTERICS_TAG}"

# (1) Apuntar el frontend a TU couch-auth en vez del de la fundación
RUN sed -i "s#https://login1.couchdb.asterics-foundation.org#https://${DOMAIN_AUTH}#g" \
    src/js/service/loginService.js

# (2) Fijar entorno PROD y versión (reemplaza los placeholders que normalmente
#     setea el script de release oficial). La versión también invalida el cache
#     del service worker cuando actualices más adelante.
RUN sed -i "s/#ASTERICS_GRID_ENV#/PROD/g"            src/js/util/constants.js \
    && sed -i "s/#ASTERICS_GRID_VERSION#/${ASTERICS_VERSION}/g" src/js/util/constants.js \
    && sed -i "s/#ASTERICS_GRID_VERSION#/${ASTERICS_VERSION}/g" src/vue-components/views/aboutView.vue \
    && sed -i "s/#ASTERICS_GRID_VERSION#/${ASTERICS_VERSION}/g" serviceWorker.js

# Instalar y compilar (saltamos jest para que el build no dependa de los tests)
RUN npm ci
RUN npx webpack --config webpack.config.js --env production \
    && node scripts/getServiceWorkerCachePaths.js

# ---------- serve ----------
FROM nginx:1.27-alpine
# El app se sirve desde la raíz del repo (index.html + carpeta app/ + serviceWorker.js + assets)
COPY --from=build /src/ /usr/share/nginx/html/
# Config nginx: SPA + no cachear el service worker ni index.html
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

> Si el `git checkout "tags/${ASTERICS_TAG}"` te diera problemas por el `/` del nombre, alternativa equivalente: `git clone --depth 1 --branch "${ASTERICS_TAG}" https://github.com/asterics/AsTeRICS-Grid.git .`

---

## 7. Dockerfile de couch-auth (`Dockerfile.couchauth`)

```bash
cat > /opt/asterics-grid/Dockerfile.couchauth <<'EOF'
FROM node:18-bullseye
ARG ASTERICS_TAG
WORKDIR /app
RUN git clone https://github.com/asterics/AsTeRICS-Grid.git . \
    && git checkout "tags/${ASTERICS_TAG}"
RUN npm ci
EXPOSE 3000
CMD ["node", "superlogin/start.js"]
EOF
```

> `superlogin/start.js` ya viene configurado con `sendConfirmEmail: false` y `requireEmailConfirm: false`, así que **no necesitás SMTP**: las cuentas quedan activas al crearse. Lee toda su config desde el `.env` que le pasamos por Compose.

---

## 8. Caddyfile (`caddy/Caddyfile`)

```bash
cat > /opt/asterics-grid/caddy/Caddyfile <<'EOF'
{
    # Email para los avisos de Let's Encrypt
    email tu-email@tudominio.com
}

grid.tudominio.com {
    reverse_proxy frontend:80
}

auth.tudominio.com {
    reverse_proxy couch-auth:3000
}

db.tudominio.com {
    reverse_proxy couchdb:5984
}
EOF
```

> Reemplazá los tres dominios y el email. Caddy pide y renueva los certificados solo.

---

## 9. docker-compose.yml

```bash
cat > /opt/asterics-grid/docker-compose.yml <<'EOF'
services:
  couchdb:
    image: couchdb:3.4
    restart: unless-stopped
    environment:
      COUCHDB_USER: ${COUCHDB_USER}
      COUCHDB_PASSWORD: ${COUCHDB_PASSWORD}
    volumes:
      - couchdb-data:/opt/couchdb/data
      - ./couchdb-config/docker.ini:/opt/couchdb/etc/local.d/zz-docker.ini:ro
    networks: [internal]

  couch-auth:
    build:
      context: .
      dockerfile: Dockerfile.couchauth
      args:
        ASTERICS_TAG: ${ASTERICS_TAG}
    restart: unless-stopped
    environment:
      DB_SERVER_PUBLIC_URL: ${DB_SERVER_PUBLIC_URL}
      DB_SERVER_PROTOCOL: ${DB_SERVER_PROTOCOL}
      DB_SERVER_HOST: ${DB_SERVER_HOST}
      DB_SERVER_USER: ${DB_SERVER_USER}
      DB_SERVER_PASSWORD: ${DB_SERVER_PASSWORD}
      CAUTH_USER_DB: ${CAUTH_USER_DB}
      CAUTH_COUCH_AUTH_DB: ${CAUTH_COUCH_AUTH_DB}
    depends_on: [couchdb]
    networks: [internal]

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
      args:
        ASTERICS_TAG: ${ASTERICS_TAG}
        DOMAIN_AUTH: ${DOMAIN_AUTH}
        ASTERICS_VERSION: ${ASTERICS_VERSION}
    restart: unless-stopped
    networks: [internal]

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [frontend, couch-auth, couchdb]
    networks: [internal]

networks:
  internal:

volumes:
  couchdb-data:
  caddy-data:
  caddy-config:
EOF
```

---

## 10. Levantar el stack

```bash
cd /opt/asterics-grid
docker compose up -d --build
# Seguí los logs la primera vez
docker compose logs -f
```

La primera build tarda (clona y compila el frontend). Cuando termine:

```bash
# Inicializar bases de sistema + la base de usuarios de couch-auth.
# (single_node=true ya crea _users/_replicator/_global_changes; esto es por las dudas e idempotente)
source .env
docker compose exec couchdb bash -lc "
  curl -s -X PUT http://$COUCHDB_USER:$COUCHDB_PASSWORD@127.0.0.1:5984/_users;
  curl -s -X PUT http://$COUCHDB_USER:$COUCHDB_PASSWORD@127.0.0.1:5984/_replicator;
  curl -s -X PUT http://$COUCHDB_USER:$COUCHDB_PASSWORD@127.0.0.1:5984/_global_changes;
  curl -s -X PUT http://$COUCHDB_USER:$COUCHDB_PASSWORD@127.0.0.1:5984/auth-users;
  echo
"
docker compose restart couch-auth
```

**Verificación rápida:**

```bash
# CouchDB responde por HTTPS
curl -s https://db.tudominio.com/ ; echo
# couch-auth responde
curl -s https://auth.tudominio.com/auth/session ; echo
```

Abrí `https://grid.tudominio.com` en el navegador. Debería cargar la app. Probá crear un **usuario online** desde la propia UI y confirmá que sincroniza (el ícono de sync en la barra inferior).

---

## 11. Crear vos las cuentas y entregárselas

Como decidiste provisionarlas vos, usá el endpoint de registro de couch-auth. **Reglas de usuario** (según el código): minúsculas, dígitos, `_` o `-`, entre **3 y 16 caracteres**; contraseña mínima 6.

Script práctico:

```bash
cat > /opt/asterics-grid/scripts/crear-usuario.sh <<'EOF'
#!/bin/bash
# Uso: ./crear-usuario.sh <usuario> <contraseña> [email]
set -e
AUTH_URL="https://auth.tudominio.com"
USER="$1"; PASS="$2"; EMAIL="${3:-$1@local.invalid}"
if [ -z "$USER" ] || [ -z "$PASS" ]; then
  echo "Uso: $0 <usuario> <contraseña> [email]"; exit 1
fi
curl -s -X POST "$AUTH_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"confirmPassword\":\"$PASS\"}"
echo
EOF
chmod +x /opt/asterics-grid/scripts/crear-usuario.sh

# Ejemplo:
# ./scripts/crear-usuario.sh juanperez MiClaveSegura123
```

Le pasás a cada persona su `usuario` + `contraseña` y el link `https://grid.tudominio.com`. En la app eligen "usuario online" e inician sesión con esas credenciales.

> **Recordá:** la contraseña ES la llave de cifrado. Si el usuario la pierde y se desloguea en todos sus dispositivos, su data no se puede desencriptar (ni vos podés). Guardá vos una copia de las credenciales que entregás.

---

## 12. Backups (tu objetivo principal)

Snapshot nocturno del volumen de CouchDB con rotación de 14 días.

```bash
cat > /opt/asterics-grid/scripts/backup.sh <<'EOF'
#!/bin/bash
set -e
BACKUP_DIR=/opt/asterics-grid/backups
RETENTION_DAYS=14
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$BACKUP_DIR"

# tar del volumen couchdb-data (montado de solo lectura en un contenedor efímero)
docker run --rm \
  -v asterics-grid_couchdb-data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c "tar czf /backup/couchdb_${STAMP}.tgz -C /data ."

# Rotación
find "$BACKUP_DIR" -name 'couchdb_*.tgz' -mtime +$RETENTION_DAYS -delete
echo "Backup OK: $BACKUP_DIR/couchdb_${STAMP}.tgz"
EOF
chmod +x /opt/asterics-grid/scripts/backup.sh
```

> El nombre del volumen suele ser `asterics-grid_couchdb-data` (prefijo = nombre de la carpeta del compose). Confirmalo con `docker volume ls`.

Agendalo con cron (todos los días a las 3 AM):

```bash
crontab -e
# agregá esta línea:
0 3 * * * /opt/asterics-grid/scripts/backup.sh >> /opt/asterics-grid/backups/backup.log 2>&1
```

**Restaurar** (ej. un usuario borró su comunicador y querés volver atrás):

```bash
cd /opt/asterics-grid
docker compose stop couchdb
# Vaciar el volumen y desempaquetar el snapshot elegido
docker run --rm \
  -v asterics-grid_couchdb-data:/data \
  -v /opt/asterics-grid/backups:/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/couchdb_2026-06-03_0300.tgz -C /data"
docker compose start couchdb
```

> **Muy recomendado:** copiá los `.tgz` también **fuera del server** (otro server, S3, tu máquina por `scp`). Un backup en el mismo disco no te salva si el server muere.
>
> Bonus: el repo oficial trae scripts útiles para mantenimiento en `scripts/` (p. ej. `couchDBCompact.js` para compactar y `couchDBReplicateAllDbs.js` para backup lógico por replicación). Opcionales.

---

## 13. Actualizar a una versión nueva más adelante (el motivo de todo esto)

Cuando el desarrollador saque una actualización y **se estabilice**, actualizás **solo el frontend**, dejando CouchDB y couch-auth intactos.

**Procedimiento seguro (con staging):**

1. Identificá el nuevo tag estable:
   ```bash
   git ls-remote --tags --refs https://github.com/asterics/AsTeRICS-Grid.git \
     | sed 's#.*refs/tags/##' | grep -E '^release-[0-9]{4}' | sort | tail -5
   ```
2. (Recomendado) Probalo primero en un subdominio de staging que apunte al **mismo** backend:
   - Creá un registro A `grid-next.tudominio.com`.
   - Agregá un bloque en el `Caddyfile` y un servicio `frontend-next` en el compose con el nuevo `ASTERICS_TAG` y un `ASTERICS_VERSION` distinto.
   - Agregá `https://grid-next.tudominio.com` a `origins` en `couchdb-config/docker.ini` y reiniciá couchdb.
   - Probá login + sync con un usuario de prueba.
3. Si todo anda, actualizá producción:
   ```bash
   cd /opt/asterics-grid
   # Editá .env: nuevos ASTERICS_TAG y ASTERICS_VERSION
   nano .env
   docker compose build --no-cache frontend
   docker compose up -d frontend
   ```
4. **Bump de versión = cache busting:** al cambiar `ASTERICS_VERSION`, el service worker genera un cache nuevo y los navegadores toman la versión nueva (pueden requerir un reload). Por eso siempre cambiá la versión al actualizar.

**Reglas de oro:**
- Siempre hacé `checkout` de un **tag estable** específico, nunca de `master`.
- No toques el stack de base (couchdb/couch-auth) salvo que una nueva versión cambie el modelo de datos; si eso pasa, probalo en staging antes.
- Mantené el `.env` viejo anotado para poder volver atrás (rollback = volver al tag anterior y rebuild).

---

## 14. Cosas para tener en el radar

- **HTTPS es obligatorio.** El service worker (modo offline), la síntesis de voz y el micrófono no funcionan sobre HTTP. Caddy te lo resuelve, no sirvas nada por HTTP plano.
- **Cifrado E2E:** los snapshots están cifrados pero son **restaurables** (la contraseña del usuario no cambia). No son legibles por vos. Pérdida de contraseña del usuario = data irrecuperable para ese usuario.
- **Dependencia de upstream que el frontend congelado NO congela:** la app sigue trayendo el catálogo de plantillas de importación desde GitHub Pages (`asterics.github.io/Asterics-AAC-Data`) y usa un proxy de la fundación para algunas acciones HTTP. Tus grids guardados no dependen de eso. Si querés un congelamiento **total**, podés auto-hospedar también ese repo de datos y cambiar `constants.BOARDS_REPO_BASE_URL` en el build (paso avanzado, opcional).
- **Licencia AGPL-3.0:** modificaste `loginService.js` (cambio de config). Servir una versión modificada te obliga a poner el código fuente a disposición de tus usuarios. Se cumple fácil publicando tu fork o linkeando a tu repo con los cambios.
- **Seguridad:** no expongas 5984 ni 3000 al público. Cambiá las contraseñas de ejemplo por unas largas. Considerá fail2ban en SSH.
- **Dimensionamiento:** ~100 usuarios/año es carga chica para CouchDB. Un Cloud Server modesto (2 vCPU / 2–4 GB RAM) alcanza de sobra. couch-auth usa sesiones en memoria por defecto, suficiente para esta escala (Redis recién tendría sentido con muchísimos logins concurrentes).

---

## Apéndice — Comandos útiles

```bash
# Estado y logs
docker compose ps
docker compose logs -f couch-auth
docker compose logs -f couchdb

# Reiniciar un servicio
docker compose restart couch-auth

# Ver bases creadas (incluye una por cada usuario online: asterics-grid-data$usuario)
source .env
docker compose exec couchdb curl -s http://$COUCHDB_USER:$COUCHDB_PASSWORD@127.0.0.1:5984/_all_dbs ; echo

# Listar volúmenes (para confirmar el nombre exacto del volumen de datos)
docker volume ls
```
