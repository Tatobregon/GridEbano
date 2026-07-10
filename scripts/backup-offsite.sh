#!/bin/bash
# Backup local + copia OFFSITE a Google Drive (que la sube sola a la nube).
# Uso:  ./scripts/backup-offsite.sh
# Es el backup "de verdad": deja una copia fuera de la PC, así un disco muerto no se lleva todo.
# (backup.sh a secas es solo local; se usa para snapshots rápidos / red de seguridad.)
set -e
export MSYS_NO_PATHCONV=1
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Google Drive: unidad G:  ->  en Git Bash es /g/ . Carpeta dedicada para los backups.
OFFSITE_DIR="/g/Mi unidad/asterics-backups"
OFFSITE_RETENTION_DAYS=30   # en el destino seguro guardamos más historia que en local

echo "[1/2] Backup local..."
bash "$PROJECT_DIR/scripts/backup.sh"

echo "[2/2] Copia OFFSITE a Google Drive..."
if [ ! -d "/g/Mi unidad" ]; then
  echo "  ERROR: no encuentro Google Drive en 'G:\\Mi unidad'. ¿Está corriendo Google Drive para escritorio?"
  echo "  El backup local SÍ se hizo (en backups/). Reintentá la copia offsite cuando Drive esté montado."
  exit 1
fi
mkdir -p "$OFFSITE_DIR"
LATEST=$(ls -t "$PROJECT_DIR/backups"/couchdb_*.tgz | head -1)
cp "$LATEST" "$OFFSITE_DIR/"
# Rotación en el destino (borra copias más viejas que OFFSITE_RETENTION_DAYS).
find "$OFFSITE_DIR" -name 'couchdb_*.tgz' -mtime +$OFFSITE_RETENTION_DAYS -delete 2>/dev/null || true

echo ""
echo "  Backup offsite OK: $OFFSITE_DIR/$(basename "$LATEST")"
echo "  Google Drive lo sube a la nube automáticamente."
