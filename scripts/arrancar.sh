#!/bin/bash
# Levanta TODO el stack, inicializa lo que haga falta y verifica que responda.
# Uso:  ./scripts/arrancar.sh
#   - En la PC (Git Bash): arranca Docker Desktop si hace falta y configura el Tailscale Funnel.
#   - En el server (Linux): levanta también Caddy (HTTPS) si el .env tiene COMPOSE_PROFILES=prod.
# Es idempotente: se puede correr siempre; no toca los datos.
# Si algo falla, mirá docs/checklist-operacion.md
set -e
source "$(dirname "$0")/lib.sh"

[ -f "$PROJECT_DIR/.env" ] || { echo "ERROR: falta el archivo .env (cp .env.example .env y completalo)."; exit 1; }
URL="$(env_var AUTH_BASE_URL)"

echo "==============================================="
echo " Arrancando AsTeRICS Grid (EBANO)"
echo "==============================================="

echo "[1/6] Docker..."
asegurar_docker
echo "      Docker OK."

echo "[2/6] Levantando contenedores..."
compose up -d

echo "[3/6] Esperando a CouchDB..."
esperar_couchdb
ADMIN_PASS="$(admin_pass)"
[ -n "$ADMIN_PASS" ] || { echo "      ERROR: no pude leer COUCHDB_PASSWORD del contenedor."; exit 1; }

echo "[4/6] Inicializando bases + vista (idempotente)..."
# Bases de sistema + la base de usuarios de couch-auth. (Si ya existen, CouchDB responde 412: OK.)
compose exec -T couchdb bash -c "
  for db in _users _replicator _global_changes auth-users; do
    curl -s -o /dev/null -X PUT \"http://admin:\$COUCHDB_PASSWORD@127.0.0.1:5984/\$db\";
  done"
# Vista 'view-usernames' en auth-users: OBLIGATORIA. Sin ella couch-auth se cae (unhandled rejection)
# al validar nombres. Se crea solo si no existe (un PUT sobre un design doc existente da 409: OK).
compose exec -T couchdb bash -c "
  curl -s -o /dev/null -X PUT \"http://admin:\$COUCHDB_PASSWORD@127.0.0.1:5984/auth-users/_design/views\" \
    -H 'Content-Type: application/json' \
    -d '{\"views\":{\"view-usernames\":{\"map\":\"function (doc) { if (doc.key) { emit(doc.key, null); } }\"}}}'"
VISTA=$(compose exec -T couchdb bash -c \
  "curl -s -o /dev/null -w '%{http_code}' \"http://admin:\$COUCHDB_PASSWORD@127.0.0.1:5984/auth-users/_design/views\"")
[ "$VISTA" = "200" ] || { echo "      ERROR: la vista view-usernames no quedó creada (HTTP $VISTA)."; exit 1; }
# couch-auth se reinicia para que tome las bases; después el frontend, para que nginx vuelva a
# resolver las IPs internas (si un contenedor se recreó, nginx podía quedar apuntando a la vieja → 502).
compose restart couch-auth >/dev/null
compose restart frontend >/dev/null
echo "      Bases y vista OK; couch-auth y frontend reiniciados."

echo "[5/6] Acceso público..."
if es_windows; then
  TAILSCALE="/c/Program Files/Tailscale/tailscale.exe"
  if [ -x "$TAILSCALE" ] && "$TAILSCALE" funnel status 2>/dev/null | grep -q "9095"; then
    echo "      Funnel ya estaba activo."
  elif [ -x "$TAILSCALE" ]; then
    "$TAILSCALE" funnel --bg --https=443 9095 >/dev/null 2>&1 \
      && echo "      Funnel configurado." \
      || echo "      AVISO: no pude configurar el Funnel (¿Tailscale logueado y Funnel habilitado en el admin?)."
  else
    echo "      (Tailscale no instalado: solo acceso local en http://localhost:9095)"
  fi
else
  if compose ps --services --status running 2>/dev/null | grep -qx caddy; then
    echo "      Caddy corriendo (HTTPS). La primera vez tarda ~1 min en sacar el certificado."
  else
    echo "      AVISO: Caddy no está corriendo. En el server el .env tiene que tener COMPOSE_PROFILES=prod."
  fi
fi

echo "[6/6] Verificación..."
LOCAL=$(curl -s -o /dev/null -m 10 -w "%{http_code}" "http://127.0.0.1:9095/" 2>/dev/null || true)
WEB=000; DB=000
# Se reintenta ~1 min: la primera vez Caddy puede estar sacando el certificado.
# (curl puede salir con exit != 0 al pegarle a la propia URL pública aunque el HTTP code sea 200;
#  por eso capturamos SOLO el código.)
for _ in $(seq 1 12); do
  WEB=$(curl -s -o /dev/null -m 15 -w "%{http_code}" "$URL/" 2>/dev/null || true); [ -z "$WEB" ] && WEB=000
  DB=$(curl -s -o /dev/null -m 15 -w "%{http_code}" "$URL/couchdb/" 2>/dev/null || true); [ -z "$DB" ] && DB=000
  [ "$WEB" = "200" ] && [ "$DB" = "200" ] && break
  sleep 5
done
echo "      Local  (http://127.0.0.1:9095/) -> HTTP $LOCAL"
echo "      Web    ($URL/)         -> HTTP $WEB"
echo "      Sync   ($URL/couchdb/) -> HTTP $DB"
echo ""
if [ "$WEB" = "200" ] && [ "$DB" = "200" ]; then
  echo "  TODO ARRIBA. Entrá desde cualquier dispositivo a:"
  echo "     $URL"
  echo ""
  echo "  Chequeo completo:  ./scripts/verificar-sitio.sh"
else
  echo "  ALGO NO RESPONDIÓ. Revisá: docker compose ps  y  docs/checklist-operacion.md"
  [ "$LOCAL" = "200" ] && echo "  (Localmente anda: el problema está en el acceso público: DNS, Caddy/certificado o Funnel.)"
  exit 1
fi
echo "==============================================="
