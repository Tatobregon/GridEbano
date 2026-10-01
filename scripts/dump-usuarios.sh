#!/bin/bash
# Guarda un "punto de recuperación" por usuario: sus documentos (cifrados) en backups/historial/.
# Lo corre el cron todas las noches, después del backup.sh. Desde el panel de admin se elige la
# fecha y se baja el .grd de ese momento.
#
# Uso: ./scripts/dump-usuarios.sh [--forzar] [--usuario <nombre>]
#   --forzar   vuelca aunque el usuario no haya cambiado desde el último volcado
#   --usuario  vuelca solo a ese usuario
#
# POR QUÉ un contenedor aparte y no couch-auth: couch-auth es el que mira a internet, y monta esta
# carpeta SOLO LECTURA. El que escribe es este contenedor descartable, que no publica ningún puerto.
set -e
source "$(dirname "$0")/lib.sh"

HISTORIAL="$BACKUP_DIR/historial"
RETENCION_DIAS="${RETENCION_DIAS:-30}"
FORZAR=0
SOLO_USUARIO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --forzar)  FORZAR=1 ;;
    --usuario) shift; SOLO_USUARIO="$1" ;;
    *) echo "Opción desconocida: $1"; echo "Uso: $0 [--forzar] [--usuario <nombre>]"; exit 1 ;;
  esac
  shift
done

asegurar_docker || exit 1
mkdir -p "$HISTORIAL"

PASS="$(admin_pass)"
[ -n "$PASS" ] || { echo "ERROR: no pude leer COUCHDB_PASSWORD del contenedor (¿está el stack arriba?)."; exit 1; }

# La red del stack, sacada del propio contenedor de couchdb (no la hardcodeamos: depende del
# nombre del proyecto y así anda igual en la PC y en el server).
CID="$(compose ps -q couchdb)"
[ -n "$CID" ] || { echo "ERROR: el contenedor de couchdb no está corriendo."; exit 1; }
RED="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CID" | head -1)"
[ -n "$RED" ] || { echo "ERROR: no pude averiguar la red de Docker del stack."; exit 1; }

# El sello de tiempo lo pone ACÁ (hora local del server). Adentro del contenedor la hora es UTC.
FECHA="$(date +%Y-%m-%d_%H%M)"

# Imagen: la misma base que usa couch-auth, así ya está descargada y no baja nada.
docker run --rm \
  --network "$RED" \
  -v "$PROJECT_DIR/scripts/dump-usuarios.js":/dump-usuarios.js:ro \
  -v "$HISTORIAL":/salida \
  -e COUCHDB_URL="http://couchdb:5984" \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD="$PASS" \
  -e SALIDA=/salida \
  -e FECHA="$FECHA" \
  -e RETENCION_DIAS="$RETENCION_DIAS" \
  -e FORZAR="$FORZAR" \
  -e SOLO_USUARIO="$SOLO_USUARIO" \
  node:22-bookworm-slim node /dump-usuarios.js

TOTAL=$(du -sh "$HISTORIAL" 2>/dev/null | cut -f1)
echo "Historial en $HISTORIAL (total: ${TOTAL:-?}, se conservan $RETENCION_DIAS días)."
