#!/bin/bash
# Aplica parches de seguridad: rebuildea con las ÚLTIMAS versiones parcheadas de las imágenes base
# (couchdb:3.4, node:18-bullseye, nginx:1.27-alpine) SIN cambiar de versión mayor → seguimos
# "congelados" en el tag, pero con los fixes de seguridad al día.
#
# Hace, en orden:  backup de seguridad → docker compose build --pull → levantar + verificar → log.
# Si algo queda mal, restaurás el backup previo con restore.sh.
#
# NO actualiza el propio AsTeRICS Grid (eso es cambiar ASTERICS_TAG, un proceso aparte con más
# cuidado — ver docs/procedimiento-parcheo.md).
set -e
export MSYS_NO_PATHCONV=1
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
compose() { ( cd "$PROJECT_DIR" && docker compose "$@" ); }
DOCKER_DESKTOP="C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"

echo "==============================================="
echo " Parcheo de seguridad — AsTeRICS Grid"
echo " (puede tardar ~10 min si hay imágenes nuevas)"
echo "==============================================="

echo "[1/4] Docker..."
if ! docker version >/dev/null 2>&1; then
  echo "      arrancando Docker Desktop..."
  powershell.exe -NoProfile -Command "Start-Process '$DOCKER_DESKTOP'" >/dev/null 2>&1 || true
  for i in $(seq 1 40); do docker version >/dev/null 2>&1 && break; sleep 5; done
fi
docker version >/dev/null 2>&1 || { echo "      ERROR: Docker no arrancó."; exit 1; }
echo "      Docker OK."

echo "[2/4] Backup de seguridad ANTES de parchear..."
bash "$PROJECT_DIR/scripts/backup.sh"

echo "[3/4] Rebuild con --pull (baja las últimas versiones parcheadas de las imágenes base)..."
compose build --pull

echo "[4/4] Levantar + verificar..."
bash "$PROJECT_DIR/scripts/arrancar.sh"

echo "$(date '+%Y-%m-%d %H:%M') - parcheo aplicado (docker compose build --pull)" >> "$PROJECT_DIR/avances/parcheos.log"
echo ""
echo "  Parcheo aplicado y verificado. Registrado en avances/parcheos.log"
echo "  Si algo quedó mal, restaurá: ./scripts/restore.sh backups/<el backup de recién>.tgz"
echo "==============================================="
