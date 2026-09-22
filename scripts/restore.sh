#!/bin/bash
# Restaura un snapshot del volumen de CouchDB (generado por backup.sh).
# Uso: ./scripts/restore.sh <archivo.tgz> [--yes]
#   --yes : salta la confirmación interactiva (para automatización).
#
# QUÉ HACE: valida el archivo, para couchdb, saca un snapshot de seguridad del estado ACTUAL
# (pre-restore_*.tgz), vacía el volumen, extrae el backup elegido y vuelve a arrancar couchdb.
#
# OJO: restaura TODAS las bases (todos los usuarios vuelven al momento del backup). Para recuperar
# lo que borró UN usuario esto no alcanza: ver docs/runbook-prod.md, "Recuperar datos".
set -e
source "$(dirname "$0")/lib.sh"

if [ -z "$1" ]; then
  echo "Uso: $0 <archivo.tgz> [--yes]"
  echo "Backups disponibles en $BACKUP_DIR:"
  ls -1t "$BACKUP_DIR"/*.tgz 2>/dev/null || echo "  (ninguno)"
  exit 1
fi
[ -f "$1" ] || { echo "ERROR: no existe el archivo: $1"; exit 1; }
# Ruta ABSOLUTA: Docker toma una ruta relativa (backups/x.tgz) como nombre de volumen y falla.
BACKUP_FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
CONFIRM="$2"

# Validar ANTES de parar nada: que sea un .tgz sano y que tenga datos de CouchDB.
tar tzf "$BACKUP_FILE" 2>/dev/null | grep -q 'shards/' \
  || { echo "ERROR: $BACKUP_FILE no es un backup válido de CouchDB. No toqué nada."; exit 1; }
docker volume inspect "$VOLUME" >/dev/null 2>&1 \
  || { echo "ERROR: no existe el volumen $VOLUME. No toqué nada."; exit 1; }

echo "RESTORE: $BACKUP_FILE  ->  volumen $VOLUME"
echo "Esto REEMPLAZA todos los datos actuales de CouchDB."
if [ "$CONFIRM" != "--yes" ]; then
  printf "Escribí 'si' para continuar: "
  read -r ans
  [ "$ans" = "si" ] || { echo "Cancelado."; exit 1; }
fi

# 1) Parar couchdb para un restore consistente. Pase lo que pase, al salir vuelve a arrancar.
compose stop couchdb
trap 'compose start couchdb' EXIT

# 2) Red de seguridad: snapshot del estado ACTUAL antes de pisarlo (por si el restore no era el correcto).
mkdir -p "$BACKUP_DIR"
SAFETY="pre-restore_$(date +%Y-%m-%d_%H%M).tgz"
docker run --rm -v "${VOLUME}":/data:ro -v "$BACKUP_DIR":/backup \
  alpine sh -c "tar czf /backup/$SAFETY -C /data ." || echo "AVISO: no se pudo sacar el snapshot de seguridad (volumen vacío?)"
echo "Snapshot de seguridad del estado previo: $BACKUP_DIR/$SAFETY"

# 3) Vaciar el volumen y extraer el backup elegido.
docker run --rm -v "${VOLUME}":/data -v "$BACKUP_FILE":/backup.tgz:ro \
  alpine sh -c "rm -rf /data/..?* /data/.[!.]* /data/* 2>/dev/null; cd /data && tar xzf /backup.tgz"

# 4) Arrancar couchdb (lo hace el trap) y reiniciar couch-auth/frontend para que se reconecten limpio.
compose start couchdb
trap - EXIT
esperar_couchdb
compose restart couch-auth frontend >/dev/null
echo "Restore OK desde $(basename "$BACKUP_FILE")."
