#!/bin/bash
# Convierte los backups .tgz que ya existen en "puntos de recuperación" por usuario, para que el
# panel de admin pueda ofrecer esas fechas. Se corre UNA VEZ, cuando se estrena el historial.
#
# Uso: ./scripts/historial-desde-tgz.sh [--desde <archivo.tgz>] [--limite N]
#   --desde   procesa un solo backup
#   --limite  procesa solo los N backups más nuevos (default: todos)
#
# CÓMO FUNCIONA: por cada .tgz levanta un CouchDB TEMPORAL y aislado (red propia, sin puertos
# publicados), apuntado a una copia de esos datos, le pide los documentos de cada usuario y los
# guarda en backups/historial/. Después lo apaga y borra todo lo temporal.
#
# LA BASE DE PRODUCCIÓN NO SE TOCA EN NINGÚN MOMENTO: ni se lee ni se escribe.
#
# OJO CON EL ESPACIO: mientras procesa un backup necesita en disco el tamaño de ese backup
# descomprimido. Si andás justo de espacio, usá --limite.
set -e
source "$(dirname "$0")/lib.sh"

HISTORIAL="$BACKUP_DIR/historial"
SOLO_ARCHIVO=""
LIMITE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --desde)  shift; SOLO_ARCHIVO="$1" ;;
    --limite) shift; LIMITE="$1" ;;
    *) echo "Opción desconocida: $1"; echo "Uso: $0 [--desde <archivo.tgz>] [--limite N]"; exit 1 ;;
  esac
  shift
done

asegurar_docker || exit 1
mkdir -p "$HISTORIAL"

PASS_TMP="historialtemporal$$"
NOMBRE="grid-historial-couch-$$"
RED="grid-historial-red-$$"
TMPDATA="$BACKUP_DIR/.tmp-historial-$$"

limpiar_todo() {
  docker rm -f "$NOMBRE" >/dev/null 2>&1 || true
  docker network rm "$RED"  >/dev/null 2>&1 || true
  [ -d "$TMPDATA" ] && docker run --rm -v "$TMPDATA":/d alpine sh -c "rm -rf /d/..?* /d/.[!.]* /d/* 2>/dev/null" >/dev/null 2>&1 || true
  rm -rf "$TMPDATA" 2>/dev/null || true
}
trap limpiar_todo EXIT

# Qué backups procesar, del MÁS VIEJO al más nuevo (así la detección de "no cambió" funciona bien:
# cada fecha se compara contra la anterior y no se guardan copias repetidas).
if [ -n "$SOLO_ARCHIVO" ]; then
  [ -f "$SOLO_ARCHIVO" ] || { echo "ERROR: no existe $SOLO_ARCHIVO"; exit 1; }
  ARCHIVOS="$SOLO_ARCHIVO"
else
  ARCHIVOS=$(ls -1 "$BACKUP_DIR"/couchdb_*.tgz 2>/dev/null | sort)
  if [ "$LIMITE" -gt 0 ] 2>/dev/null; then
    ARCHIVOS=$(echo "$ARCHIVOS" | tail -n "$LIMITE")
  fi
fi
[ -n "$ARCHIVOS" ] || { echo "No encontré backups couchdb_*.tgz en $BACKUP_DIR."; exit 1; }

CUANTOS=$(echo "$ARCHIVOS" | wc -l | tr -d ' ')
echo "Voy a procesar $CUANTOS backup(s). La base de producción no se toca."
echo

docker network create "$RED" >/dev/null

PROCESADOS=0
SALTADOS=0
for TGZ in $ARCHIVOS; do
  NOMBRE_ARCHIVO=$(basename "$TGZ")
  # couchdb_2026-09-24_0030.tgz -> 2026-09-24_0030
  FECHA=$(echo "$NOMBRE_ARCHIVO" | sed -n 's/^couchdb_\(....-..-.._....\)\.tgz$/\1/p')
  if [ -z "$FECHA" ]; then
    echo "[$NOMBRE_ARCHIVO] nombre inesperado, lo salteo."
    SALTADOS=$((SALTADOS+1)); continue
  fi
  if ! tar tzf "$TGZ" 2>/dev/null | grep -q 'shards/'; then
    echo "[$NOMBRE_ARCHIVO] no parece un backup de CouchDB, lo salteo."
    SALTADOS=$((SALTADOS+1)); continue
  fi

  echo "[$FECHA] preparando una copia temporal..."
  rm -rf "$TMPDATA"; mkdir -p "$TMPDATA"
  # Se extrae DENTRO de un contenedor para que los archivos queden con el dueño que espera CouchDB.
  docker run --rm -v "$TMPDATA":/data -v "$BACKUP_DIR":/backup:ro \
    alpine sh -c "cd /data && tar xzf /backup/$NOMBRE_ARCHIVO"

  docker rm -f "$NOMBRE" >/dev/null 2>&1 || true
  # CouchDB temporal: misma imagen que producción (para que el nombre de nodo coincida y reconozca
  # los datos), red propia y SIN publicar puertos.
  docker run -d --name "$NOMBRE" --network "$RED" \
    -v "$TMPDATA":/opt/couchdb/data \
    -e COUCHDB_USER=admin -e COUCHDB_PASSWORD="$PASS_TMP" \
    couchdb:3.4 >/dev/null

  LISTO=0
  for _ in $(seq 1 60); do
    if docker exec "$NOMBRE" curl -fsS "http://127.0.0.1:5984/_up" >/dev/null 2>&1; then LISTO=1; break; fi
    sleep 2
  done
  if [ "$LISTO" != "1" ]; then
    echo "[$FECHA] el CouchDB temporal no arrancó; lo salteo. (docker logs $NOMBRE)"
    docker rm -f "$NOMBRE" >/dev/null 2>&1 || true
    SALTADOS=$((SALTADOS+1)); continue
  fi

  # Chequeo de que los datos se montaron de verdad (si no, volcaríamos "nada" sin avisar).
  if ! docker exec "$NOMBRE" curl -fsS "http://admin:$PASS_TMP@127.0.0.1:5984/_all_dbs" 2>/dev/null | grep -q 'auth-users'; then
    echo "[$FECHA] el backup se montó pero no aparece auth-users; lo salteo."
    docker rm -f "$NOMBRE" >/dev/null 2>&1 || true
    SALTADOS=$((SALTADOS+1)); continue
  fi

  docker run --rm --network "$RED" \
    -v "$PROJECT_DIR/scripts/dump-usuarios.js":/dump-usuarios.js:ro \
    -v "$HISTORIAL":/salida \
    -e COUCHDB_URL="http://$NOMBRE:5984" \
    -e COUCHDB_USER=admin \
    -e COUCHDB_PASSWORD="$PASS_TMP" \
    -e SALIDA=/salida \
    -e FECHA="$FECHA" \
    -e RETENCION_DIAS=100000 \
    node:22-bookworm-slim node /dump-usuarios.js || echo "[$FECHA] hubo errores volcando (sigo con el resto)"

  docker rm -f "$NOMBRE" >/dev/null 2>&1 || true
  rm -rf "$TMPDATA" 2>/dev/null || docker run --rm -v "$TMPDATA":/d alpine sh -c "rm -rf /d/* /d/.[!.]*" >/dev/null 2>&1 || true
  PROCESADOS=$((PROCESADOS+1))
  echo
done

echo "Listo: $PROCESADOS backup(s) procesado(s), $SALTADOS salteado(s)."
echo "Historial en $HISTORIAL ($(du -sh "$HISTORIAL" 2>/dev/null | cut -f1))."
echo "Las fechas ya tienen que aparecer en el panel de admin, en 'Recuperar comunicador'."
