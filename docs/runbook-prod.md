# Despliegue en producción — Cloud Server de DonWeb (paso a paso)

Guía para pasar la app de la PC (Tailscale Funnel) a un servidor propio en DonWeb, con dominio,
HTTPS, la base de datos en el server y backups en dos capas (locales + Copias de Seguridad de DonWeb). Está pensada para ir
**de a poco**: cada paso dice qué hacés, el comando exacto, **qué tenés que ver** y **qué hacer si
no pasa eso**. No avances de paso si el anterior no dio lo esperado.

> **La app no cambia.** Lo que ven los usuarios (logo, reloj de dwell, solo-login, tableros propios)
> es exactamente lo mismo. Lo que cambia es la infraestructura alrededor: HTTPS con Caddy, nginx
> más cerrado, imágenes base con parches, dependencias congeladas y scripts que andan en Linux.

**Convenciones de esta guía**
- `app.tudominio.com.ar` = tu subdominio real. `TU.IP` = la IP pública del server.
- **[PC]** = en tu PC, en **Git Bash**, parado en la carpeta del proyecto.
- **[SERVER]** = conectado al server por SSH, parado en `/opt/asterics-grid`.
- Para pegar en Git Bash: clic derecho → Paste (o `Shift+Insert`).

**Tiempo total estimado:** 3 a 4 horas repartidas, más lo que tarde en propagar el DNS.

---

## Cómo queda armado

```
 Navegador ──HTTPS──► Caddy (puertos 80/443, certificado automático de Let's Encrypt)
                        │
                        ▼
                      nginx (frontend) = puerta única, solo accesible desde adentro
                        ├── /                → la app + mirror de tableros
                        ├── /auth/login, /auth/logout, /auth/refresh → couch-auth
                        ├── /admin/ + /crear-usuario-ebano-soluciones → panel de alta de usuarios
                        └── /couchdb/<base del usuario> → CouchDB (sync)
                                                         │
                                                  volumen asterics-grid_couchdb-data
                                                         │
                            backup nocturno (.tgz en backups/)
                                          └──► lo levanta la Copia de Seguridad de DonWeb
```

Solo Caddy da a internet. CouchDB, couch-auth y nginx están atados a `127.0.0.1` del server.

---

## Fase 0 — Qué tenés que tener a mano

- [ ] Tu gestor de contraseñas abierto (vas a guardar varias claves nuevas).
- [ ] El zip con los cambios (`GridEbano-actualizado.zip`).
- [ ] Acceso al panel de DonWeb (para contratar el server).
- [ ] Acceso al panel DNS de tu dominio (DonWeb u otro).
- [ ] Un mail para los avisos de Let's Encrypt.

---

## Fase 1 — [PC] Poner los cambios en el repo y probarlos en local (~45 min)

La idea es probar todo en tu PC **antes** de tocar el server: si algo del build nuevo falla, que
falle acá.

### 1.1 Sacar los lockfiles de las imágenes que hoy funcionan

**Por qué:** el `npm install` de antes elegía las versiones de las dependencias el día del build.
Ahora las congelamos, y las mejores versiones para congelar son las que ya probaste. Están adentro
de las imágenes que tenés corriendo. Hacelo **antes** de copiar mis archivos.

```bash
export MSYS_NO_PATHCONV=1
./scripts/arrancar.sh            # si el stack no estaba arriba
mkdir -p locks-tuyos
docker compose cp couch-auth:/app/package-lock.json locks-tuyos/couchauth-package-lock.json
docker compose cp frontend:/usr/share/nginx/html/package-lock.json locks-tuyos/frontend-package-lock.json
ls -l locks-tuyos
```

**Tenés que ver:** dos archivos de unos 400 KB cada uno.

**Si dice "no such file":** esa imagen no tiene el lockfile. No pasa nada: en el zip vienen unos que
generé y probé (build completo del frontend y login de couch-auth con Node 22). Seguí igual.

### 1.2 Chequear el nombre del volumen de datos

```bash
docker volume ls | grep couchdb-data
```

**Tenés que ver:** `asterics-grid_couchdb-data`.

**Si ves otro prefijo** (por ejemplo `gridebano_couchdb-data`): tu carpeta no se llama
`asterics-grid`. Corré `docker compose down` **ahora** (antes de copiar los archivos), así no
quedan contenedores viejos ocupando los puertos. Tus datos de prueba quedan en ese volumen viejo y
el stack nuevo arranca con la base vacía, que para probar está bien.

### 1.3 Crear una rama y copiar los archivos nuevos

```bash
git status                       # tiene que estar limpio (sin cambios sin commitear)
git checkout -b despliegue-donweb
```

Descomprimí `GridEbano-actualizado.zip` en cualquier lado y **copiá todo su contenido encima de tu
carpeta del proyecto**, reemplazando los archivos. Después:

```bash
cp locks-tuyos/*.json locks/     # tus lockfiles pisan los míos (si el 1.1 salió bien)
rm -r locks-tuyos
git status
```

**Tenés que ver:** modificados `docker-compose.yml`, los dos Dockerfiles, `nginx/default.conf`,
`couchdb-config/docker.ini`, `.env.example`, varios scripts y docs; nuevos `caddy/`, `locks/`,
`scripts/lib.sh`, `scripts/preparar-server.sh` y `scripts/verificar-sitio.sh`. En VS Code, en la
pestaña Source Control, podés ver el diff de cada archivo.

### 1.4 Ajustar tu `.env` local

Abrí tu `.env` (el de la PC) y:
- **Borrá** la línea `DB_SERVER_PUBLIC_URL=...`. Ya no se usa: ahora se arma sola con `AUTH_BASE_URL`.
- **Agregá** `ASTERICS_VERSION=localdev-16`. Subir la versión hace que los navegadores tomen el
  build nuevo en lugar del que tienen cacheado.
- Dejá `COMPOSE_PROFILES`, `SITE_DOMAIN` y `ACME_EMAIL` **sin poner**: Caddy es solo para el server.
- Si alguna clave tiene caracteres como `@ : / # ? %`, cambiala por una de solo letras y números.

### 1.5 Rebuild con las imágenes nuevas

```bash
docker compose up -d --build     # la primera vez tarda 10-15 min (baja Node 22, nginx estable, etc.)
./scripts/arrancar.sh
```

**Tenés que ver:** el build termina sin `ERROR`, y `arrancar.sh` termina en **TODO ARRIBA**.

**Si el build falla:**
- En `ERROR: AUTH_BASE_URL=...`: revisá el `.env`. Tiene que ser `https://...` completo, sin barra al final.
- En `npm ci` con "lock file out of sync": el lockfile no corresponde. Volvé a los míos con
  `git checkout -- locks/` y rebuildeá.
- Cualquier otra cosa: copiame las últimas 30 líneas.

### 1.6 Probar que la app está igual que antes

1. Abrí la URL del Funnel (o `http://localhost:9095`). Si ves la versión vieja, recargá con `Ctrl+F5`.
2. Logo EBANO, pantalla solo de login, entrar con tu usuario de prueba, la nube en verde.
3. Probá el reloj de dwell y que carguen los tableros predefinidos.
4. Chequeo de seguridad automático:
   ```bash
   ./scripts/verificar-sitio.sh
   ```
   **Tenés que ver:** `TODO OK`. En la PC es normal un `AVISO` sobre la redirección http→https.

### 1.7 Commit y push a `main`

```bash
git add -A
git update-index --chmod=+x scripts/*.sh   # que los scripts sean ejecutables en Linux (Windows no lo registra)
git status                       # confirmá que NO aparezca .env ni backups/
git commit -m "Infra de producción: Caddy, nginx endurecido, Node 22, lockfiles, scripts Linux"
git checkout main
git merge despliegue-donweb
git push origin main
```

**Tenés que ver:** el push sin errores y los cambios en GitHub (`Tatobregon/GridEbano`). El server
va a clonar de ahí.

---

## Fase 2 — Contratar el Cloud Server en DonWeb (~15 min)

### 2.1 Elegir el producto correcto

Tiene que ser **Cloud Server** (un VPS con acceso root), **no** "Hosting" (el compartido, con
cPanel): ahí no se puede instalar Docker.

- **Sistema:** Ubuntu **24.04** LTS
- **CPU / RAM:** 2 vCPU / **4 GB** (con 2 GB anda, pero el build se apoya en la swap y tarda más)
- **Disco:** 40 GB o más
- **Ubicación:** si te deja elegir, la más cercana a tus usuarios
- **Copias de Seguridad:** activá el plan **Premium Diario** (30 copias del server, restauración
  autogestionable). Si no aparece al contratar, se activa después desde el panel (fase 7.4).

### 2.2 Anotar los datos de acceso

Cuando esté creado, anotá en el gestor la **IP pública**, el usuario (`root`) y la **contraseña de
root** (DonWeb la muestra en el panel o la manda por mail).

### 2.3 Firewall del panel (si DonWeb tiene uno)

Si el panel tiene una sección de firewall o reglas de red, permití la entrada a **22/TCP** (SSH),
**80/TCP**, **443/TCP** y **443/UDP**. El firewall interno del server lo configura un script más
adelante.

---

## Fase 3 — Dominio (~10 min + propagación)

### 3.1 Crear el registro DNS

En el panel DNS de tu dominio creá un registro:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | `app` (o el subdominio que elijas) | `TU.IP` | 300 (o el mínimo) |

Hace falta uno solo: la app, el login y la base van todos por el mismo dominio.

### 3.2 Verificar que resuelva

[PC]:
```bash
nslookup app.tudominio.com.ar
```

**Tenés que ver:** `Address: TU.IP`.

**Si todavía no aparece:** puede tardar de minutos a unas horas. Seguí con la fase 4 mientras
tanto; en la fase 5 hay un paso que espera a que resuelva.

---

## Fase 4 — Primer ingreso y preparación del server (~25 min)

### 4.1 Conectarte por SSH

[PC]:
```bash
ssh root@TU.IP
```

La primera vez pregunta *"Are you sure you want to continue connecting?"*: escribí `yes`. Después
pegá la contraseña de root (no se ve mientras la escribís, es normal).

**Tenés que ver:** un prompt tipo `root@nombre-del-server:~#`.

### 4.2 (Recomendado) Entrar con clave SSH en vez de contraseña

**Por qué:** una clave SSH no se puede adivinar por fuerza bruta, y te evita tipear la contraseña
cada vez.

[PC], en **otra** ventana de Git Bash:
```bash
ssh-keygen -t ed25519            # Enter a todo. Si dice que ya existe, respondé n y usá la que tenés
cat ~/.ssh/id_ed25519.pub | ssh root@TU.IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
ssh root@TU.IP                   # ahora NO tiene que pedir contraseña
```

**Opcional, recién cuando la clave funcione:** apagar el login por contraseña. Hacelo [SERVER] y
**sin cerrar la sesión actual**:
```bash
echo "PasswordAuthentication no" > /etc/ssh/sshd_config.d/00-solo-clave.conf
sshd -t && systemctl reload ssh
```
Después probá conectarte desde **otra** ventana. Si entra, listo; si no, borrá ese archivo desde la
sesión que dejaste abierta (`rm /etc/ssh/sshd_config.d/00-solo-clave.conf && systemctl reload ssh`).

### 4.3 Clonar el repo

[SERVER]:
```bash
git clone https://github.com/Tatobregon/GridEbano.git /opt/asterics-grid
cd /opt/asterics-grid
chmod +x scripts/*.sh            # por las dudas: los scripts tienen que ser ejecutables
ls
```

**Tenés que ver:** `docker-compose.yml`, `caddy`, `locks`, `scripts`, etc. Si `git` no existe:
`apt-get update && apt-get install -y git` y repetí.

### 4.4 Preparar el server (un script hace todo)

[SERVER]:
```bash
bash scripts/preparar-server.sh
```

Actualiza Ubuntu, pone la hora de Córdoba e instala Docker, swap, firewall (solo SSH, HTTP y HTTPS),
fail2ban (bloquea a quien prueba contraseñas por SSH), actualizaciones de seguridad automáticas y
rclone (por si algún día querés copiar backups a otro proveedor). Tarda de 5 a 10 minutos.

**Tenés que ver:** al final, `Server listo.` con un resumen (versión de Docker, RAM, swap, disco y
hora argentina).

**Si Ubuntu pide reiniciar** (actualizó el kernel):
```bash
[ -f /var/run/reboot-required ] && reboot
```
Esperá un minuto, volvé a conectarte (`ssh root@TU.IP`) y hacé `cd /opt/asterics-grid`.

---

## Fase 5 — Configurar y levantar (~30 min)

### 5.1 Crear el `.env` con claves nuevas

Un solo bloque crea el `.env` y genera las tres claves de producción. Son claves nuevas: no reuses
las de la PC. Cambiá **solo las dos primeras líneas** (tu dominio y tu mail) y pegá todo junto:

[SERVER]:
```bash
DOMINIO=app.tudominio.com.ar
MAIL=tu-mail@tudominio.com.ar
cat > .env <<EOF
COUCHDB_PASSWORD=$(openssl rand -hex 24)
REGISTER_SECRET=$(openssl rand -hex 24)
ADMIN_UI_PASSWORD=$(openssl rand -hex 24)
AUTH_BASE_URL=https://$DOMINIO
ASTERICS_VERSION=prod-1
COMPOSE_PROFILES=prod
SITE_DOMAIN=$DOMINIO
ACME_EMAIL=$MAIL
EOF
chmod 600 .env                   # que solo lo pueda leer root
cat .env
```

**Tenés que ver:** las 8 líneas. Las tres claves tienen 48 caracteres, solo letras y números (es a
propósito: van dentro de URLs), y `AUTH_BASE_URL` empieza con `https://` y no termina en `/`.

### 5.2 Guardar las claves en el gestor

Copiá las tres claves del `cat .env` al gestor, en una entrada "GridEbano producción". La que vas a
usar seguido es `ADMIN_UI_PASSWORD` (la del panel de alta de usuarios).

Más adelante, para editar el `.env` a mano: `nano .env` (guardar con `Ctrl+O` y `Enter`; salir con
`Ctrl+X`).

### 5.3 Esperar a que el DNS resuelva desde el server

[SERVER]:
```bash
getent hosts app.tudominio.com.ar
curl -4 -s ifconfig.me; echo
```

**Tenés que ver:** la misma IP en las dos líneas.

**Si la primera no muestra nada o da otra IP, esperá** y no sigas. Si Caddy pide el certificado
antes de que el DNS esté bien, Let's Encrypt cuenta el intento fallido y, después de varios, te
bloquea por una hora.

### 5.4 Construir y levantar

[SERVER]:
```bash
docker compose up -d --build
```

La primera vez tarda **10 a 20 minutos** (clona AsTeRICS Grid, instala dependencias, compila el
frontend y baja ~285 MB de tableros).

**Tenés que ver:** al final, cuatro contenedores: `couchdb` (Healthy), `couch-auth`, `frontend` y
`caddy` (Started).

**Si el build se corta con `Killed` o `exit code: 137`:** se quedó sin memoria. Mirá `free -h`
(tiene que haber swap) y volvé a correr el mismo comando: retoma desde donde quedó.

### 5.5 Inicializar y verificar

[SERVER]:
```bash
./scripts/arrancar.sh
```

Crea las bases y la vista `view-usernames` (sin ella couch-auth se cae), reinicia couch-auth y
nginx, y prueba la URL pública.

**Tenés que ver:** `TODO ARRIBA` con `HTTP 200` en Web y Sync.

**Si dice ALGO NO RESPONDIÓ pero `Local -> HTTP 200`:** el stack anda y lo que falla es el acceso
público. Mirá los logs de Caddy:
```bash
docker compose logs --tail 50 caddy
```
Si habla de "challenge" o "timeout", el DNS no apunta bien o el firewall del panel de DonWeb no deja
pasar el 80/443. Corregilo y corré de nuevo `./scripts/arrancar.sh`.

### 5.6 Chequeo completo

[SERVER] (y después también desde tu [PC] con `./scripts/verificar-sitio.sh https://app.tudominio.com.ar`):
```bash
./scripts/verificar-sitio.sh
```

**Tenés que ver:** todas las líneas en `OK` y `TODO OK` al final. Además de probar lo que la app
necesita, confirma que **no** estén expuestos el panel de CouchDB, `.git`, `node_modules`, el
registro público ni el borrado de cuentas.

### 5.7 Mirarlo en el navegador

Abrí `https://app.tudominio.com.ar`. **Tenés que ver:** el candado, el logo EBANO y la pantalla de login.

---

## Fase 6 — Primer usuario y prueba de sync (~15 min)

### 6.1 Crear un usuario desde el panel

1. Entrá a `https://app.tudominio.com.ar/crear-usuario-ebano-soluciones`.
2. Clave de acceso: la `ADMIN_UI_PASSWORD` del `.env`.
3. Creá un usuario de prueba (por ejemplo `prueba1`) con una contraseña de 8 o más caracteres.
4. **Guardalo en el gestor.**

(Alternativa por consola, [SERVER]: `./scripts/crear-usuario.sh prueba1`. Te pide la contraseña sin
mostrarla.)

### 6.2 Login y sync en la PC

Entrá a la app con ese usuario. **Tenés que ver:** la nube en verde. Hacé un cambio visible (por
ejemplo, un tablero nuevo llamado "PRUEBA").

### 6.3 Segundo dispositivo

En el celular o una tablet, entrá a `https://app.tudominio.com.ar` con el mismo usuario.
**Tenés que ver:** el tablero "PRUEBA". Probá también "Agregar a pantalla de inicio" (PWA).

---

## Fase 7 — Backups (~30 min)

El esquema queda en dos capas, las dos dentro de DonWeb:

1. **Local, todas las noches:** un `.tgz` exacto de la base, en `/opt/asterics-grid/backups/`, con
   14 días de historia. Sirve para volver atrás rápido sin llamar a nadie.
2. **Copia de Seguridad de DonWeb, todas las noches:** una copia del **server entero** (incluida la
   carpeta `backups/` con esos `.tgz`) en infraestructura separada de tu server, con 30 días de
   historia y restauración desde el panel. Es la red que te salva si el server se muere entero.

Como la copia de DonWeb se lleva los `.tgz` que dejó el paso 1, tenés backups consistentes fuera del
disco del server sin configurar nada más.

### 7.1 Backup manual

[SERVER]:
```bash
./scripts/backup.sh
ls -lh backups/
tar tzf backups/couchdb_*.tgz | head
```

**Tenés que ver:** `Backup OK: ... (tamaño)`, y en la lista archivos con `shards/`. (El script ya
verifica eso solo: si el backup saliera vacío, lo borra y da error.)

### 7.2 Restore de prueba (ahora que no hay datos reales)

La idea es comprobar que un backup realmente vuelve atrás el servidor.

1. Desde el panel, creá un usuario **`prueba-restore`** (es posterior al backup del 7.1).
2. Listá los usuarios que hay en el server:
   ```bash
   docker compose exec couchdb bash -c 'curl -s "http://admin:$COUCHDB_PASSWORD@127.0.0.1:5984/auth-users/_design/views/_view/view-usernames"'; echo
   ```
   **Tenés que ver:** `prueba1` y `prueba-restore`.
3. Restaurá el backup del 7.1:
   ```bash
   ./scripts/restore.sh backups/couchdb_<fecha>.tgz      # escribí: si
   ```
4. Repetí el comando del punto 2. **Tenés que ver:** solo `prueba1`. El restore funcionó.

> Ojo con lo que **no** hace un restore: vuelve atrás **todo** el servidor (todos los usuarios), y
> un dispositivo que tenga una versión más nueva de un tablero la vuelve a subir cuando sincroniza.
> Sirve para desastres (se rompió la base, se murió el disco), no para "un usuario borró un
> tablero". Para eso queda pendiente un script de restore por usuario.

### 7.3 Agendar el backup nocturno

[SERVER]:
```bash
crontab -e                       # si pregunta el editor, elegí nano (1)
```
Agregá al final esta línea (todas las noches a las 00:30, hora de Córdoba):
```
30 0 * * * cd /opt/asterics-grid && ./scripts/backup.sh --consistente >> /opt/asterics-grid/backups/backup.log 2>&1
```
Guardá (`Ctrl+O`, `Enter`) y salí (`Ctrl+X`).

**Por qué a esa hora:** DonWeb corre sus copias "durante la madrugada", así que conviene que el
`.tgz` de la noche ya esté hecho antes. `--consistente` frena CouchDB unos 10 segundos para que la
copia sea exacta; la app es offline-first y el sync reintenta solo, así que nadie lo nota.

Al día siguiente, chequeá:
```bash
tail -20 /opt/asterics-grid/backups/backup.log
ls -lh /opt/asterics-grid/backups/
```

### 7.4 Activar las Copias de Seguridad en el panel de DonWeb

En el panel de tu Cloud Server, en la sección de **Copias de Seguridad**, elegí el plan:

| Plan | Frecuencia | Copias que guarda | Restaurar |
|---|---|---|---|
| Standard (incluido) | semanal | 1 | pidiendo un ticket a soporte |
| Premium Semanal | semanal | 4 | solo, desde el panel |
| **Premium Diario** (recomendado) | diaria | 30 | solo, desde el panel |

Con **Premium Diario** tenés 30 días de historia del server completo y podés restaurar en un par de
clics, sin depender de soporte. El precio va por el tamaño del disco del server (por eso conviene no
agrandar el disco más de lo necesario: con 40 GB estás holgado).

**Verificá al día siguiente** que en el panel aparezca la primera copia, con fecha.

> Las copias se guardan en infraestructura separada de tu server, así que un problema de hardware no
> se lleva las dos cosas. Lo que no cubre es un problema de cuenta o de proveedor: todo queda en
> DonWeb. Si querés cubrir también eso, el paso 7.5 es la forma barata.

### 7.5 (Opcional pero recomendado) Una copia en tu PC de vez en cuando

Que todo viva en un solo proveedor es el único agujero que queda. Una vez por mes, desde tu [PC]:

```bash
scp root@TU.IP:/opt/asterics-grid/backups/$(ssh root@TU.IP 'ls -t /opt/asterics-grid/backups/couchdb_*.tgz | head -1 | xargs -n1 basename') ~/Downloads/
```

(O más simple: `ssh root@TU.IP 'ls -t /opt/asterics-grid/backups/'` para ver el nombre, y después
`scp root@TU.IP:/opt/asterics-grid/backups/<archivo>.tgz .`)

Guardalo junto con las contraseñas de los usuarios: sin esas contraseñas, los datos de un backup no
se pueden descifrar.

### 7.6 (Opcional, 5 min) Aviso si el backup no corre

En https://healthchecks.io (gratis) creá un check con "Period: 1 day" y "Grace: 2 hours", y copiá su
URL de ping. Agregala al `.env` ([SERVER], `nano .env`):
```ini
BACKUP_PING_URL=https://hc-ping.com/<tu-id>
```
Cada backup exitoso avisa ahí. Si una noche no llega el aviso, te llega un mail.

## Fase 8 — Tests finales antes de dar clientes de alta

- [ ] `./scripts/verificar-sitio.sh https://app.tudominio.com.ar` desde tu **[PC]** → `TODO OK`.
- [ ] **Offline:** con la app abierta en el celular, poné modo avión. Tiene que seguir andando.
      Hacé un cambio, sacá el modo avión y verificá que aparezca en el otro dispositivo.
- [ ] **Voz:** que hable, con la voz que usan normalmente.
- [ ] **Reloj de dwell** y tableros predefinidos, igual que en la PC.
- [ ] **Test de caída**, [SERVER]: `docker compose stop couchdb`, esperá 30 s, hacé un cambio en la
      app, mirá la nube, `docker compose start couchdb`. Con la configuración actual
      (`retry: true`), la nube puede **seguir en verde** mientras el server está caído; el cambio
      se sube solo cuando vuelve. Anotá lo que ves: es la decisión pendiente sobre el ícono.
- [ ] **Reinicio del server**, [SERVER]: `reboot`. Esperá 2 minutos, reconectate y corré
      `./scripts/verificar-sitio.sh`. Todo tiene que volver solo.
- [ ] Si van a usar **EbanoVoz** con esta instalación: que la voz externa (`127.0.0.1:5555`)
      funcione desde el dominio nuevo.
- [ ] Backup de la noche en `backups/backup.log`, y la primera Copia de Seguridad visible en el
      panel de DonWeb.

---

## Fase 9 — Después (no bloquea el lanzamiento)

- [ ] **Apagar la PC como servidor:** en la PC, `"/c/Program Files/Tailscale/tailscale.exe" funnel reset`
      y `docker compose down`. Sacar la URL del Funnel de los docs.
- [ ] **Monitoreo de caída:** un check HTTP gratuito (UptimeRobot o similar) contra
      `https://app.tudominio.com.ar/`, con aviso por mail.
- [ ] **Decidir el ícono de sync** según lo que viste en el test de caída.
- [ ] **Script de restore por usuario** (recuperar lo que borró una persona sin tocar a las demás).
- [ ] Link visible al código fuente (AGPL) fuera de "Acerca de".
- [ ] Borrar los usuarios de prueba cuando ya no hagan falta: `./scripts/borrar-usuario.sh prueba1`.

---

## Operación diaria (referencia rápida)

Todo [SERVER], parado en `/opt/asterics-grid`:

| Qué | Comando |
|---|---|
| Conectarse | [PC] `ssh root@TU.IP` y después `cd /opt/asterics-grid` |
| Estado | `docker compose ps` |
| Logs | `docker compose logs --tail 50 couch-auth` (o `couchdb`, `frontend`, `caddy`) |
| Chequeo completo | `./scripts/verificar-sitio.sh` |
| Crear usuario | Panel web, o `./scripts/crear-usuario.sh <usuario>` |
| Borrar usuario | `./scripts/borrar-usuario.sh <usuario>` (irreversible) |
| Backup ya | `./scripts/backup-offsite.sh` |
| Restaurar | `./scripts/restore.sh backups/<archivo>.tgz` |
| Parches de seguridad (cada ~mes) | `./scripts/parchear.sh` |
| Bajar un backup a tu PC | [PC] `scp root@TU.IP:/opt/asterics-grid/backups/<archivo>.tgz .` |
| Levantar todo tras un problema | `./scripts/arrancar.sh` |

**Actualizar el código** (después de un push a `main`):
```bash
git pull
docker compose up -d --build
./scripts/arrancar.sh
```
Si cambiaste algo del frontend, antes subí `ASTERICS_VERSION` en el `.env` (por ejemplo `prod-2`),
así los navegadores toman la versión nueva.

**Ver la base de datos con Fauxton, en privado.** Fauxton no está publicado (a propósito). Para usarlo:
[PC] `ssh -L 5984:127.0.0.1:5984 root@TU.IP`, dejá esa ventana abierta y entrá en el navegador a
`http://localhost:5984/_utils` (usuario `admin`, clave `COUCHDB_PASSWORD`).

---

## Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El navegador dice "no es seguro" o no carga por HTTPS | Caddy no pudo sacar el certificado | `docker compose logs caddy`: revisá DNS (5.3) y el firewall del panel (2.3). Después, `./scripts/arrancar.sh` |
| 502 Bad Gateway | nginx apunta a un contenedor recreado | `docker compose restart frontend` (o `./scripts/arrancar.sh`) |
| `couch-auth` en "Restarting" | Falta una base o la vista `view-usernames` | `./scripts/arrancar.sh` |
| "Usuario o contraseña incorrectos" con un usuario recién creado | Se creó sin el hash de la app | Crear usuarios **solo** con el panel o `crear-usuario.sh` |
| El build termina en `Killed` | Poca memoria | `free -h` (tiene que haber swap) y repetir el build |
| La app muestra una versión vieja | Service worker cacheado | Subir `ASTERICS_VERSION` y rebuildear; en el navegador, `Ctrl+F5` |
| `backup.sh`: "no existe el volumen" | El stack nunca se levantó con este compose | `docker compose up -d` primero |
| Muchos 503 en el login | Rate limit (60 por minuto por IP) | Esperar un minuto; si es un ataque, `fail2ban` y el límite lo contienen |
| El disco se llena | Imágenes viejas de builds anteriores | `docker image prune -f` (no toca los datos) |

**Nunca** uses `docker compose down -v`: el `-v` borra el volumen con **todos** los datos.
