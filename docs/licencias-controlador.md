# Licencias de Controlador Ebano

Controlador Ebano (el mouse con la mirada de Ébano Soluciones) se activa **una vez por
computadora** con un código que se genera en el panel de admin, solapa **Licencias**. Es una
medida contra la redistribución, no un vencimiento: una computadora activada funciona siempre,
también sin internet, y no se desactiva nunca desde el servidor.

## Cómo está armado

- **Servicio `licencias`** (`licencias/server.js`, `Dockerfile.licencias`): un contenedor aparte, sin
  dependencias (solo Node 22). Va separado de `couch-auth` a propósito: si se cae, el login y el
  sync del comunicador siguen igual.
- **nginx** le manda `/licencias/` (lo que usa el programa, público con límite de 10 pedidos por
  minuto) y `/admin/licencias/` (la solapa del panel, con la clave de acceso). Lo busca recién cuando
  llega un pedido: nginx arranca aunque este servicio esté caído.
- **Registro**: base `licencias-controlador` del mismo CouchDB, solo para el admin, un documento por
  código (paciente, nota, equipo, fechas, equipos anteriores). Entra sola en los backups de cada
  noche. nginx no la publica nunca (`/couchdb/licencias-controlador` da 404).
- **Firma**: cada licencia va firmada con la clave privada `LICENCIAS_CLAVE_PRIVADA` (Ed25519). El
  programa trae la clave pública y verifica la firma sin internet cada vez que arranca. Con la clave
  pública no se pueden fabricar licencias, así que este repo puede ser público.

## Puesta en marcha (una sola vez)

1. **La clave privada.** Está en el archivo `licencias_clave_privada.txt` (carpeta del certificado
   de Ebano y pendrive). La línea que no empieza con `#` son 64 letras y números.
2. **En el server**, agregala al `.env` ([SERVER], `nano .env`), en una línea nueva:
   ```
   LICENCIAS_CLAVE_PRIVADA=<los 64 caracteres>
   ```
   Guardar con `Ctrl+O` y `Enter`, salir con `Ctrl+X`.
3. **Levantar** (como cualquier actualización):
   ```bash
   git pull
   docker compose up -d --build
   ./scripts/arrancar.sh
   ```
4. **Verificar**:
   ```bash
   curl -s https://<tu dominio>/licencias/estado
   ```
   Tiene que decir `"firma":true` y la `clavePublica` tiene que ser la del programa:
   `bd40fb6d566c5a97df5fe3608dce8f37eeb6fead701bb191710ce86240898f2b`. Si es otra, la clave del
   `.env` no es la que corresponde y el programa va a rechazar las licencias.
   Después, `./scripts/verificar-sitio.sh` tiene que dar `TODO OK`.

## Uso

**Computadora con internet (lo normal):**
1. Panel → solapa **Licencias** → nombre del paciente (y una nota si querés, por ejemplo "PC de la
   casa") → **Generar código de activación**. Sale un código de 8 caracteres, tipo `K7QM-2XPA`.
2. En la computadora del paciente, el programa lo pide la primera vez que se abre (ventana
   **Activar**). Se escribe ahí y listo.

**Computadora sin internet:** la ventana Activar muestra el **código del equipo**
(`XXXX-XXXX-XXXX`). En la solapa Licencias, "¿La computadora del paciente no tiene internet?" →
código del equipo → **Descargar archivo de licencia**. Se lleva en un pendrive y se abre con
**Abrir archivo de licencia…** en la ventana Activar.

**Cambio de computadora** (se rompió, compraron otra, se reinstaló Windows): en la lista, **Pasar a
otro equipo**. El mismo código sirve una vez más en la computadora nueva. La anterior sigue
funcionando (no se desactiva a distancia) y queda anotada como "Antes en".

**Un código creado por error**: **Borrar** (solo los que nunca se usaron; los usados quedan como
registro).

## Qué pasa si...

| Situación | Qué pasa | Qué hacer |
|---|---|---|
| El servidor o el servicio `licencias` está caído | Las computadoras ya activadas no se enteran (no consultan nunca al servidor). Solo no se pueden activar nuevas | `docker compose ps licencias`, `docker compose logs --tail 50 licencias`, `./scripts/arrancar.sh` |
| La solapa dice que falta la clave | El `.env` no tiene `LICENCIAS_CLAVE_PRIVADA` (o está mal escrita) | Paso 2 de la puesta en marcha y `docker compose up -d licencias` |
| El programa dice "ese código ya se usó en otra computadora" | Es la traba contra la redistribución | Si es un cambio de computadora legítimo: **Pasar a otro equipo** |
| "Demasiados intentos seguidos" | Límite de 10 por minuto por IP | Esperar un minuto |
| Se perdió la clave privada | Las computadoras activadas siguen andando igual | Crear un par nuevo (`python tools/licencias.py crear-claves` en el repo del programa) y sacar una versión del programa que conozca la pública nueva |
| Se filtró la clave privada | Alguien podría hacer licencias para copias; a los pacientes no les cambia nada | Igual que si se perdió: par nuevo y versión nueva del programa |
| El servidor no existe más | Las activadas siguen andando | Con la clave del pendrive se hacen licencias desde la PC: `python tools/licencias.py firmar ...` (repo del programa) |

## Pruebas

`node scripts/test-licencias.js` (Node 22, sin `npm install`): el flujo completo contra un CouchDB
simulado, incluida la licencia exacta que espera el programa (el repo del programa tiene el mismo
texto esperado en `tests/test_license.py`).
