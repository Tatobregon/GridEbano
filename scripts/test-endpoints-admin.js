/**
 * Test de los endpoints de admin que agrega scripts/patch-admin-endpoints.js.
 *
 * QUÉ PRUEBA: que /admin/listar-usuarios y /admin/datos-usuario hablan bien con CouchDB y no se
 * pueden usar para pedir datos de otra base. Lo hace contra un CouchDB SIMULADO (un servidor HTTP
 * mínimo acá mismo), así no necesita el stack levantado.
 *
 * Los puntos finos que cubre:
 *   - el "$" del nombre de la base (asterics-grid-data$hash) tiene que viajar como %24 en la URL,
 *     si no CouchDB devuelve 404 y el panel queda roto;
 *   - la base se resuelve SIEMPRE desde auth-users, nunca con el texto que mandó el navegador;
 *   - sin la clave de admin no se devuelve nada;
 *   - solo salen los modelos que van al .grd, y solo la versión cifrada completa.
 *
 * USO: node scripts/test-endpoints-admin.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const RAIZ = path.resolve(__dirname, '..');
const CLAVE_ADMIN = 'claveDeAdminDePrueba';
const CLAVE_COUCH = 'claveDeCouchDePrueba';
const BASE_USUARIO = 'asterics-grid-data$abc123';

let fallos = 0;
const ok = (cond, texto) => {
    console.log((cond ? '  OK   ' : '  FALLA') + '  ' + texto);
    if (!cond) fallos++;
};

// ── Saca el bloque de código que el patch inyecta en start.js y lo activa acá ──────────────────
// Nota: hay que pasarle `require` porque el bloque corre dentro de una función y no en un módulo;
// en el start.js de verdad `require` ya está disponible.
function cargarEndpoints(app, config, USERNAME_REGEX) {
    const src = fs.readFileSync(path.join(RAIZ, 'scripts', 'patch-admin-endpoints.js'), 'utf8');
    const ini = src.indexOf('const block = `');
    if (ini === -1) throw new Error('no encontré el bloque inyectado en patch-admin-endpoints.js');
    const desde = ini + 'const block = `'.length;
    const hasta = src.indexOf('\n`;', desde);
    if (hasta === -1) throw new Error('no encontré el final del bloque inyectado');
    const bloque = src.slice(desde, hasta);
    if (!bloque.includes("/admin/datos-usuario")) throw new Error('el bloque extraído no tiene los endpoints nuevos');
    new Function('app', 'config', 'USERNAME_REGEX', 'require', bloque)(app, config, USERNAME_REGEX, require);
}

// ── CouchDB simulado ───────────────────────────────────────────────────────────────────────────
function cifradoFalso(texto) { return '{"iv":"x","ct":"' + Buffer.from(texto).toString('base64') + '"}'; }

const docsDeLaBase = [
    { _id: '_design/algo', modelName: undefined },
    { _id: 'grid-data-1', modelName: 'GridData', modelVersion: '{"major": 7}', encryptedDataBase64: cifradoFalso('tablero 1'), encryptedDataBase64Short: cifradoFalso('corto') },
    { _id: 'grid-data-2', modelName: 'GridData', modelVersion: '{"major": 7}', encryptedDataBase64: cifradoFalso('tablero 2') },
    { _id: 'meta-data-1', modelName: 'MetaData', modelVersion: '{"major": 7}', encryptedDataBase64: cifradoFalso('config') },
    { _id: 'dictionary-1', modelName: 'Dictionary', modelVersion: '{"major": 7}', encryptedDataBase64: cifradoFalso('diccionario') },
    { _id: 'preview-1', modelName: 'GridPreview', encryptedDataBase64: cifradoFalso('no va al grd') },
    { _id: 'grid-data-roto', modelName: 'GridData' }   // sin datos cifrados: hay que saltearlo
];

const pedidosVistos = [];
function levantarCouchFalso() {
    return new Promise((resolve) => {
        const srv = http.createServer((req, res) => {
            pedidosVistos.push(req.url);
            const esperado = 'Basic ' + Buffer.from('admin:' + CLAVE_COUCH).toString('base64');
            if (req.headers.authorization !== esperado) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                return res.end('{"error":"unauthorized"}');
            }
            const responder = (obj) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(obj));
            };
            if (req.url.indexOf('/auth-users/_all_docs') === 0) {
                return responder({ rows: [
                    { doc: { _id: '_design/views', views: {} } },
                    { doc: { _id: 'juanperez', key: 'juanperez', personalDBs: { [BASE_USUARIO]: { name: 'asterics-grid-data', type: 'private' } } } },
                    { doc: { _id: 'sinbase', key: 'sinbase' } },
                    { doc: { _id: 'anagomez', key: 'anaGomez', personalDBs: { 'asterics-grid-data$def456': {} } } }
                ] });
            }
            if (req.url.indexOf('/' + encodeURIComponent(BASE_USUARIO) + '/_all_docs') === 0) {
                return responder({ rows: docsDeLaBase.map((d) => ({ doc: d })) });
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end('{"error":"not_found"}');
        });
        srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
}

// ── req/res de mentira para llamar a los handlers ──────────────────────────────────────────────
function llamar(handler, body) {
    return new Promise((resolve) => {
        const salida = { codigo: 200, cuerpo: null, headers: {} };
        const res = {
            set: (k, v) => { salida.headers[k] = v; return res; },
            status: (c) => { salida.codigo = c; return res; },
            json: (o) => { salida.cuerpo = o; resolve(salida); return res; },
            type: () => res,
            send: (t) => { salida.cuerpo = t; resolve(salida); return res; }
        };
        Promise.resolve(handler({ body: body }, res)).catch((e) => {
            salida.codigo = 500; salida.cuerpo = { error: 'excepción: ' + e.message }; resolve(salida);
        });
    });
}

// Historial de mentira en disco: un punto bueno, un .meta sin su .json.gz (huérfano) y un archivo
// con nombre que no es una fecha. Solo el primero tiene que aparecer en la lista.
function prepararHistorial() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'historial-test-'));
    const u = path.join(dir, 'juanperez');
    fs.mkdirSync(u, { recursive: true });
    const dump = {
        formato: 1, usuario: 'juanperez', base: BASE_USUARIO, fecha: '2026-09-24_0030', update_seq: '9-vieja',
        documentos: [
            { _id: 'grid-data-viejo', modelName: 'GridData', modelVersion: '{"major": 7}', encryptedDataBase64: cifradoFalso('tablero de hace una semana') },
            { _id: 'meta-data-1', modelName: 'MetaData', modelVersion: '{"major": 7}', encryptedDataBase64: cifradoFalso('config vieja') },
            { _id: 'colado', modelName: 'GridPreview', encryptedDataBase64: cifradoFalso('no deberia salir') }
        ]
    };
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(dump), 'utf8'));
    fs.writeFileSync(path.join(u, '2026-09-24_0030.json.gz'), gz);
    fs.writeFileSync(path.join(u, '2026-09-24_0030.meta.json'), JSON.stringify({ fecha: '2026-09-24_0030', tableros: 1, documentos: 3, bytes: gz.length }));
    fs.writeFileSync(path.join(u, '2026-09-25_0030.meta.json'), JSON.stringify({ tableros: 9 }));   // huérfano
    fs.writeFileSync(path.join(u, 'cualquiercosa.meta.json'), '{}');                                 // nombre inválido
    return dir;
}

(async () => {
    const srv = await levantarCouchFalso();
    const puerto = srv.address().port;
    process.env.ADMIN_UI_PASSWORD = CLAVE_ADMIN;
    const historial = prepararHistorial();
    process.env.HISTORIAL_DIR = historial;

    const rutas = {};
    const app = { post: (ruta, h) => { rutas[ruta] = h; } };
    const config = { dbServer: {
        protocol: 'http://', host: '127.0.0.1:' + puerto,
        user: 'admin', password: CLAVE_COUCH, userDB: 'auth-users'
    } };
    cargarEndpoints(app, config, /^[a-z0-9][a-z0-9_-]{2,15}$/);
    console.log('endpoints cargados: ' + Object.keys(rutas).join(', ') + '\n');

    console.log('[1] Sin la clave de admin no se devuelve nada');
    let r = await llamar(rutas['/admin/listar-usuarios'], { accessPassword: 'equivocada' });
    ok(r.codigo === 403, 'listar-usuarios con clave mal -> 403 (dio ' + r.codigo + ')');
    r = await llamar(rutas['/admin/datos-usuario'], { accessPassword: 'equivocada', usuario: 'juanperez' });
    ok(r.codigo === 403, 'datos-usuario con clave mal -> 403 (dio ' + r.codigo + ')');
    r = await llamar(rutas['/admin/listar-usuarios'], {});
    ok(r.codigo === 403, 'sin clave -> 403');

    console.log('\n[2] Lista de usuarios');
    r = await llamar(rutas['/admin/listar-usuarios'], { accessPassword: CLAVE_ADMIN });
    ok(r.codigo === 200 && r.cuerpo.ok === true, 'responde OK');
    ok(JSON.stringify(r.cuerpo.usuarios) === JSON.stringify(['anaGomez', 'juanperez']),
        'devuelve los usuarios ordenados y nada más: ' + JSON.stringify(r.cuerpo.usuarios));
    ok(r.cuerpo.usuarios.indexOf('sinbase') === -1, 'saltea el usuario sin base de datos');
    ok(!JSON.stringify(r.cuerpo).includes('_design'), 'no filtra el documento de diseño');
    ok(r.headers['Cache-Control'] === 'no-store', 'manda Cache-Control: no-store');

    console.log('\n[3] Nombres de usuario inválidos (no se puede pedir una base arbitraria)');
    for (const malo of ['../auth-users', 'asterics-grid-data$abc123', '_users', 'ab', 'a'.repeat(17), '', 'con espacio', 'juan.perez']) {
        r = await llamar(rutas['/admin/datos-usuario'], { accessPassword: CLAVE_ADMIN, usuario: malo });
        ok(r.codigo === 400, 'rechaza "' + malo.slice(0, 24) + '" con 400 (dio ' + r.codigo + ')');
    }
    r = await llamar(rutas['/admin/datos-usuario'], { accessPassword: CLAVE_ADMIN, usuario: 'noexiste' });
    ok(r.codigo === 404, 'un usuario que no existe -> 404 (dio ' + r.codigo + ')');
    // A propósito: el nombre se pasa a minúsculas ANTES de validar, así escribirlo con mayúsculas
    // (o con un espacio al final al pegarlo) igual encuentra al usuario.
    r = await llamar(rutas['/admin/datos-usuario'], { accessPassword: CLAVE_ADMIN, usuario: '  JUANPEREZ ' });
    ok(r.codigo === 200 && r.cuerpo.usuario === 'juanperez',
        'escrito como "  JUANPEREZ " encuentra a juanperez (dio ' + r.codigo + ')');

    console.log('\n[4] Datos de un usuario');
    pedidosVistos.length = 0;
    r = await llamar(rutas['/admin/datos-usuario'], { accessPassword: CLAVE_ADMIN, usuario: 'juanperez' });
    ok(r.codigo === 200 && r.cuerpo.ok === true, 'responde OK (dio ' + r.codigo + ': ' + JSON.stringify(r.cuerpo).slice(0, 120) + ')');
    const docs = (r.cuerpo || {}).documentos || [];
    ok(docs.length === 4, 'devuelve los 4 documentos que van al .grd (devolvió ' + docs.length + ')');
    ok(docs.every((d) => ['GridData', 'MetaData', 'Dictionary'].indexOf(d.modelName) !== -1), 'solo modelos del .grd');
    ok(!JSON.stringify(docs).includes('GridPreview'), 'deja afuera GridPreview');
    ok(!docs.some((d) => d._id === 'grid-data-roto'), 'saltea el documento sin datos cifrados');
    ok(!JSON.stringify(docs).includes('encryptedDataBase64Short'), 'no manda la versión corta (sin imágenes)');
    ok(docs.every((d) => !!d.encryptedDataBase64 && !!d.modelVersion), 'cada documento viaja con su dato cifrado y su versión');
    ok(r.cuerpo.totalEnBase === 6, 'informa cuántos documentos hay en la base en total (informó ' + r.cuerpo.totalEnBase + ')');

    console.log('\n[5] El "$" del nombre de la base (la trampa clásica)');
    const pedidoBase = pedidosVistos.filter((u) => u.indexOf('asterics-grid-data') !== -1)[0] || '';
    ok(pedidoBase.indexOf('%24') !== -1, 'el pedido a CouchDB usa %24: ' + pedidoBase.split('?')[0]);
    ok(pedidoBase.indexOf('$') === -1, 'no manda el "$" sin escapar (CouchDB respondería 404)');

    console.log('\n[6] Nada descifrado del lado del servidor');
    const cuerpoTexto = JSON.stringify(r.cuerpo);
    ok(cuerpoTexto.indexOf('tablero 1') === -1, 'la respuesta no contiene texto en claro de los tableros');
    ok(docs[0].encryptedDataBase64.indexOf('"ct"') !== -1, 'los documentos salen tal cual, cifrados');

    console.log('\n[7] Puntos de recuperación (historial)');
    r = await llamar(rutas['/admin/puntos-recuperacion'], { accessPassword: 'equivocada', usuario: 'juanperez' });
    ok(r.codigo === 403, 'sin la clave de admin -> 403');
    r = await llamar(rutas['/admin/puntos-recuperacion'], { accessPassword: CLAVE_ADMIN, usuario: 'juanperez' });
    ok(r.codigo === 200 && r.cuerpo.ok === true, 'responde OK');
    ok(r.cuerpo.puntos.length === 1 && r.cuerpo.puntos[0].punto === '2026-09-24_0030',
        'lista solo el punto válido: ' + JSON.stringify(r.cuerpo.puntos.map((p) => p.punto)));
    ok(r.cuerpo.puntos[0].tableros === 1 && r.cuerpo.puntos[0].bytes > 0, 'informa tableros y tamaño sin abrir el archivo');
    r = await llamar(rutas['/admin/puntos-recuperacion'], { accessPassword: CLAVE_ADMIN, usuario: 'anagomez' });
    ok(r.codigo === 200 && r.cuerpo.puntos.length === 0, 'un usuario sin historial devuelve lista vacía, no error');

    console.log('\n[8] Leer los datos DE UNA FECHA');
    r = await llamar(rutas['/admin/datos-usuario'], { accessPassword: CLAVE_ADMIN, usuario: 'juanperez', punto: '2026-09-24_0030' });
    ok(r.codigo === 200 && r.cuerpo.ok === true, 'responde OK (dio ' + r.codigo + ')');
    ok(r.cuerpo.punto === '2026-09-24_0030', 'dice de qué punto salió');
    ok(r.cuerpo.documentos.length === 2, 'devuelve los 2 documentos del .grd del volcado (devolvió ' + r.cuerpo.documentos.length + ')');
    ok(!JSON.stringify(r.cuerpo).includes('GridPreview'), 'filtra los modelos que no van al .grd también acá');
    ok(r.cuerpo.documentos[0]._id === 'grid-data-viejo', 'son los datos VIEJOS, no los de la base viva');
    r = await llamar(rutas['/admin/datos-usuario'], { accessPassword: CLAVE_ADMIN, usuario: 'juanperez', punto: '2026-01-01_0000' });
    ok(r.codigo === 404, 'una fecha que no existe -> 404 (dio ' + r.codigo + ')');

    console.log('\n[9] No se puede salir de la carpeta del historial');
    for (const malo of ['../../etc/passwd', '..', '2026-09-24_0030/../../../etc/passwd', 'x', '2026-9-24_030', '']) {
        const body = { accessPassword: CLAVE_ADMIN, usuario: 'juanperez', punto: malo };
        r = await llamar(rutas['/admin/datos-usuario'], body);
        // '' significa "estado actual": ese camino es válido y va a la base viva (200).
        const esperado = malo === '' ? 200 : 400;
        ok(r.codigo === esperado, 'punto "' + malo.slice(0, 28) + '" -> ' + esperado + ' (dio ' + r.codigo + ')');
    }

    srv.close();
    fs.rmSync(historial, { recursive: true, force: true });
    console.log('\n' + (fallos === 0 ? 'TODO OK (' : fallos + ' FALLA(S) de ') + 'los chequeos de los endpoints de admin');
    process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
