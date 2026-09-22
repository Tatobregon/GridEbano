#!/bin/bash
# Backup local + copia OFFSITE (fuera de esta máquina).
# Uso:  ./scripts/backup-offsite.sh [--consistente]
#
#   - En la PC (Windows): copia a Google Drive para escritorio (G:\Mi unidad\asterics-backups).
#   - En Linux: sube con rclone a RCLONE_DESTINO (del .env), que conviene que sea un remote CIFRADO.
#
# OJO: en el server de producción NO hace falta. Ahí la copia fuera del server la hacen las
# "Copias de Seguridad" de DonWeb, que se llevan el server entero (incluidos los .tgz de backups/).
# El cron del server corre  backup.sh --consistente  a secas. Ver docs/runbook-prod.md, fase 7.
# Este script queda para la PC y para el día que quieras copiar a otro proveedor.
set -e
source "$(dirname "$0")/lib.sh"
OFFSITE_RETENTION_DAYS=30   # en el destino seguro guardamos más historia que en local

echo "[1/2] Backup local..."
BACKUP_SIN_PING=1 bash "$PROJECT_DIR/scripts/backup.sh" "$@"   # el aviso lo manda este script al final
LATEST=$(ls -t "$BACKUP_DIR"/couchdb_*.tgz | head -1)

echo "[2/2] Copia OFFSITE..."
if es_windows; then
  OFFSITE_DIR="/g/Mi unidad/asterics-backups"
  if [ ! -d "/g/Mi unidad" ]; then
    echo "  ERROR: no encuentro Google Drive en 'G:\\Mi unidad'. ¿Está corriendo Google Drive para escritorio?"
    echo "  El backup local SÍ se hizo (en backups/). Reintentá la copia offsite cuando Drive esté montado."
    exit 1
  fi
  mkdir -p "$OFFSITE_DIR"
  cp "$LATEST" "$OFFSITE_DIR/"
  find "$OFFSITE_DIR" -name 'couchdb_*.tgz' -mtime +$OFFSITE_RETENTION_DAYS -delete 2>/dev/null || true
  echo "  Backup offsite OK: $OFFSITE_DIR/$(basename "$LATEST")"
else
  DESTINO="$(env_var RCLONE_DESTINO)"
  [ -n "$DESTINO" ] || { echo "  ERROR: falta RCLONE_DESTINO en el .env (ej: RCLONE_DESTINO=gdrive-cifrado:)."; exit 1; }
  command -v rclone >/dev/null || { echo "  ERROR: rclone no está instalado (apt install rclone)."; exit 1; }
  rclone copy "$LATEST" "$DESTINO"
  # Verificar que llegó (mismo nombre y mismo tamaño) antes de dar el OK.
  REMOTO_TAM=$(rclone lsf "$DESTINO" --include "$(basename "$LATEST")" --format s 2>/dev/null | head -1)
  LOCAL_TAM=$(wc -c < "$LATEST" | tr -d ' ')
  [ "$REMOTO_TAM" = "$LOCAL_TAM" ] \
    || { echo "  ERROR: la copia en $DESTINO no coincide con el archivo local ($REMOTO_TAM vs $LOCAL_TAM bytes)."; exit 1; }
  # Rotación en el destino.
  rclone delete "$DESTINO" --min-age "${OFFSITE_RETENTION_DAYS}d" --include 'couchdb_*.tgz' || true
  echo "  Backup offsite OK: $DESTINO$(basename "$LATEST")"
  PING="$(env_var BACKUP_PING_URL)"
  if [ -n "$PING" ]; then curl -fsS -m 10 --retry 3 "$PING" >/dev/null 2>&1 || true; fi
fi
