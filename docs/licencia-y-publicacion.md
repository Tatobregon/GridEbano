# Licencia AGPL-3.0 y publicación del código

AsTeRICS Grid está bajo **AGPL-3.0**. Esta licencia tiene una cláusula clave para servicios de red:

> Si servís una versión **modificada** del software a usuarios a través de la red, estás obligado a
> **poner el código fuente correspondiente a disposición de esos usuarios**.

Nosotros modificamos el software (vía Dockerfiles/patches), y lo servimos por internet → **tenemos
que ofrecer el código**. Esto hay que hacerlo **antes** de dar servicio a clientes reales.

---

## Qué contamos como "nuestras modificaciones"

No tocamos el código de AsTeRICS Grid directamente en un fork; lo modificamos **en tiempo de build**.
La "fuente correspondiente" de nuestra versión = el repo upstream (referenciado por tag) **más**
todo lo nuestro:
- `Dockerfile.frontend`, `Dockerfile.couchauth` (con los `sed`/patches).
- `nginx/default.conf`, `couchdb-config/docker.ini`.
- `scripts/patch-couchauth.js` (bloqueo de registro) y demás scripts.
- `docker-compose.yml`, docs.

Publicando **este proyecto** (que describe exactamente cómo modificamos y construimos, y apunta al
upstream por tag/commit), se cumple con "poner la fuente a disposición".

---

## Checklist para publicar (una sola vez)

**1. Sacar secretos y datos** (ya preparado):
- [x] Secretos movidos a `.env` (no se versiona). Se publica `.env.example` como plantilla.
- [x] `.gitignore` excluye `.env`, `.env.local`, `backups/`, `*.tgz`, `avances/parcheos.log`.
- [ ] **Limpiar `couchdb-config/docker.ini`**: borrar las secciones `[admins]` (hash) y la línea
      `uuid = ...` antes de publicar. Son estado de runtime, no fuente. (CouchDB las regenera solo.)
- [ ] Revisar que la URL `pc-tato.taila78f74.ts.net` que quede en el repo no te moleste (no es un
      secreto, pero es tu hostname; opcional parametrizarla).

**2. Crear el repo público:**
```bash
cd "asterics-grid"
git init
git add .
git commit -m "AsTeRICS Grid self-hosted (modificaciones AGPL)"
# crear un repo en GitHub y:
git remote add origin https://github.com/<tu-usuario>/<tu-repo>.git
git branch -M main
git push -u origin main
```
> Antes del primer `git add .`, verificá con `git status` que **NO** aparezcan `.env` ni `backups/`.

**3. Ofrecer la fuente a los usuarios (recomendado):**
- Agregar un **link visible al repo** en la app (ej. en la pantalla "Acerca de" / `aboutView.vue`),
  y rebuildear. Así cualquier usuario que use el servicio puede llegar al código.
- Alternativa mínima: un aviso/link en la página de login o en la documentación pública del servicio.

**4. Incluir la licencia:** dejá el texto de AGPL-3.0 (`LICENSE`) en el repo y una nota de que es un
   trabajo derivado de AsTeRICS Grid (con link al upstream `https://github.com/asterics/AsTeRICS-Grid`).

---

## Estado

- ✅ Preparación técnica para publicar (secretos fuera del versionado).
- ⏳ Pendiente: limpiar `docker.ini`, crear el repo público, y agregar el link a la fuente en la app.

Es un paso **de una sola vez**, y conviene cerrarlo **antes** de tener clientes reales usando el servicio.
