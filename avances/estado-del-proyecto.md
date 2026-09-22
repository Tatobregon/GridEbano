# Estado del proyecto — AsTeRICS Grid self-hosted

> Registro de avance. Última actualización: **2026-07-10**.
> Documento de referencia sobre en qué estado está el proyecto, qué se eligió y por qué, y qué falta.

---

## 1. Qué es el proyecto

Auto-hospedaje de **AsTeRICS Grid** — una app de **Comunicación Aumentativa y Alternativa (CAA)**:
tableros de pictogramas que "hablan" con voz sintética, para personas que no pueden comunicarse
verbalmente. Es open source (AGPL-3.0), desarrollada por la AsTeRICS Foundation.

**Objetivo:** correr nuestra propia instancia, en una **versión congelada y estable**, para que:
- Las actualizaciones que publique el desarrollador no rompan lo que nuestros usuarios usan.
- Los datos de los usuarios estén **respaldados del lado servidor** (no solo en su dispositivo).
- Ser **100% independientes** de la infraestructura de la fundación.

**Fase actual:** entorno funcional corriendo en la PC del admin, expuesto a internet como
"producción temporal" para **testear** el sistema completo antes de pagar un servidor. Todavía
**no hay clientes reales**.

---

## 2. Estado actual (resumen)

| Área | Estado |
|---|---|
| Stack corriendo (3 servicios) | ✅ funcionando |
| Accesible desde cualquier dispositivo | ✅ `https://pc-tato.taila78f74.ts.net` (Tailscale Funnel, HTTPS) |
| Sincronización multi-dispositivo | ✅ probada |
| Independencia de la fundación | ✅ login, base, frontend y **tableros** self-hosteados |
| Registro cerrado (solo admin crea usuarios) | ✅ |
| Endurecimiento de seguridad | ✅ headers, rate limiting, clave fuerte, superficie reducida |
| Backups (backup + restore) | ✅ probados end-to-end |
| Arranque en un comando | ✅ `./scripts/arrancar.sh` |
| Documentación operativa | ✅ checklist de rescate |
| Migración a servidor real | ⏳ pendiente (cuando se valide) |
| Protección DDoS / CDN | ⏳ pendiente (requiere dominio + VPS) |
| Proceso de parcheo formalizado | ⏳ pendiente |

---

## 3. Arquitectura

```
   Cualquier dispositivo (navegador)
        │  HTTPS
        ▼
   Tailscale Funnel  (URL pública pc-tato.taila78f74.ts.net, puerto 443, certificado TLS)
        │  → 127.0.0.1:9095
        ▼
   ┌─────────────────────────────────────────────┐
   │  nginx (frontend) = PUERTA ÚNICA              │
   │   /            → la web (SPA) + tableros       │
   │   /auth /user /api → couch-auth (login)        │
   │   /couchdb/    → CouchDB (sync)                 │
   │   + security headers, rate limiting, /register 403 │
   └─────────────────────────────────────────────┘
        │ (red interna de Docker)
        ├── couch-auth  (registro/login, crea la base de cada usuario)
        └── couchdb     (una base cifrada por usuario)  ──► volumen couchdb-data ──► backups (.tgz)
```

**Tres contenedores Docker:**
- **couchdb** (CouchDB 3.4) — base de datos. Una base por usuario. Bindeada a `127.0.0.1` (no expuesta).
- **couch-auth** (Node, fork `@klues/couch-auth` de SuperLogin) — registro/login, aprovisiona la base de cada usuario. Bindeada a `127.0.0.1`.
- **frontend** (nginx 1.27) — sirve la app + el mirror de tableros, y hace de reverse-proxy. Es lo único de cara al Funnel.

**Dónde viven los datos:** en **dos lugares** que se espejan (sync):
1. En el **dispositivo del usuario** (PouchDB / IndexedDB del navegador) → funciona offline.
2. En el **servidor** (CouchDB, base `asterics-grid-data$<hash>` por usuario) → respaldo en la nube.

---

## 4. Decisiones tomadas y por qué

### Motor de base de datos: **CouchDB + PouchDB**
- **Qué:** CouchDB en el servidor, PouchDB en el navegador, con sincronización bidireccional.
- **Por qué:** es lo que AsTeRICS Grid usa **de forma nativa**. El modelo PouchDB↔CouchDB da
  **offline-first** (la app anda sin internet) + **sync** automático + **una base aislada por
  usuario** (un usuario no puede ver la base de otro). No tiene sentido pelearle al diseño upstream.

### Modo **online con sincronización** (no solo local)
- **Por qué:** el usuario necesita que sus comunicadores estén **respaldados del lado servidor**,
  no solo en el dispositivo (que se puede perder/romper), y poder usarlos en varios dispositivos.

### **Cifrado de extremo a extremo** (E2E) con la contraseña del usuario
- **Qué:** los datos en CouchDB están cifrados con la clave de cada usuario. El admin **no puede
  leerlos**, pero **sí puede restaurar** un snapshot completo (la clave no cambia).
- **Por qué:** privacidad de datos sensibles. **Trade-off importante:** si un usuario **olvida su
  contraseña**, sus datos quedan **irrecuperables por descifrado** (no hay reset por mail). → Hay
  que guardar las contraseñas asignadas en un lugar seguro.

### **Versión congelada** (release pineado)
- **Qué:** clonamos un release fijo (`release-2026-06-03-09.11/+0200`) y el repo de tableros a un
  commit fijo (`6c0f0017...`). Se actualiza **a mano**, cuando una versión nueva esté probada.
- **Por qué:** estabilidad. Una actualización automática del upstream podría romper algo de lo que
  un usuario depende para comunicarse. Nosotros decidimos cuándo actualizar.

### **Self-host del repo de tableros** (desacople 100% de la fundación)
- **Qué:** el repo `Asterics-AAC-Data` (tableros predefinidos, imágenes, traducciones) se clona
  pineado dentro de nuestra imagen y se sirve same-origin en `/Asterics-AAC-Data/`.
- **Por qué:** era la última dependencia de datos con la fundación. Ahora **login, base, frontend y
  tableros** salen todos de nuestro servidor. Un error o caída de ellos **no afecta a los usuarios**.
- *(Dependencias externas que quedan, de terceros — no de la fundación: búsqueda de pictogramas
  ARASAAC/GlobalSymbols/OpenSymbols. Solo se usan al buscar símbolos nuevos.)*

### Túnel: **Tailscale Funnel**
- **Qué:** expone la PC a internet con una URL pública HTTPS estable, **sin abrir puertos ni IP fija**.
- **Por qué se eligió:**
  - **Gratis** y **URL estable** sin comprar dominio.
  - **HTTPS incluido** (certificado válido) → habilita service worker, voz y micrófono (que exigen
    "contexto seguro").
  - Funciona desde **cualquier dispositivo** sin instalar nada (a diferencia de Tailscale *Serve*,
    que es privado y requiere instalar el cliente en cada dispositivo).
  - Conexión **saliente** desde la PC → no expone la IP de casa, anda detrás de NAT/CGNAT.
- **Por qué no otros:** *ngrok* gratis mete una página intersticial que rompería el sync;
  *Cloudflare Tunnel* necesita un dominio propio (queda para más adelante).

### **Reverse-proxy** (nginx como puerta única, puerto 443)
- **Qué:** en vez de exponer los 3 servicios en 3 puertos, el nginx los unifica bajo un solo origen.
- **Por qué:** (1) **un solo puerto estándar (443)** → anda hasta en redes restrictivas; (2) permite
  **security headers**, **rate limiting** y bloqueo de `/register` en un solo lugar; (3) **reduce la
  superficie**: la base de datos y el login **ya no miran a internet directo**; (4) es la misma pieza
  que se usa en un servidor real → migración limpia.

### Cuentas creadas **solo por el admin** (registro cerrado)
- **Qué:** `/auth/register` devuelve 403 salvo que traiga un secreto de admin. El admin crea usuarios
  con `crear-usuario.sh` (que lee el secreto solo).
- **Por qué:** al estar expuesto a internet, no queremos que cualquiera se registre. Control total
  sobre quién tiene cuenta.

### **Backups = snapshots del volumen** (no export `.grd`)
- **Qué:** `backup.sh` hace un `.tgz` del volumen de CouchDB; `restore.sh` lo restaura (con snapshot
  de seguridad previo).
- **Por qué:** es **completo** (toda la base, todos los usuarios), simple, y **probado end-to-end**
  (se restauró en una instancia limpia y los datos volvieron idénticos). CouchDB es append-only, así
  que el snapshot en caliente es consistente.

### **La PC como producción temporal** (antes de pagar un servidor)
- **Por qué:** no tiene sentido pagar un VPS hasta **validar** que todo el flujo funciona con uso
  real. Cuando se valide, el salto a un servidor es chico (mismos contenedores). *Limitación aceptada
  en esta fase: el servicio solo anda con la PC prendida.*

### **Docker Compose** + **Windows-native**
- **Docker Compose:** todo declarado y reproducible; se mueve al servidor tal cual.
- **Windows-native (no WSL):** el proyecto corre desde Windows directamente. Para este stack no hay
  penalidad de rendimiento (el build pesado pasa dentro del contenedor; los datos van en un volumen
  nombrado, no en `/mnt/c`).

---

## 5. Medidas de seguridad (qué protege contra qué)

| Medida | Contra qué | Estado |
|---|---|---|
| **HTTPS/TLS** en todo el camino (Funnel) | Man-in-the-Middle, escucha | ✅ |
| **Base por usuario aislada** (CouchDB `_security`) | Un usuario accediendo a datos de otro; radio de daño de inyección | ✅ por diseño |
| **Cifrado E2E** de los datos | Lectura de datos aunque se acceda a la base | ✅ |
| **Clave de admin fuerte** de CouchDB | Fuerza bruta al admin de la base | ✅ |
| **Registro cerrado** (secreto de admin) | Alta de cuentas por desconocidos | ✅ |
| **Security headers** (X-Frame-Options, nosniff, Referrer-Policy, HSTS, CSP conservadora) | Clickjacking, MIME-sniffing, fugas de referrer | ✅ |
| **Rate limiting** en `/auth/login` | Fuerza bruta / credential stuffing | ✅ |
| **couchdb y couch-auth bindeados a 127.0.0.1** | Exposición directa de DB/login a internet | ✅ |
| **Backups probados** | Recuperación ante cualquier incidente / pérdida | ✅ |
| DDoS / DNS / BGP | Caídas por ataques de infraestructura | ⏳ es capa de CDN/hosting (Cloudflare + VPS); no aplica a esta fase |
| Parcheo de zero-days | Vulnerabilidades nuevas en las imágenes | ⏳ falta formalizar el proceso (rebuild `--pull` periódico) |

**Nota honesta:** en esta fase (sin clientes, URL oscura) el riesgo real es muy bajo. El
endurecimiento hecho es higiene para tener **antes** de meter usuarios reales. Lo pesado
(DDoS/DNS/BGP) vive en la capa de CDN/hosting que se adopta al pasar a dominio + VPS, no en este código.

---

## 6. Problemas encontrados y resueltos (historial técnico)

Registro de los baches que aparecieron y cómo se resolvieron (útil si algo similar reaparece):

1. **`npm ci` fallaba** — el repo upstream no commitea `package-lock.json`. → `npm install`.
2. **CouchDB crasheaba sin logs** — el entrypoint hace `chown` y, con el `docker.ini` montado `:ro`
   en Windows, fallaba. → se quitó `:ro`.
3. **couch-auth crasheaba al validar nombres** — faltaba la vista `view-usernames`. → se crea en la
   inicialización.
4. **Sync se caía / la web se colgaba** — el reenvío del puerto 5984 de Docker Desktop se rompía. →
   `down && up` realinea; y el reverse-proxy lo elimina como problema.
5. **La nube quedaba en X** — la replicación usaba `retry: false` (un blip la mataba). → `retry: true`.
6. **Cambios del frontend no tomaban efecto** — el service worker servía el bundle viejo. → se
   versiona el nombre del cache con `ASTERICS_VERSION`.
7. **Los scripts no corrían en Windows** — conversión de paths de Git Bash. → `MSYS_NO_PATHCONV=1` y
   `compose` con `cd` en vez de `-f`.
8. **DSN del sync mal formado con subpath** — faltaba la barra final en `DB_SERVER_PUBLIC_URL`. → se
   agregó `/couchdb/`.
9. **La clave nueva no tomaba** — CouchDB persiste un `[admins]` (hash) en el `docker.ini` montado rw;
   el hash viejo pisaba la clave del env. → borrar ese `[admins]` al cambiar `COUCHDB_PASSWORD`.

---

## 7. Archivos y scripts clave

```
asterics-grid/
├── docker-compose.yml          ← stack (couchdb + couch-auth + frontend + caddy[prod])
├── Dockerfile.frontend         ← build del frontend: mods + boards self-host + nginx reverse-proxy
├── Dockerfile.couchauth        ← couch-auth + patch de bloqueo de registro
├── nginx/default.conf          ← puerta única: proxy + security headers + rate limiting
├── couchdb-config/docker.ini   ← config de CouchDB (single-node, CORS)
├── scripts/
│   ├── arrancar.sh             ← ★ levanta TODO en un comando + verifica
│   ├── crear-usuario.sh        ← alta de usuarios (solo admin)
│   ├── backup.sh               ← snapshot del volumen
│   ├── restore.sh              ← restaurar un snapshot (con red de seguridad)
│   └── patch-couchauth.js      ← inyecta el bloqueo de /auth/register
├── avances/
│   └── estado-del-proyecto.md  ← este documento (registro de avance)
└── docs/
    ├── checklist-operacion.md  ← guía de rescate (síntoma → fix)
    ├── runbook-local.md        ← guía detallada (fase local)
    └── runbook-prod.md         ← guía de la fase servidor
```

**Las modificaciones al código upstream** (todas en los Dockerfiles, para no forkear): apuntar login
a nuestro couch-auth; entorno PROD + versión; self-host de tableros; `retry: true` en el sync;
cache-busting del service worker; bloqueo de registro en couch-auth.

---

## 8. Qué falta (próximos pasos)

**Corto plazo (endurecimiento / operación) — ✅ TRACK A COMPLETO:**
- [x] **Proceso de parcheo** — `scripts/parchear.sh` + `docs/procedimiento-parcheo.md` (probado).
- [x] **Backups offsite** — `scripts/backup-offsite.sh` copia a Google Drive (probado).
- [x] **Política de contraseñas olvidadas** — modelo "admin custodia" en `docs/politica-contrasenas.md`.
- [x] **AGPL: CUMPLIDO** — secretos en `.env`; repo público https://github.com/Tatobregon/GridEbano
      (LICENSE AGPL-3.0); link a la fuente visible en la pantalla "Acerca de" de la app.

**Mediano plazo (producción real, con clientes) — TRACK B:**
- [ ] Migrar a un **servidor 24/7** (VPS) + **dominio propio**.
- [ ] Poner **Cloudflare** adelante → protección **DDoS/DNS** real y CDN.
- [ ] **Monitoreo y alertas** (servicio caído, disco lleno).
- [ ] **CSP estricta** de scripts (afinada contra la app, con testing de navegador).
- [ ] Completar la **publicación AGPL** (repo público + link in-app).
- [ ] Definir el **flujo de alta de clientes** y entrega segura de credenciales.

**Opcional (blindaje extra):**
- [ ] Self-host de los **pictogramas** (ARASAAC, etc.) para desacople total incluso de terceros (es pesado).

---

## 9. Datos operativos clave

- **URL:** https://pc-tato.taila78f74.ts.net
- **Prender todo:** `./scripts/arrancar.sh` (esperar "TODO ARRIBA")
- **Crear usuario:** `./scripts/crear-usuario.sh <usuario> <contraseña 8+>`
- **Backup:** `./scripts/backup.sh` · **Restore:** `./scripts/restore.sh backups/<archivo>.tgz`
- **Si algo falla:** `docs/checklist-operacion.md`
- **Secretos:** en `.env` (no versionado; plantilla `.env.example`). Los scripts los leen solos.
- **Requisito:** el servicio anda solo con **la PC prendida y Docker Desktop corriendo**.

---

## 10. Licencia

AsTeRICS Grid es **AGPL-3.0**. Modificamos el código (vía Dockerfiles/patches). Servir una versión
modificada **obliga a poner el código fuente a disposición de los usuarios** → se cumple publicando
nuestro fork o un repo con los cambios. **Cumplido:** repo público + link en "Acerca de" (ver §8).
