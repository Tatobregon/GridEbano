#!/bin/bash
# Borra COMPLETAMENTE una cuenta de usuario (SOLO admin): su registro en auth-users y su(s) base(s)
# personal(es). Con esto el nombre de usuario queda LIBRE para volver a crearlo.
# Uso: ./scripts/borrar-usuario.sh <usuario> [--yes]
#   --yes  salta la confirmación interactiva (para scripting).
#
# ATENCIÓN: es IRREVERSIBLE. Borra los datos (tableros) del usuario. Las sesiones temporales en
# _users expiran solas y no hace falta tocarlas. Correr desde la máquina servidor (usa docker).
# (El JSON se procesa con node DENTRO del contenedor de couch-auth: no depende de tener python.)
set -e
source "$(dirname "$0")/lib.sh"

USUARIO="$1"
if [ -z "$USUARIO" ]; then echo "Uso: $0 <usuario> [--yes]"; exit 1; fi

CDB() { compose exec -T couchdb bash -c "curl -s $1 \"http://admin:\$COUCHDB_PASSWORD@127.0.0.1:5984/$2\""; }
# Evalúa una expresión JS sobre el JSON que entra por stdin (variable d). Ej: json 'd._rev'
json() { compose exec -T couch-auth node -e \
  "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);const r=($1);console.log(r===undefined?'':r)})"; }

[ -n "$(admin_pass)" ] || { echo "ERROR: no pude leer COUCHDB_PASSWORD del contenedor (¿está el stack arriba?)."; exit 1; }

# Buscar el doc en auth-users por username (vista view-usernames: emite key=username -> id del doc).
ROW=$(CDB "" "auth-users/_design/views/_view/view-usernames?key=%22$USUARIO%22")
ID=$(printf '%s' "$ROW" | json "(d.rows||[]).length ? d.rows[0].id : ''")
if [ -z "$ID" ]; then echo "No existe el usuario '$USUARIO' en auth-users. Nada que borrar."; exit 1; fi

DOC=$(CDB "" "auth-users/$ID")
REV=$(printf '%s' "$DOC" | json "d._rev")
DBS=$(printf '%s' "$DOC" | json "Object.keys(d.personalDBs||{}).join('\n')")

echo "Usuario a borrar: $USUARIO   (doc $ID)"
if [ -n "$DBS" ]; then echo "Bases personales (datos) que se borran:"; echo "$DBS" | sed 's/^/  - /'; else echo "  (sin bases personales asociadas)"; fi

if [ "$2" != "--yes" ]; then
  printf "Esto es IRREVERSIBLE. Escribí SI para confirmar: "
  read -r C
  [ "$C" = "SI" ] || { echo "Cancelado."; exit 1; }
fi

for db in $DBS; do
  # El nombre de la base tiene un "$" (asterics-grid-data$...): en la URL va como %24.
  CDB "-X DELETE -o /dev/null" "$(printf '%s' "$db" | sed 's/\$/%24/g')" && echo "  base borrada  -> $db"
done
CDB "-X DELETE -o /dev/null" "auth-users/$ID?rev=$REV" && echo "  registro borrado -> auth-users/$ID"
echo "Listo. El usuario '$USUARIO' quedó libre para volver a crearlo."
