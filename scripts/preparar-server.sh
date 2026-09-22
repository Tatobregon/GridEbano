#!/bin/bash
# Prepara un Ubuntu 24.04 recién instalado para correr el stack. Se corre UNA vez, como root:
#   sudo bash scripts/preparar-server.sh
# Es idempotente: si lo corrés de nuevo no rompe nada.
#
# Hace: actualiza el sistema, zona horaria de Córdoba, instala Docker + Compose, agrega swap (el
# build del frontend usa bastante memoria), firewall (solo SSH, HTTP y HTTPS), fail2ban (bloquea
# IPs que prueban contraseñas por SSH), actualizaciones de seguridad automáticas y rclone (backups).
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "ERROR: correlo como root:  sudo bash scripts/preparar-server.sh"; exit 1; }
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || echo "AVISO: esto está pensado para Ubuntu 24.04 (detecté: ${PRETTY_NAME:-?}). Sigo igual."
export DEBIAN_FRONTEND=noninteractive

echo "[1/8] Actualizando el sistema (puede tardar unos minutos)..."
apt-get update -q
apt-get -y -q -o Dpkg::Options::="--force-confold" upgrade
apt-get install -y -q ca-certificates curl git ufw fail2ban unattended-upgrades rclone

echo "[2/8] Zona horaria (para que el cron y los logs estén en hora argentina)..."
timedatectl set-timezone America/Argentina/Cordoba
systemctl restart cron 2>/dev/null || true   # cron toma la zona horaria al arrancar

echo "[3/8] Docker..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version

echo "[4/8] Swap..."
if [ -n "$(swapon --show --noheadings)" ]; then
  echo "      Ya hay swap: $(swapon --show --noheadings | awk '{print $1, $3}')"
else
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "      Swap de 2 GB creada."
fi

echo "[5/8] Firewall (ufw): solo SSH, HTTP y HTTPS..."
# OJO: Docker se saltea ufw para los puertos que publica. Por eso en docker-compose.yml CouchDB,
# couch-auth y nginx están atados a 127.0.0.1: los únicos puertos públicos son 80/443 de Caddy.
# El puerto de SSH se detecta (el de la conexión actual y en el que escucha sshd): si el proveedor
# usa uno distinto de 22 y lo cerráramos, te quedarías afuera del server.
SSH_PORTS="$( { echo "${SSH_CONNECTION:-}" | awk '{print $4}'; ss -tlnpH 2>/dev/null | awk '/sshd/ {print $4}' | sed 's/.*://'; echo 22; } | grep -E '^[0-9]+$' | sort -u )"
for p in $SSH_PORTS; do ufw allow "$p/tcp" >/dev/null; echo "      SSH permitido en el puerto $p"; done
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ufw status | sed 's/^/      /'

echo "[6/8] fail2ban (protege el SSH de fuerza bruta)..."
systemctl enable --now fail2ban >/dev/null 2>&1
fail2ban-client status sshd 2>/dev/null | head -3 | sed 's/^/      /' || echo "      fail2ban activo."

echo "[7/8] Actualizaciones de seguridad automáticas..."
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

echo "[8/8] Resumen"
echo "      Docker:   $(docker --version)"
echo "      Compose:  $(docker compose version --short 2>/dev/null)"
echo "      rclone:   $(rclone version 2>/dev/null | head -1)"
echo "      RAM:      $(free -h | awk '/Mem:/ {print $2}')   Swap: $(free -h | awk '/Swap:/ {print $2}')"
echo "      Disco:    $(df -h / | awk 'NR==2 {print $4 " libres de " $2}')"
echo "      Hora:     $(date)"
echo ""
echo "  Server listo. Siguiente paso: crear el .env (docs/runbook-prod.md, fase 4)."
