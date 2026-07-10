# Checklist de operación — AsTeRICS Grid (servidor local)

Guía rápida para operar el servidor y para rescatarlo si algo falla. Tenela a mano.

---

## 🔑 Referencia rápida

| Cosa | Valor / comando |
|---|---|
| URL pública | **https://pc-tato.taila78f74.ts.net** |
| **Arrancar TODO** | `./scripts/arrancar.sh` |
| Estado | `docker compose ps` y `"/c/Program Files/Tailscale/tailscale.exe" funnel status` |
| Apagar (datos quedan) | `docker compose down` |
| Crear usuario | `./scripts/crear-usuario.sh <usuario> <clave 8+>` |
| Backup (local + **offsite** a Google Drive) | `./scripts/backup-offsite.sh` |
| Backup solo local (rápido) | `./scripts/backup.sh` |
| Restaurar | `./scripts/restore.sh backups/<archivo>.tgz` |
| Parchear (seguridad) | `./scripts/parchear.sh` |
| Ver logs | `docker compose logs -f couch-auth` (o `couchdb` / `frontend`) |

> Los scripts `.sh` se corren en **Git Bash**, parado en la carpeta del proyecto.

**Secretos (están en `docker-compose.yml`):** clave admin de CouchDB (`COUCHDB_PASSWORD`) y secreto de
registro (`REGISTER_SECRET`). No hace falta memorizarlos; los scripts los leen solos.

---

## 🟢 Operación diaria

1. **Prender:** abrí Git Bash en la carpeta y corré `./scripts/arrancar.sh`. Espera hasta ver **"TODO ARRIBA"**.
2. **Crear un usuario:** `./scripts/crear-usuario.sh juanperez MiClaveSegura2026` → debe decir `{"success":"Request processed."}`.
3. **Backup antes de algo importante:** `./scripts/backup.sh`.
4. **Apagar al final del día (opcional):** `docker compose down`. Los datos quedan en el volumen.

> **Recordá:** el servicio solo anda con **la PC prendida y Docker Desktop corriendo**.

---

## 🔧 Si algo falla — diagnóstico

| Síntoma | Causa probable | Solución |
|---|---|---|
| La web no carga desde ningún lado | Docker apagado o Funnel caído | Corré **`./scripts/arrancar.sh`** (arranca Docker + todo + Funnel) |
| Después de reiniciar la PC | Todo apagado | Corré **`./scripts/arrancar.sh`** |
| La nube queda en **X** / no sincroniza / se cuelga cargando | Red de Docker desalineada | `docker compose down && docker compose up -d`, luego `./scripts/arrancar.sh` |
| "No se pudo verificar el nombre de usuario" en la UI | Falta la vista `view-usernames` | `./scripts/arrancar.sh` la recrea |
| couch-auth en `Restarting` (`docker compose ps`) | Falta una base o la vista | `./scripts/arrancar.sh` (recrea bases + vista) |
| couchdb en `Restarting` | `docker.ini` con `[admins]` de una clave vieja | Borrá la sección `[admins]` de `couchdb-config/docker.ini` y `docker compose up -d` |
| El navegador muestra una versión vieja | Service worker cacheado | F12 → Application → Service Workers → **Unregister** → recargar |
| El script de crear-usuario da error de secreto | Stack apagado | Prendé todo con `arrancar.sh` y reintentá |
| No entra desde afuera pero sí local | Funnel apagado | `"/c/Program Files/Tailscale/tailscale.exe" funnel --bg --https=443 9095` |
| Registro público "no anda" (da 403) | **Es a propósito** | El registro está cerrado; los usuarios los creás vos con el script |

**Ver qué está roto:**
```bash
docker compose ps                          # ¿los 3 en "running"?
docker compose logs --tail 30 couch-auth   # errores de auth
docker compose logs --tail 30 couchdb      # errores de base
docker compose exec couchdb curl -s http://127.0.0.1:5984/_up   # ¿couchdb responde adentro?
```

---

## 🚨 Recuperación de emergencia

**Perdí datos / se corrompió algo:**
```bash
./scripts/restore.sh backups/<el-backup-mas-reciente>.tgz
```
(Restaura ese snapshot. Antes de pisar nada, guarda un `pre-restore_*.tgz` del estado actual.)

**Reconstruir las imágenes desde cero (sin perder datos):**
```bash
docker compose up -d --build
./scripts/arrancar.sh
```

**Nunca uses `docker compose down -v`** salvo que quieras **borrar TODOS los datos** (el `-v` elimina el volumen). Un `down` normal es seguro (los datos quedan).

---

## 💾 Qué NO hay que perder nunca

- El **volumen `asterics-grid_couchdb-data`** → los datos de todos los usuarios.
- La carpeta **`backups/`** → los snapshots.
- El **`docker-compose.yml`** → tiene las claves.
- Las **contraseñas de los usuarios** → si se pierden, sus datos quedan cifrados sin retorno (no hay recuperación por mail).

> Ideal: copiá los backups **fuera de esta PC** (otro disco / nube) cada tanto. Si se muere el disco, el backup no debe morir con él.
