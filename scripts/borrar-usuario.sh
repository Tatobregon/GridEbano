#!/bin/bash
# Borra COMPLETAMENTE una cuenta de usuario (SOLO admin): su registro en auth-users y su(s) base(s)
# personal(es). Con esto el nombre de usuario queda LIBRE para volver a crearlo.
# Uso: ./borrar-usuario.sh <usuario> [--yes]
#   --yes  salta la confirmación interactiva (para scripting).
#
# ATENCIÓN: es IRREVERSIBLE. Borra los datos (tableros) del usuario. Las sesiones temporales en
# _users expiran solas y no hace falta tocarlas. Correr desde la máquina servidor (usa docker).
set -e
export MSYS_NO_PATHCONV=1   # Windows/Git Bash: evita mangleo de paths. Inocuo en Linux.
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
compose() { ( cd "$PROJECT_DIR" && docker compose "$@" ); }

USER="$1"
if [ -z "$USER" ]; then echo "Uso: $0 <usuario> [--yes]"; exit 1; fi

PW=$(compose exec -T couchdb printenv COUCHDB_PASSWORD | tr -d '\r\n')
if [ -z "$PW" ]; then echo "ERROR: no pude leer COUCHDB_PASSWORD del contenedor (¿está el stack arriba?)."; exit 1; fi
CDB() { compose exec -T couchdb curl -s "$@"; }
BASE="http://admin:$PW@127.0.0.1:5984"

# Buscar el doc en auth-users por username (vista view-usernames: emite key=username -> id del doc).
ROW=$(CDB "$BASE/auth-users/_design/views/_view/view-usernames?key=%22$USER%22")
ID=$(printf '%s' "$ROW" | python -c "import sys,json;r=json.load(sys.stdin)['rows'];print(r[0]['id'] if r else '')")
if [ -z "$ID" ]; then echo "No existe el usuario '$USER' en auth-users. Nada que borrar."; exit 1; fi

DOC=$(CDB "$BASE/auth-users/$ID")
REV=$(printf '%s' "$DOC" | python -c "import sys,json;print(json.load(sys.stdin)['_rev'])")
DBS=$(printf '%s' "$DOC" | python -c "import sys,json;d=json.load(sys.stdin);print('\n'.join((d.get('personalDBs') or {}).keys()))")

echo "Usuario a borrar: $USER   (doc $ID)"
if [ -n "$DBS" ]; then echo "Bases personales (datos) que se borran:"; echo "$DBS" | sed 's/^/  - /'; else echo "  (sin bases personales asociadas)"; fi

if [ "$2" != "--yes" ]; then
  printf "Esto es IRREVERSIBLE. Escribí SI para confirmar: "
  read C
  [ "$C" = "SI" ] || { echo "Cancelado."; exit 1; }
fi

for db in $DBS; do
  CDB -X DELETE "$BASE/$db" >/dev/null && echo "  base borrada  -> $db"
done
CDB -X DELETE "$BASE/auth-users/$ID?rev=$REV" >/dev/null && echo "  registro borrado -> auth-users/$ID"
echo "Listo. El usuario '$USER' quedó libre para volver a crearlo."
