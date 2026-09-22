#!/bin/bash
# Snapshot del volumen de datos de CouchDB, con verificación y rotación.
# Uso:  ./scripts/backup.sh                 (en caliente, sin cortar el servicio)
#       ./scripts/backup.sh --consistente   (para CouchDB ~10 s durante la copia: es el que usa el cron)
#
# Consistencia: en caliente, el formato append-only de CouchDB restaura a un estado consistente (a lo
# sumo se pierden los últimos segundos de escrituras). Con --consistente es 100% exacto; como la app
# es offline-first, los usuarios no notan el corte (el sync reintenta solo).
set -e
source "$(dirname "$0")/lib.sh"

RETENTION_DAYS=14
STAMP=$(date +%Y-%m-%d_%H%M)
ARCHIVO="$BACKUP_DIR/couchdb_${STAMP}.tgz"
mkdir -p "$BACKUP_DIR"

# Si el volumen no existe, `docker run -v` crearía uno VACÍO y el backup saldría vacío sin avisar.
docker volume inspect "$VOLUME" >/dev/null 2>&1 || {
  echo "ERROR: no existe el volumen $VOLUME (¿el stack se levantó alguna vez con este docker-compose.yml?)."
  exit 1
}

if [ "$1" = "--consistente" ]; then
  compose stop couchdb >/dev/null
  trap 'compose start couchdb >/dev/null' EXIT   # pase lo que pase, CouchDB vuelve a arrancar
fi

docker run --rm \
  -v "${VOLUME}":/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c "tar czf /backup/couchdb_${STAMP}.tgz -C /data ."

if [ "$1" = "--consistente" ]; then
  compose start couchdb >/dev/null
  trap - EXIT
fi

# Verificación: el archivo tiene que contener los datos de CouchDB (carpeta shards/).
if ! tar tzf "$ARCHIVO" 2>/dev/null | grep -q 'shards/'; then
  echo "ERROR: el backup $ARCHIVO no contiene datos de CouchDB. Lo borro para que no engañe."
  rm -f "$ARCHIVO"
  exit 1
fi

# Rotación: borrar backups locales más viejos que RETENTION_DAYS.
find "$BACKUP_DIR" -name 'couchdb_*.tgz' -mtime +$RETENTION_DAYS -delete

SIZE=$(du -h "$ARCHIVO" | cut -f1)
echo "Backup OK: $ARCHIVO ($SIZE)"

# Aviso de "salió bien" a un monitor externo (opcional: BACKUP_PING_URL en el .env; ej. healthchecks.io).
# Si una noche no llega el aviso, el monitor manda un mail. backup-offsite.sh avisa él mismo al final,
# así que cuando lo llama desde ahí, este ping se saltea.
PING="$(env_var BACKUP_PING_URL)"
if [ -n "$PING" ] && [ "${BACKUP_SIN_PING:-0}" != "1" ]; then
  curl -fsS -m 10 --retry 3 "$PING" >/dev/null 2>&1 || true
fi
