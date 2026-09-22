#!/bin/bash
# Chequeo completo del sitio desde AFUERA: que ande todo lo que la app necesita y que NO esté expuesto
# lo que no debe. Se puede correr desde el server o desde tu PC (Git Bash).
# Uso: ./scripts/verificar-sitio.sh [https://tu-dominio]     (por defecto, AUTH_BASE_URL del .env)
source "$(dirname "$0")/lib.sh"
URL="${1:-$(env_var AUTH_BASE_URL)}"
URL="${1:-$(env_var AUTH_BASE_URL)}"
[ -n "$URL" ] || { echo "Uso: $0 https://tu-dominio"; exit 1; }

FALLAS=0
chequear() { # <código esperado> <método> <ruta> <descripción>
  local cod
  cod=$(curl -s -o /dev/null -m 20 -w "%{http_code}" -X "$2" "$URL$3" 2>/dev/null || true)
  if [ "$cod" = "$1" ]; then
    printf "  OK     %-4s %-44s %s\n" "$cod" "$2 $3" "$4"
  else
    printf "  FALLA  %-4s %-44s %s (esperaba %s)\n" "${cod:-000}" "$2 $3" "$4" "$1"
    FALLAS=$((FALLAS+1))
  fi
}

echo "Verificando $URL"
echo ""
echo "Lo que la app NECESITA:"
chequear 200 GET  "/"                                   "la app"
chequear 200 GET  "/couchdb/"                           "CouchDB responde (sync)"
chequear 401 POST "/auth/login"                         "couch-auth responde (401 = credenciales vacías, está bien)"
chequear 200 GET  "/Asterics-AAC-Data/live_metadata.json" "tableros predefinidos (mirror propio)"
chequear 200 GET  "/crear-usuario-ebano-soluciones"     "panel de admin"
echo ""
echo "Lo que NO tiene que estar expuesto:"
chequear 404 GET  "/couchdb/_utils/"                    "panel de admin de CouchDB (Fauxton)"
chequear 404 POST "/couchdb/_session"                   "login directo al admin de CouchDB"
chequear 404 GET  "/couchdb/_all_dbs"                   "listado de bases"
chequear 404 GET  "/user/validate-username/prueba"      "enumeración de usuarios"
chequear 404 GET  "/api/infotree/tags"                  "API sin uso"
chequear 404 POST "/auth/request-deletion"              "borrado de cuenta desde la app"
chequear 403 POST "/auth/register"                      "registro público"
chequear 404 POST "/auth/register/"                     "registro público (variante)"
chequear 404 GET  "/.git/config"                        "historia de git"
chequear 404 GET  "/node_modules/"                      "dependencias de build"
chequear 404 GET  "/Asterics-AAC-Data/no-existe.json"   "404 limpio en tableros"

case "$URL" in
  https://*)
    echo ""
    echo "HTTPS:"
    HTTP_URL="http://${URL#https://}"
    cod=$(curl -s -o /dev/null -m 20 -w "%{http_code}" "$HTTP_URL/" 2>/dev/null || true)
    case "$cod" in 301|302|307|308) echo "  OK     $cod  http:// redirige a https://";; *) echo "  AVISO  $cod  http:// no redirige a https:// (en la PC con Funnel es normal)";; esac
    if curl -s -D - -o /dev/null -m 20 "$URL/" 2>/dev/null | grep -qi '^strict-transport-security'; then
      echo "  OK     HSTS presente"
    else
      echo "  FALLA  falta el header Strict-Transport-Security"; FALLAS=$((FALLAS+1))
    fi
    ;;
esac

echo ""
if [ "$FALLAS" -eq 0 ]; then echo "TODO OK."; else echo "$FALLAS chequeo(s) fallaron."; exit 1; fi
