#!/bin/bash
# Snapshot del volumen de datos de CouchDB con rotación.
# El nombre del volumen es <carpeta>_couchdb-data (confirmar con: docker volume ls)
#
# Consistencia: se tar-ea el volumen EN CALIENTE (couchdb corriendo). El formato de CouchDB es
# append-only y escribe el header al final, así que un snapshot en caliente restaura a un estado
# consistente (a lo sumo se pierden los últimos segundos de escrituras, nunca datos ya commiteados).
# Para un backup 100% consistente podés parar couchdb antes (`docker compose stop couchdb`) y
# arrancarlo después, a costa de unos segundos de downtime.
set -e
export MSYS_NO_PATHCONV=1   # Windows/Git Bash: evita que se mangleen los paths del contenedor. Inocuo en Linux.

BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
VOLUME="asterics-grid_couchdb-data"
RETENTION_DAYS=14
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$BACKUP_DIR"

docker run --rm \
  -v "${VOLUME}":/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c "tar czf /backup/couchdb_${STAMP}.tgz -C /data ."

# Rotación: borrar backups más viejos que RETENTION_DAYS.
find "$BACKUP_DIR" -name 'couchdb_*.tgz' -mtime +$RETENTION_DAYS -delete

SIZE=$(du -h "$BACKUP_DIR/couchdb_${STAMP}.tgz" | cut -f1)
echo "Backup OK: $BACKUP_DIR/couchdb_${STAMP}.tgz ($SIZE)"
