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

**1. Sacar secretos y datos** — ✅ HECHO:
- [x] Secretos movidos a `.env` (no se versiona). Se publica `.env.example` como plantilla.
- [x] `.gitignore` excluye `.env`, `.env.local`, `backups/`, `*.tgz`, `*.log`, `avances/parcheos.log`.
- [x] `couchdb-config/docker.ini` **ya queda limpio solo**: se monta como `00-custom.ini` (ordena
      antes que el docker.ini del entrypoint), así CouchDB persiste su `[admins]` en el archivo
      efímero, no en el nuestro. Verificado: nuestro archivo no vuelve a tener `[admins]`.
- [x] `git init` + commit inicial **ya hecho localmente**, verificado sin secretos (23 archivos).

**2. Crear el repo público y pushear** (acción del admin):
```bash
# En GitHub: crear un repo PÚBLICO VACÍO (sin README, sin license, sin gitignore).
cd "asterics-grid"
git branch -M main
git remote add origin https://github.com/<TU-USUARIO>/<TU-REPO>.git
git push -u origin main   # puede pedir login de GitHub
```
Después, en GitHub: **Add file → Create new file → nombre `LICENSE` → "Choose a license template"
→ "GNU Affero General Public License v3.0"** (GitHub pega el texto completo).

**3. Ofrecer la fuente a los usuarios (recomendado):**
- Agregar un **link visible al repo** en la app (ej. en la pantalla "Acerca de" / `aboutView.vue`),
  y rebuildear. Así cualquier usuario que use el servicio puede llegar al código.
- Alternativa mínima: un aviso/link en la página de login o en la documentación pública del servicio.

**4. Incluir la licencia:** dejá el texto de AGPL-3.0 (`LICENSE`) en el repo y una nota de que es un
   trabajo derivado de AsTeRICS Grid (con link al upstream `https://github.com/asterics/AsTeRICS-Grid`).

---

## Estado

- ✅ Secretos fuera del versionado + `docker.ini` limpio.
- ✅ **Repo público publicado:** https://github.com/Tatobregon/GridEbano (LICENSE AGPL-3.0, branch `main`).
- ⏳ Recomendado (opcional): link visible a la fuente en la app ("Acerca de" / `aboutView.vue`) + rebuild.

El requisito central de AGPL (**fuente disponible para los usuarios**) ya está **cumplido** con el
repo público. El link in-app es un extra para que sea más fácil de encontrar.
