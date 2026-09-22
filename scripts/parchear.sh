#!/bin/bash
# Aplica parches de seguridad: baja las últimas versiones parcheadas de las imágenes (CouchDB, Caddy,
# Node, nginx, Alpine) y rebuildea, SIN cambiar la versión de AsTeRICS Grid (seguimos congelados en
# el tag y con las dependencias fijas de locks/).
#
# Hace, en orden:  backup de seguridad → pull de imágenes → build --pull → levantar + verificar → log.
# Si algo queda mal, restaurás el backup previo con restore.sh.
#
# NO actualiza el propio AsTeRICS Grid (eso es cambiar ASTERICS_TAG, un proceso aparte con más
# cuidado — ver docs/procedimiento-parcheo.md).
set -e
source "$(dirname "$0")/lib.sh"

echo "==============================================="
echo " Parcheo de seguridad — AsTeRICS Grid"
echo " (puede tardar ~10-15 min si hay imágenes nuevas)"
echo "==============================================="

echo "[1/5] Docker..."
asegurar_docker
echo "      Docker OK."

echo "[2/5] Backup de seguridad ANTES de parchear..."
bash "$PROJECT_DIR/scripts/backup.sh"

echo "[3/5] Bajando imágenes nuevas (couchdb, caddy)..."
# Los servicios con "image:" no los actualiza el build --pull: hay que pullearlos aparte.
compose pull --ignore-buildable

echo "[4/5] Rebuild con --pull (bases parcheadas de node, nginx y alpine)..."
compose build --pull

echo "[5/5] Levantar + verificar..."
bash "$PROJECT_DIR/scripts/arrancar.sh"

mkdir -p "$PROJECT_DIR/avances"
echo "$(date '+%Y-%m-%d %H:%M') - parcheo aplicado (pull + build --pull)" >> "$PROJECT_DIR/avances/parcheos.log"
echo ""
echo "  Parcheo aplicado y verificado. Registrado en avances/parcheos.log"
echo "  Si algo quedó mal, restaurá: ./scripts/restore.sh backups/<el backup de recién>.tgz"
echo "==============================================="
