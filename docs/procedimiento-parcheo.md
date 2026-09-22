# Procedimiento de parcheo de seguridad

Cómo mantener el servidor al día con parches de seguridad **sin** salir de la estrategia de
"versión congelada". La idea: quedarnos en las mismas versiones mayores (couchdb 3.4, node 22,
nginx estable, caddy 2 y el release pineado de AsTeRICS Grid, con las dependencias
congeladas en `locks/`), pero traer los **fixes de seguridad** que van
saliendo dentro de esos tags.

---

## Por qué hace falta

Congelar versiones da estabilidad, pero las imágenes base (CouchDB, Node/Debian, nginx/Alpine)
reciben parches de seguridad con el tiempo. Si nunca rebuildeás, te quedás con vulnerabilidades
conocidas. "Parchear" = rebuildear trayendo la última versión **parcheada** de cada tag, sin cambiar
de versión mayor. No se "previenen" los zero-days, se **reduce la ventana de exposición**.

---

## Cadencia recomendada

| Cuándo | Qué hacer |
|---|---|
| **Rutina: cada ~4-6 semanas** | Correr `./scripts/parchear.sh` |
| **Urgente: ante un CVE grave** de CouchDB / Node / Debian / nginx / Alpine | Correr `./scripts/parchear.sh` cuanto antes |
| **Nuevo release de AsTeRICS Grid** que quieras adoptar | Proceso aparte, con más cuidado (ver abajo) |

---

## Cómo parchear (imágenes base)

Un solo comando, en la carpeta del proyecto (Git Bash en la PC, o por SSH en el server):

```bash
./scripts/parchear.sh
```

Hace, en orden y verificando:
1. **Backup de seguridad** del volumen (por si algo sale mal).
2. `docker compose pull` (couchdb, caddy) + `docker compose build --pull` (node, nginx, alpine) →
   baja la última versión parcheada de `couchdb:3.4`, `caddy:2`, `node:22-bookworm`,
   `nginx:stable-alpine` y `alpine:3`, y rebuildea. Las dependencias npm NO cambian (`locks/`).
   (Control extra cada tanto: que esos tags se sigan republicando en Docker Hub. `node:18` y
   `nginx:1.27` dejaron de actualizarse en 2025 y por eso se cambiaron en 2026-09.)
3. Levanta y corre `arrancar.sh` (init + Funnel/Caddy + verificación web/sync).
4. Anota la fecha en `avances/parcheos.log`.

> Si hay imágenes nuevas, el rebuild del frontend es completo (clona el repo + webpack + re-baja los
> ~285 MB de tableros solo si cambió `alpine`) y tarda ~10 min. Si no hay nada nuevo, usa cache y es rápido.

**Si algo quedó mal después de parchear:** restaurá el backup que se hizo al principio:
```bash
./scripts/restore.sh backups/<el .tgz más reciente>.tgz
```

---

## Actualizar el propio AsTeRICS Grid (cambiar de release) — con cuidado

Esto **no** lo hace `parchear.sh` a propósito (cambiar la app es más riesgoso que parchear la base).
Cuando quieras adoptar un release nuevo del upstream:

1. Mirá el changelog del nuevo release y que no rompa nada de lo que usan tus usuarios.
2. **Probá primero en un entorno aparte** (otra carpeta / otra copia), no en producción.
3. Verificá que nuestras modificaciones (los `sed`/patches de los Dockerfiles) sigan aplicando —
   si el upstream cambió el código, los "anchors" de los patches podrían no encontrarse (el build
   avisa y falla).
4. Recién ahí, en producción: backup → cambiar `ASTERICS_TAG` (y `BOARDS_COMMIT` si corresponde) en
   `docker-compose.yml` → subir `ASTERICS_VERSION` → `./scripts/parchear.sh` (o rebuild + arrancar).

---

## Notas

- La etapa `boards` ya usa `alpine:3` + git, así que un parche de Node no obliga a re-bajar los
  ~285 MB de tableros.
- **Al cambiar `ASTERICS_TAG`** hay que regenerar los lockfiles de `locks/` (el `package.json` del
  upstream puede cambiar): en una copia de prueba, `npm install` sobre el tag nuevo, copiar el
  `package-lock.json` resultante a `locks/frontend-package-lock.json` y `locks/couchauth-package-lock.json`,
  buildear y probar antes de producción.
