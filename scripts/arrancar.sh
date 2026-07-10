#!/bin/bash
# Levanta TODO el stack y lo deja funcionando y accesible por el Funnel.
# Uso (desde Git Bash):  ./scripts/arrancar.sh
# Es idempotente: se puede correr siempre; no toca los datos.
# Si algo falla, mirá docs/checklist-operacion.md
set -e
export MSYS_NO_PATHCONV=1
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
compose() { ( cd "$PROJECT_DIR" && docker compose "$@" ); }
TAILSCALE="/c/Program Files/Tailscale/tailscale.exe"
DOCKER_DESKTOP="C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"
URL="https://pc-tato.taila78f74.ts.net"

echo "==============================================="
echo " Arrancando AsTeRICS Grid — servidor local"
echo "==============================================="

echo "[1/6] Docker Desktop..."
if ! docker version >/dev/null 2>&1; then
  echo "      Docker no responde; arrancando Docker Desktop (puede tardar ~1 min)..."
  powershell.exe -NoProfile -Command "Start-Process '$DOCKER_DESKTOP'" >/dev/null 2>&1 || true
  for i in $(seq 1 40); do docker version >/dev/null 2>&1 && break; sleep 5; done
fi
docker version >/dev/null 2>&1 || { echo "      ERROR: Docker no arrancó. Abrí Docker Desktop a mano y reintentá."; exit 1; }
echo "      Docker OK."

echo "[2/6] Levantando contenedores..."
compose up -d
# Leer la clave de admin desde el contenedor (no hace falta tenerla en el script).
ADMIN_PASS=""
for i in $(seq 1 10); do
  ADMIN_PASS=$(compose exec -T couchdb printenv COUCHDB_PASSWORD 2>/dev/null | tr -d '\r\n') || true
  [ -n "$ADMIN_PASS" ] && break; sleep 2
done

echo "[3/6] Esperando a CouchDB..."
for i in $(seq 1 30); do
  compose exec -T couchdb curl -s "http://127.0.0.1:5984/" >/dev/null 2>&1 && break
  sleep 2
done

echo "[4/6] Inicializando bases + vista (idempotente)..."
compose exec -T couchdb bash -lc "
  for db in _users _replicator _global_changes auth-users; do
    curl -s -X PUT http://admin:${ADMIN_PASS}@127.0.0.1:5984/\$db >/dev/null 2>&1;
  done" || true
compose exec -T couchdb curl -s -X PUT "http://admin:${ADMIN_PASS}@127.0.0.1:5984/auth-users/_design/views" \
  -H 'Content-Type: application/json' \
  -d '{"views":{"view-usernames":{"map":"function (doc) { if (doc.key) { emit(doc.key, null); } }"}}}' >/dev/null 2>&1 || true
compose restart couch-auth >/dev/null
echo "      Bases y vista OK; couch-auth reiniciado."

echo "[5/6] Tailscale Funnel (443 -> 9095)..."
if "$TAILSCALE" funnel status 2>/dev/null | grep -q "9095"; then
  echo "      Funnel ya estaba activo."
else
  "$TAILSCALE" funnel --bg --https=443 9095 >/dev/null 2>&1 \
    && echo "      Funnel configurado." \
    || echo "      AVISO: no pude configurar el Funnel (¿Tailscale logueado y Funnel habilitado en el admin?)."
fi

echo "[6/6] Verificación..."
sleep 3
# Nota: curl puede salir con exit != 0 al pegarle a la propia URL del Funnel (hairpin) aunque el
# HTTP code sea 200; por eso capturamos SOLO el código (|| true) y no encadenamos un echo.
WEB=$(curl -s -o /dev/null -m 15 -w "%{http_code}" "$URL/" 2>/dev/null || true); [ -z "$WEB" ] && WEB=000
DB=$(curl -s -o /dev/null -m 15 -w "%{http_code}" "$URL/couchdb/" 2>/dev/null || true); [ -z "$DB" ] && DB=000
echo "      Web    ($URL/)         -> HTTP $WEB"
echo "      Sync   ($URL/couchdb/) -> HTTP $DB"
echo ""
if [ "$WEB" = "200" ] && [ "$DB" = "200" ]; then
  echo "  TODO ARRIBA. Entrá desde cualquier dispositivo a:"
  echo "     $URL"
  echo ""
  echo "  Crear usuario:  ./scripts/crear-usuario.sh <usuario> <contraseña(8+)>"
  echo "  Backup:         ./scripts/backup.sh"
else
  echo "  ALGO NO RESPONDIÓ. Revisá la checklist: docs/checklist-operacion.md"
fi
echo "==============================================="
