#!/bin/bash
# Crea una cuenta de usuario online en couch-auth (SOLO admin). Alternativa por consola al panel web
# (/crear-usuario-ebano-soluciones).
# Uso: ./scripts/crear-usuario.sh <usuario> [contraseña] [email]
#   Si no pasás la contraseña, te la pide sin mostrarla (así no queda en el historial de la consola).
# Reglas: usuario en minúsculas / dígitos / _ / - , de 3 a 16 caracteres. Contraseña mínima 8.
#
# El registro público está BLOQUEADO: /auth/register exige el header X-Register-Secret. Este script
# lee ese secreto directamente del contenedor couch-auth (REGISTER_SECRET), así el admin no tiene
# que conocerlo ni tipearlo. Correr desde la máquina servidor (usa localhost + docker).
set -e
source "$(dirname "$0")/lib.sh"

AUTH_URL="http://localhost:3000"
USUARIO="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
PASS="$2"; EMAIL="${3:-$USUARIO@local.invalid}"
if [ -z "$USUARIO" ]; then
  echo "Uso: $0 <usuario> [contraseña(8+ chars)] [email]"; exit 1
fi
if [ -z "$PASS" ]; then
  read -r -s -p "Contraseña para '$USUARIO': " PASS; echo
  read -r -s -p "Repetila: " PASS2; echo
  [ "$PASS" = "$PASS2" ] || { echo "ERROR: no coinciden."; exit 1; }
fi
if [ "${#PASS}" -lt 8 ]; then
  echo "ERROR: la contraseña debe tener al menos 8 caracteres."; exit 1
fi

# Leer el secreto de registro desde el contenedor.
SECRET=$(compose exec -T couch-auth printenv REGISTER_SECRET | tr -d '\r\n')
if [ -z "$SECRET" ]; then
  echo "ERROR: no pude leer REGISTER_SECRET del contenedor couch-auth (¿está corriendo el stack?)."; exit 1
fi

# La app del Grid hashea la clave del lado del cliente antes de mandarla:
#   sha256_hex('STATIC_USER_PW_SALT' + clave)   (encryptionService.getUserPasswordHash)
# y manda ESE hash al registrar y al loguear. Por eso guardamos el MISMO hash: si guardáramos la
# clave plana, el login de la app (que manda el hash) no matchea. printf '%s' NO agrega newline
# (importante: el hash debe ser del string exacto, sin \n).
HASHED_PW=$(printf '%s' "STATIC_USER_PW_SALT$PASS" | sha256sum | cut -d' ' -f1)

curl -s -X POST "$AUTH_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "X-Register-Secret: $SECRET" \
  -d "{\"username\":\"$USUARIO\",\"email\":\"$EMAIL\",\"password\":\"$HASHED_PW\",\"confirmPassword\":\"$HASHED_PW\"}"
echo
echo "-------------------------------------------------------------------"
echo "IMPORTANTE: guardá estas credenciales en el gestor de contraseñas."
echo "  usuario: $USUARIO"
echo "  (si se pierde la contraseña, los datos del usuario NO se recuperan)"
echo "  ver: docs/politica-contrasenas.md"
echo "-------------------------------------------------------------------"
