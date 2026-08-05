# Auditoría de desacople de la AsTeRICS Foundation

> Fecha: 2026-07-24. Objetivo: probar de forma exhaustiva que **NADA del servicio depende de los
> servidores de la fundación** (asterics-foundation.org / asterics.github.io).
> Distinción clave: **fundación** (debe ser 0) vs **terceros** (ARASAAC, Google, etc. — otra cosa).

## Metodología (6 capas)

1. **Bundle servido** — grep de lo que el navegador realmente ejecuta (index.html + bundles webpack + service worker + libs).
2. **Mirror de tableros** — spider de metadata → imágenes → `.grd.json` y sus refs internas.
3. **Runtime de flujos core** — reproducir los fetches de arranque/login/sync y confirmar que van a nosotros.
4. **Server-side** — que couch-auth/couchdb/nginx no llamen a la fundación.
5. **Navegador (DevTools)** — confirmación en vivo del tráfico de red (lo hace el admin).
6. **Offline (PWA/service worker)** — de qué depende el modo offline.

## Resultados

### ✅ El CORE es 100% independiente de la fundación
| Flujo | Va a | Evidencia |
|---|---|---|
| Login / auth | NOSOTROS | `login1.couchdb.asterics-foundation` en el bundle: **0** |
| Sincronización | NOSOTROS | DSN + `/couchdb/` → couchdb propio |
| Tableros (metadata, imágenes, `.grd.json`) | NOSOTROS | `/Asterics-AAC-Data/` same-origin; **0/55** `.grd.json` referencian a la fundación |
| Acciones/requests/i18n predefinidos | NOSOTROS | `/Asterics-AAC-Data/live_*.json` → 200 |
| Offline (PWA) | NOSOTROS | Workbox de **13 archivos locales** (CDN de Google comentado); precache de **91 rutas, 0 externas** |
| Server-side (couch-auth/couchdb/nginx) | interno | **0** refs a la fundación en código/config/logs |

### 🧹 Limpieza aplicada
- **serviceWorker.js**: el check `shouldCacheStaleWhileRevalidate` comparaba contra la URL vieja
  `https://asterics.github.io/Asterics-AAC-Data` (código MUERTO — nunca matcheaba, no hacía llamada).
  Corregido a `url.pathname.startsWith('/Asterics-AAC-Data')` (patch `scripts/patch-sw-boards-check.js`).
  Resultado: **0** referencias a la fundación en la lógica del código servido.

### ⚪ Referencias a la fundación que QUEDAN (no son dependencias del core)
| Qué | Cuántas | Naturaleza |
|---|---|---|
| `mailto:office@asterics-foundation.org` | 2 | Link de **contacto** (atribución). El usuario podría clickear para mandar mail. No es una llamada del servicio. |
| `github.com/asterics/...` (About + "ver en GitHub" de tableros) | — | Links cosméticos de atribución. |
| `website: asterics-foundation.org/...` en metadata de tableros | 1 | Campo **website de autor** mostrado en la galería (como arasaac.org). No es fetch de datos. |
| `api.asterics-foundation.org/podcastindex.php` | 2 | Feature **PODCAST** (opcional). Solo se llama si el usuario usa podcasts. |
| `proxy.asterics-foundation.org/proxy_nofilter.php` | 1 | **CORS proxy** para grid-actions HTTP (opcional). Solo si se configura un botón con `useCorsProxy`. |

**Conclusión:** el servicio (app, login, datos, sync, offline, tableros) funciona **100% sin la
fundación**. Los únicos toques que quedan son (a) links cosméticos de atribución/contacto, y (b) DOS
features opcionales (podcast y CORS-proxy) que solo llaman a la fundación **si el usuario las usa**.

### Terceros (aparte — no es la fundación)
Búsqueda de pictogramas: **ARASAAC** (`api.arasaac.org`) y un CDN (`d18vdu4p71yql0.cloudfront.net`,
Global/Open Symbols). YouTube/Google, radio, Matrix. El SW cachea imágenes de esas APIs para offline.
Son dependencias de **features de terceros**, no de la fundación.

## Pendiente opcional (decisión de producto)
Para llegar a **cero referencias a la fundación en absoluto**, se pueden **neutralizar** las 2 features
opcionales (podcast y CORS-proxy) — es quitar features, así que es decisión del admin.
