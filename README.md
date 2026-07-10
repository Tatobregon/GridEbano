# AsTeRICS Grid — auto-hospedado

Versión auto-hospedada y **congelada** de [AsTeRICS Grid](https://github.com/asterics/AsTeRICS-Grid)
(app de Comunicación Aumentativa y Alternativa), servida por HTTPS con backups, registro cerrado y
endurecimiento de seguridad.

Este repositorio contiene **nuestras modificaciones** (Dockerfiles, patches, configs y scripts) sobre
el AsTeRICS Grid upstream, que se referencia por tag y se construye en tiempo de build.

## Configuración

```bash
cp .env.example .env      # y poné claves fuertes en COUCHDB_PASSWORD y REGISTER_SECRET
```

## Arranque

```bash
./scripts/arrancar.sh     # levanta Docker + el stack + inicializa + verifica ("TODO ARRIBA")
```

## Scripts

```bash
./scripts/crear-usuario.sh <usuario> <clave 8+>   # alta de usuario (solo admin)
./scripts/backup-offsite.sh                       # backup local + copia a la nube
./scripts/restore.sh backups/<archivo>.tgz        # restaurar
./scripts/parchear.sh                             # parches de seguridad (rebuild --pull)
```

## Documentación

- **`avances/estado-del-proyecto.md`** — estado, decisiones y por qué (registro de avance).
- **`docs/checklist-operacion.md`** — guía de rescate (síntoma → fix).
- **`docs/procedimiento-parcheo.md`**, **`docs/politica-contrasenas.md`**, **`docs/licencia-y-publicacion.md`**.
- **`docs/runbook-local.md`** / **`docs/runbook-prod.md`** — guías detalladas.
- **`CLAUDE.md`** — contexto completo del proyecto.

## Licencia

AsTeRICS Grid está bajo **AGPL-3.0**. Este proyecto es un **trabajo derivado** (lo modificamos y lo
servimos por red), por lo que **el código fuente correspondiente se pone a disposición de los usuarios**
en este repositorio, en cumplimiento de la AGPL-3.0.

- Upstream: https://github.com/asterics/AsTeRICS-Grid (release pineado en los Dockerfiles).
- Nuestras modificaciones: los `Dockerfile.*`, `nginx/`, `scripts/`, `couchdb-config/` y `docker-compose.yml` de este repo.
- El texto de la licencia AGPL-3.0 está en `LICENSE`.
