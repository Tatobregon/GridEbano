# Procedimiento de parcheo de seguridad

Cómo mantener el servidor al día con parches de seguridad **sin** salir de la estrategia de
"versión congelada". La idea: quedarnos en las mismas versiones mayores (couchdb 3.4, node 18,
nginx 1.27, y el release pineado de AsTeRICS Grid), pero traer los **fixes de seguridad** que van
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

Un solo comando, desde Git Bash en la carpeta del proyecto:

```bash
./scripts/parchear.sh
```

Hace, en orden y verificando:
1. **Backup de seguridad** del volumen (por si algo sale mal).
2. `docker compose build --pull` → baja la última versión parcheada de `couchdb:3.4`,
   `node:18-bullseye` y `nginx:1.27-alpine`, y rebuildea.
3. Levanta y corre `arrancar.sh` (init + Funnel + verificación web/sync).
4. Anota la fecha en `avances/parcheos.log`.

> Si hay imágenes nuevas, el rebuild del frontend es completo (clona el repo + webpack + re-baja los
> ~285 MB de tableros) y tarda ~10 min. Si no hay nada nuevo, usa cache y es rápido.

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

## Nota / mejora futura

El stage `boards` del `Dockerfile.frontend` usa `node:18-bullseye`, así que un parche de Node hace
re-clonar los ~285 MB de tableros. Si el parcheo se vuelve frecuente y molesto, se puede cambiar ese
stage a una imagen mínima de git (ej. `alpine/git`) para que los parches de Node no lo invaliden.
