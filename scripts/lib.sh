# Funciones comunes de los scripts. Se incluye desde cada script con:
#   source "$(dirname "$0")/lib.sh"
# Funciona igual en Windows (Git Bash + Docker Desktop) y en Linux (el server).

export MSYS_NO_PATHCONV=1   # Windows/Git Bash: evita que se mangleen los paths del contenedor. Inocuo en Linux.

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"
# Nombre FIJO del volumen de datos: sale de "name: asterics-grid" en docker-compose.yml.
VOLUME="asterics-grid_couchdb-data"

# docker compose parado en la carpeta del proyecto (lee docker-compose.yml y .env de ahí).
# Se usa `cd` y no `-f` porque el compose de Windows no entiende paths estilo Git Bash (/c/...).
compose() { ( cd "$PROJECT_DIR" && docker compose "$@" ); }

es_windows() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac; }

# Lee una variable del .env SIN ejecutarlo (ej: env_var AUTH_BASE_URL). Vacío si no está.
env_var() {
  [ -f "$PROJECT_DIR/.env" ] || return 0
  grep -E "^[[:space:]]*$1=" "$PROJECT_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '\r' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Se asegura de que Docker esté respondiendo (en Windows arranca Docker Desktop si hace falta).
asegurar_docker() {
  docker version >/dev/null 2>&1 && return 0
  if es_windows; then
    echo "      Docker no responde; arrancando Docker Desktop (puede tardar ~1 min)..."
    powershell.exe -NoProfile -Command "Start-Process 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'" >/dev/null 2>&1 || true
  else
    echo "      Docker no responde; intentando arrancar el servicio..."
    systemctl start docker >/dev/null 2>&1 || sudo systemctl start docker >/dev/null 2>&1 || true
  fi
  for _ in $(seq 1 40); do docker version >/dev/null 2>&1 && return 0; sleep 5; done
  echo "      ERROR: Docker no arrancó."
  return 1
}

# Clave de admin de CouchDB, leída del contenedor (así no hace falta tenerla en los scripts).
admin_pass() { compose exec -T couchdb printenv COUCHDB_PASSWORD 2>/dev/null | tr -d '\r\n'; }

# Espera hasta que CouchDB responda adentro del contenedor.
esperar_couchdb() {
  for _ in $(seq 1 60); do
    compose exec -T couchdb curl -fsS "http://127.0.0.1:5984/_up" >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "      ERROR: CouchDB no respondió en 2 minutos (mirá: docker compose logs --tail 50 couchdb)."
  return 1
}
