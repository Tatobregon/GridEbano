# AsTeRICS Grid — auto-hospedado

Versión auto-hospedada y **congelada** de [AsTeRICS Grid](https://github.com/asterics/AsTeRICS-Grid)
(app de Comunicación Aumentativa y Alternativa), servida por HTTPS con backups, registro cerrado y
endurecimiento de seguridad.

Este repositorio contiene **nuestras modificaciones** (Dockerfiles, patches, configs y scripts) sobre
el AsTeRICS Grid upstream, que se referencia por tag y se construye en tiempo de build.

## Configuración

```bash
cp .env.example .env      # y completá claves (solo letras y números) y la URL pública
```

## Arranque

```bash
./scripts/arrancar.sh     # levanta el stack + inicializa + verifica ("TODO ARRIBA")
```

En producción (DonWeb) seguí **`docs/runbook-prod.md`**, que va paso a paso desde contratar el
server hasta los backups cifrados.

## Scripts

```bash
./scripts/crear-usuario.sh <usuario>              # alta de usuario (solo admin; pide la clave)
./scripts/borrar-usuario.sh <usuario>             # baja completa (irreversible)
./scripts/backup.sh [--consistente]               # snapshot de la base (el del cron en el server)
./scripts/backup-offsite.sh [--consistente]       # además, copia a otra máquina/proveedor (rclone)
./scripts/restore.sh backups/<archivo>.tgz        # restaurar (todo el servidor)
./scripts/parchear.sh                             # parches de seguridad (pull + rebuild --pull)
./scripts/verificar-sitio.sh [https://dominio]    # chequeo desde afuera (lo necesario anda, lo sensible da 404)
sudo bash scripts/preparar-server.sh              # una sola vez, en un Ubuntu 24.04 nuevo
```

## Documentación

- **`avances/estado-del-proyecto.md`** — estado, decisiones y por qué (registro de avance).
- **`docs/checklist-operacion.md`** — guía de rescate (síntoma → fix).
- **`docs/procedimiento-parcheo.md`**, **`docs/politica-contrasenas.md`**, **`docs/licencia-y-publicacion.md`**.
- **`docs/runbook-prod.md`** — despliegue y operación en el server (paso a paso).
- `docs/runbook-local.md` — obsoleto, se conserva como historia.
- **`CLAUDE.md`** — contexto completo del proyecto.

## Licencia

AsTeRICS Grid está bajo **AGPL-3.0**. Este proyecto es un **trabajo derivado** (lo modificamos y lo
servimos por red), por lo que **el código fuente correspondiente se pone a disposición de los usuarios**
en este repositorio, en cumplimiento de la AGPL-3.0.

- Upstream: https://github.com/asterics/AsTeRICS-Grid (release pineado en los Dockerfiles).
- Nuestras modificaciones: los `Dockerfile.*`, `nginx/`, `caddy/`, `scripts/`, `couchdb-config/`, `locks/` y `docker-compose.yml` de este repo.
- El texto de la licencia AGPL-3.0 está en `LICENSE`.
