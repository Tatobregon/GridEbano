#!/bin/bash
# Crea una cuenta de usuario online en couch-auth (SOLO admin).
# Uso: ./crear-usuario.sh <usuario> <contraseña> [email]
# Reglas: usuario en minúsculas / dígitos / _ / - , de 3 a 16 caracteres. Contraseña mínima 8.
#
# El registro público está BLOQUEADO: /auth/register exige el header X-Register-Secret. Este script
# lee ese secreto directamente del contenedor couch-auth (REGISTER_SECRET), así el admin no tiene
# que conocerlo ni tipearlo. Correr desde la máquina servidor (usa localhost + docker).
set -e
export MSYS_NO_PATHCONV=1   # Windows/Git Bash: evita mangleo de paths. Inocuo en Linux.
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
compose() { ( cd "$PROJECT_DIR" && docker compose "$@" ); }

AUTH_URL="http://localhost:3000"
USER="$1"; PASS="$2"; EMAIL="${3:-$1@local.invalid}"
if [ -z "$USER" ] || [ -z "$PASS" ]; then
  echo "Uso: $0 <usuario> <contraseña(8+ chars)> [email]"; exit 1
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
  -d "{\"username\":\"$USER\",\"email\":\"$EMAIL\",\"password\":\"$HASHED_PW\",\"confirmPassword\":\"$HASHED_PW\"}"
echo
echo "-------------------------------------------------------------------"
echo "IMPORTANTE: guardá estas credenciales en el gestor de contraseñas."
echo "  usuario: $USER"
echo "  (si se pierde la contraseña, los datos del usuario NO se recuperan)"
echo "  ver: docs/politica-contrasenas.md"
echo "-------------------------------------------------------------------"
