/**
 * Test del volcado por usuario (scripts/dump-usuarios.js), contra un CouchDB SIMULADO.
 *
 * Cubre lo que puede salir mal de verdad:
 *   - que escriba el .json.gz y su .meta.json con los datos correctos;
 *   - que NO vuelva a volcar a un usuario que no cambió (si no, el disco se llena al pedo);
 *   - que SÍ vuelva a volcar cuando cambió;
 *   - que la limpieza borre lo viejo pero NUNCA el último volcado de un usuario;
 *   - que no se escape nada descifrado ni la versión corta de los documentos.
 *
 * USO: node scripts/test-dump-usuarios.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { execFile } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const DUMPER = path.join(RAIZ, 'scripts', 'dump-usuarios.js');
const CLAVE_COUCH = 'claveDeCouchDePrueba';
const BASE = 'asterics-grid-data$abc123';

let fallos = 0;
const ok = (cond, texto) => { console.log((cond ? '  OK   ' : '  FALLA') + '  ' + texto); if (!cond) fallos++; };
const cifradoFalso = (t) => '{"iv":"x","ct":"' + Buffer.from(t).toString('base64') + '"}';

// Estado del CouchDB simulado (lo vamos cambiando entre corridas)
const estado = {
    update_seq: '10-aaa',
    docs: [
        { _id: '_design/algo' },
        { _id: 'grid-data-1', modelName: 'GridData', modelVersion: '{"major": 7}', encryptedDataBase64: cifradoFalso('tablero 1'), encryptedDataBase64Short: cifradoFalso('corto') },
        { _id: 'grid-data-2', modelName: 'GridData', modelVersion: '{"major": 7}', encryptedDataBase64: cifradoFalso('tablero 2') },
        { _id: 'meta-data-1', modelName: 'MetaData', modelVersion: '{"major": 7}', encryptedDataBase64: cifradoFalso('config') },
        { _id: 'preview-1', modelName: 'GridPreview', encryptedDataBase64: cifradoFalso('no va') }
    ],
    // un segundo usuario que nunca tiene tableros
    vacio: true
};

function levantarCouchFalso() {
    return new Promise((resolve) => {
        const srv = http.createServer((req, res) => {
            const esperado = 'Basic ' + Buffer.from('admin:' + CLAVE_COUCH).toString('base64');
            if (req.headers.authorization !== esperado) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                return res.end('{"error":"unauthorized"}');
            }
            const responder = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
            const u = req.url;
            if (u.indexOf('/auth-users/_all_docs') === 0) {
                return responder({ rows: [
                    { doc: { _id: '_design/views' } },
                    { doc: { _id: 'juanperez', key: 'juanperez', personalDBs: { [BASE]: {} } } },
                    { doc: { _id: 'sintableros', key: 'sintableros', personalDBs: { 'asterics-grid-data$zzz': {} } } }
                ] });
            }
            if (u === '/' + encodeURIComponent(BASE)) return responder({ db_name: BASE, update_seq: estado.update_seq });
            if (u.indexOf('/' + encodeURIComponent(BASE) + '/_all_docs') === 0) return responder({ rows: estado.docs.map((d) => ({ doc: d })) });
            if (u === '/' + encodeURIComponent('asterics-grid-data$zzz')) return responder({ db_name: 'zzz', update_seq: '1-x' });
            if (u.indexOf('/' + encodeURIComponent('asterics-grid-data$zzz') + '/_all_docs') === 0) return responder({ rows: [] });
            res.writeHead(404); res.end('{}');
        });
        srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
}

// Asíncrono a propósito: el CouchDB simulado vive en ESTE proceso, así que si esperáramos al
// dumper de forma sincrónica el servidor no podría contestarle y se trabarían los dos.
function correrDumper(salida, puerto, fecha, extra) {
    const env = Object.assign({}, process.env, {
        COUCHDB_URL: 'http://127.0.0.1:' + puerto,
        COUCHDB_USER: 'admin',
        COUCHDB_PASSWORD: CLAVE_COUCH,
        SALIDA: salida,
        FECHA: fecha
    }, extra || {});
    return new Promise((resolve, reject) => {
        execFile(process.execPath, [DUMPER], { env: env, encoding: 'utf8', timeout: 30000 },
            (err, stdout, stderr) => {
                if (err) return reject(new Error((stderr || '') + (stdout || '') + err.message));
                resolve(stdout);
            });
    });
}

(async () => {
    const srv = await levantarCouchFalso();
    const puerto = srv.address().port;
    const salida = fs.mkdtempSync(path.join(os.tmpdir(), 'historial-'));
    const dirUsuario = path.join(salida, 'juanperez');

    console.log('[1] Primer volcado');
    let out = await correrDumper(salida, puerto, '2026-09-20_0030');
    ok(out.includes('+ juanperez'), 'vuelca a juanperez');
    ok(out.includes('- sintableros'), 'saltea al usuario sin tableros');
    ok(fs.existsSync(path.join(dirUsuario, '2026-09-20_0030.json.gz')), 'escribió el .json.gz');
    ok(fs.existsSync(path.join(dirUsuario, '2026-09-20_0030.meta.json')), 'escribió el .meta.json');
    ok(!fs.readdirSync(dirUsuario).some((f) => f.endsWith('.parcial')), 'no quedan archivos a medio escribir');

    console.log('\n[2] Contenido del volcado');
    const gz = fs.readFileSync(path.join(dirUsuario, '2026-09-20_0030.json.gz'));
    const dump = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
    ok(dump.usuario === 'juanperez' && dump.base === BASE, 'guarda usuario y base');
    ok(dump.update_seq === '10-aaa', 'guarda el update_seq para detectar cambios');
    ok(dump.documentos.length === 3, 'guarda los 3 documentos del .grd (guardó ' + dump.documentos.length + ')');
    ok(!JSON.stringify(dump).includes('GridPreview'), 'deja afuera los modelos que no van al .grd');
    ok(!JSON.stringify(dump).includes('encryptedDataBase64Short'), 'no guarda la versión corta');
    ok(!JSON.stringify(dump).includes('tablero 1'), 'no hay nada descifrado adentro');
    const meta = JSON.parse(fs.readFileSync(path.join(dirUsuario, '2026-09-20_0030.meta.json'), 'utf8'));
    ok(meta.tableros === 2 && meta.documentos === 3, 'el .meta.json cuenta 2 tableros y 3 documentos');
    ok(meta.bytes === gz.length, 'el .meta.json dice el tamaño real del archivo');

    console.log('\n[3] Sin cambios -> no vuelve a volcar (esto es lo que evita llenar el disco)');
    out = await correrDumper(salida, puerto, '2026-09-21_0030');
    ok(out.includes('= juanperez') && out.includes('sin cambios'), 'detecta que no cambió');
    ok(!fs.existsSync(path.join(dirUsuario, '2026-09-21_0030.json.gz')), 'no escribió un volcado nuevo');

    console.log('\n[4] Con --forzar sí vuelca igual');
    out = await correrDumper(salida, puerto, '2026-09-21_0100', { FORZAR: '1' });
    ok(fs.existsSync(path.join(dirUsuario, '2026-09-21_0100.json.gz')), 'forzado escribe aunque no haya cambios');

    console.log('\n[5] Si el usuario cambia, vuelca solo');
    estado.update_seq = '11-bbb';
    estado.docs.push({ _id: 'grid-data-3', modelName: 'GridData', modelVersion: '{"major": 7}', encryptedDataBase64: cifradoFalso('tablero 3') });
    out = await correrDumper(salida, puerto, '2026-09-22_0030');
    ok(out.includes('+ juanperez'), 'detecta el cambio y vuelca');
    const dump2 = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dirUsuario, '2026-09-22_0030.json.gz'))).toString('utf8'));
    ok(dump2.documentos.length === 4, 'el volcado nuevo trae el tablero agregado');

    console.log('\n[6] Limpieza: borra lo viejo pero NUNCA el último');
    // La antigüedad se mide por la FECHA DEL VOLCADO contra el más nuevo del usuario. Volcamos uno
    // muy posterior: todo lo de septiembre queda fuera de los 30 días y tiene que desaparecer.
    estado.update_seq = '12-ccc';
    await correrDumper(salida, puerto, '2026-12-01_0030', { RETENCION_DIAS: '30' });
    let quedan = fs.readdirSync(dirUsuario).filter((f) => f.endsWith('.json.gz')).sort();
    ok(quedan.length === 1 && quedan[0] === '2026-12-01_0030.json.gz',
        'quedó solo el volcado nuevo (quedaron: ' + quedan.join(', ') + ')');
    ok(!fs.readdirSync(dirUsuario).some((f) => f.startsWith('2026-09')),
        'también se llevó los .meta.json viejos');

    // El caso importante: un usuario que NO cambia nunca no puede quedarse sin nada.
    await correrDumper(salida, puerto, '2027-06-01_0030', { RETENCION_DIAS: '30' });
    quedan = fs.readdirSync(dirUsuario).filter((f) => f.endsWith('.json.gz'));
    ok(quedan.length === 1, 'un usuario que no cambia conserva igual su último volcado (quedaron ' + quedan.length + ')');

    console.log('\n[7] Rellenar el historial hacia atrás (desde los .tgz viejos)');
    // Con un volcado ya existente de HOY, volcar una fecha ANTERIOR tiene que compararse contra el
    // anterior más cercano, no contra el más nuevo. Si no, rellenar el historial duplicaría todo.
    estado.update_seq = '50-hoy';
    await correrDumper(salida, puerto, '2027-06-02_0030');
    estado.update_seq = '5-vieja';
    await correrDumper(salida, puerto, '2027-05-10_0030');          // anterior al más nuevo -> vuelca
    ok(fs.existsSync(path.join(dirUsuario, '2027-05-10_0030.json.gz')), 'vuelca la fecha vieja');
    await correrDumper(salida, puerto, '2027-05-11_0030');          // mismo seq que la anterior -> saltea
    ok(!fs.existsSync(path.join(dirUsuario, '2027-05-11_0030.json.gz')),
        'no duplica cuando la fecha vieja siguiente tiene el mismo contenido');
    const antes = fs.statSync(path.join(dirUsuario, '2027-05-10_0030.json.gz')).mtimeMs;
    await new Promise((r) => setTimeout(r, 1100));
    await correrDumper(salida, puerto, '2027-05-10_0030');          // misma fecha -> no pisa
    ok(fs.statSync(path.join(dirUsuario, '2027-05-10_0030.json.gz')).mtimeMs === antes,
        'volver a correr la misma fecha no pisa el archivo que ya estaba');

    console.log('\n[8] Un solo usuario');
    estado.update_seq = '99-zzz';
    out = await correrDumper(salida, puerto, '2027-07-05_0030', { SOLO_USUARIO: 'juanperez' });
    ok(out.includes('Volcando 1 usuario'), 'con --usuario vuelca solo a ese');

    srv.close();
    fs.rmSync(salida, { recursive: true, force: true });
    console.log('\n' + (fallos === 0 ? 'TODO OK (' : fallos + ' FALLA(S) de ') + 'los chequeos del volcado por usuario');
    process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR: ' + (e.stderr || e.message)); process.exit(1); });
