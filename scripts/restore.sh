#!/bin/bash
# Restaura un snapshot del volumen de CouchDB (generado por backup.sh).
# Uso: ./restore.sh <archivo.tgz> [--yes]
#   --yes : salta la confirmación interactiva (para automatización).
#
# QUÉ HACE: para couchdb, saca un snapshot de seguridad del estado ACTUAL (pre-restore_*.tgz),
# vacía el volumen, extrae el backup elegido y vuelve a arrancar couchdb.
set -e
export MSYS_NO_PATHCONV=1   # Windows/Git Bash: evita mangleo de paths del contenedor. Inocuo en Linux.

VOLUME="asterics-grid_couchdb-data"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Función que corre docker compose desde el dir del proyecto (subshell, no cambia el cwd del script).
# Se usa `cd` + compose SIN `-f` porque el binario Windows de compose no entiende paths estilo
# Git Bash (/c/Users/...) pasados a `-f`. Con cd, toma ./docker-compose.yml correctamente. Portable a Linux.
compose() { ( cd "$PROJECT_DIR" && docker compose "$@" ); }
BACKUP_FILE="$1"
CONFIRM="$2"

if [ -z "$BACKUP_FILE" ]; then
  echo "Uso: $0 <archivo.tgz> [--yes]"
  echo "Backups disponibles en $PROJECT_DIR/backups:"
  ls -1t "$PROJECT_DIR/backups"/*.tgz 2>/dev/null || echo "  (ninguno)"
  exit 1
fi
[ ! -f "$BACKUP_FILE" ] && { echo "ERROR: no existe el archivo: $BACKUP_FILE"; exit 1; }

echo "RESTORE: $BACKUP_FILE  ->  volumen $VOLUME"
echo "Esto REEMPLAZA todos los datos actuales de CouchDB."
if [ "$CONFIRM" != "--yes" ]; then
  printf "Escribí 'si' para continuar: "
  read -r ans
  [ "$ans" = "si" ] || { echo "Cancelado."; exit 1; }
fi

# 1) Parar couchdb para un restore consistente.
compose stop couchdb

# 2) Red de seguridad: snapshot del estado ACTUAL antes de pisarlo (por si el restore no era el correcto).
SAFETY="pre-restore_$(date +%Y-%m-%d_%H%M).tgz"
docker run --rm -v "${VOLUME}":/data:ro -v "$PROJECT_DIR/backups":/backup \
  alpine sh -c "tar czf /backup/$SAFETY -C /data ." || echo "AVISO: no se pudo sacar el snapshot de seguridad (volumen vacío?)"
echo "Snapshot de seguridad del estado previo: $PROJECT_DIR/backups/$SAFETY"

# 3) Vaciar el volumen y extraer el backup elegido.
docker run --rm -v "${VOLUME}":/data -v "$BACKUP_FILE":/backup.tgz:ro \
  alpine sh -c "rm -rf /data/..?* /data/.[!.]* /data/* 2>/dev/null; cd /data && tar xzf /backup.tgz"

# 4) Arrancar couchdb.
compose start couchdb
echo "Restore OK desde $(basename "$BACKUP_FILE"). Verificá con: curl http://localhost:5984/_all_dbs"
