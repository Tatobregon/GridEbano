/**
 * Test del servicio de licencias de Controlador Ebano (licencias/server.js).
 *
 * QUÉ PRUEBA: el flujo completo (crear código → activar → misma PC otra vez → otra PC → pasar a otro
 * equipo → borrar, y la licencia sin internet) contra un CouchDB SIMULADO (un servidor HTTP mínimo
 * acá mismo), así no necesita el stack levantado.
 *
 * Los puntos finos que cubre:
 *   - la licencia es EXACTAMENTE la que espera el programa (mismo texto que tests/test_license.py
 *     del repo del programa, con la clave de prueba pública del RFC 8032);
 *   - un código sirve para UNA computadora, también con dos activaciones al mismo tiempo;
 *   - sin la clave del panel no se lista ni se crea nada;
 *   - sin LICENCIAS_CLAVE_PRIVADA el servicio levanta igual, pero no promete licencias;
 *   - la base queda solo para el admin de CouchDB y la clave privada no aparece en ninguna respuesta.
 *
 * USO: node scripts/test-licencias.js        (Node 22; sin npm install)
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { crearServicio } = require(path.join(__dirname, '..', 'licencias', 'server.js'));

// Clave de PRUEBA: la del ejemplo 1 del RFC 8032 (pública en el estándar). Nunca la de Ebano.
const CLAVE_PRUEBA = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const PUBLICA_PRUEBA = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const CLAVE_ADMIN = 'claveDeAdminDePrueba';
const CLAVE_COUCH = 'claveDeCouchDePrueba';
// La misma constante que tests/test_license.py (repo del programa): los dos lados firman igual.
const LICENCIA_ESPERADA = 'CE1.eyJjb2RpZ28iOiJLN1FNMlhQQSIsImVxdWlwbyI6IjdLUTJNOVhEUDRUQSIsInBhY2llbnRlIjoiSnVhbiBQw6lyZXoiLCJl'
    + 'bWl0aWRhIjoiMjAyNi0xMC0wNiJ9.j3iQHvW5x4YEFL1W8vn06mUwPnQSt_MLAiY8BQyQfrbGeUjE21Pg054C0rSmCGiRMJHDou3s'
    + 'Gc7pQc2tFDuFBw';
const PC1 = '7KQ2M9XDP4TA';
const PC2 = 'AAAAAAAAAAAA';

let fallos = 0;
const ok = (cond, texto) => {
    console.log((cond ? '  OK   ' : '  FALLA') + '  ' + texto);
    if (!cond) fallos++;
};

// ── CouchDB simulado (en memoria, con revisiones y conflictos como el de verdad) ─────────────────
function levantarCouchFalso() {
    const docs = new Map();
    const estado = { base: false, seguridad: null, pedidos: [] };
    let rev = 0;
    const srv = http.createServer((req, res) => {
        let cuerpo = '';
        req.on('data', (p) => { cuerpo += p; });
        req.on('end', async () => {
            const responder = (codigo, obj) => { res.writeHead(codigo, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
            estado.pedidos.push(req.method + ' ' + req.url);
            if (req.headers.authorization !== 'Basic ' + Buffer.from('admin:' + CLAVE_COUCH).toString('base64')) {
                return responder(401, { error: 'unauthorized' });
            }
            const [ruta, query] = req.url.split('?');
            const partes = ruta.split('/').filter(Boolean).map(decodeURIComponent);
            if (partes[0] !== 'licencias-controlador') return responder(404, { error: 'not_found' });
            if (partes.length === 1 && req.method === 'PUT') {
                if (estado.base) return responder(412, { error: 'file_exists' });
                estado.base = true;
                return responder(201, { ok: true });
            }
            if (!estado.base) return responder(404, { error: 'not_found', reason: 'Database does not exist.' });
            if (partes[1] === '_security' && req.method === 'PUT') {
                estado.seguridad = JSON.parse(cuerpo);
                return responder(200, { ok: true });
            }
            if (partes[1] === '_all_docs') {
                return responder(200, { rows: [...docs.values()].map((d) => ({ id: d._id, doc: d })) });
            }
            const id = partes[1];
            const actual = docs.get(id);
            if (req.method === 'GET') {
                await new Promise((r) => setTimeout(r, 20));   // lento a propósito: deja cruzarse los pedidos
                return actual ? responder(200, actual) : responder(404, { error: 'not_found' });
            }
            if (req.method === 'PUT') {
                const nuevo = JSON.parse(cuerpo);
                if ((actual && nuevo._rev !== actual._rev) || (!actual && nuevo._rev)) return responder(409, { error: 'conflict' });
                nuevo._rev = (++rev) + '-x';
                docs.set(id, nuevo);
                return responder(201, { ok: true, id: id, rev: nuevo._rev });
            }
            if (req.method === 'DELETE') {
                const revPedida = new URLSearchParams(query).get('rev');
                if (!actual) return responder(404, { error: 'not_found' });
                if (revPedida !== actual._rev) return responder(409, { error: 'conflict' });
                docs.delete(id);
                return responder(200, { ok: true });
            }
            responder(405, { error: 'method_not_allowed' });
        });
    });
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, docs, estado })));
}

function levantarServicio(puertoCouch, opciones) {
    const servicio = crearServicio(Object.assign({
        couchUrl: 'http://127.0.0.1:' + puertoCouch, couchUsuario: 'admin', couchClave: CLAVE_COUCH,
        claveAdmin: CLAVE_ADMIN, clavePrivada: CLAVE_PRUEBA,
        ahora: () => new Date('2026-10-06T15:00:00Z')
    }, opciones || {}));
    return new Promise((resolve) => servicio.listen(0, '127.0.0.1', () => resolve(servicio)));
}

async function pedir(servicio, metodo, ruta, cuerpo, crudo) {
    const r = await fetch('http://127.0.0.1:' + servicio.address().port + ruta, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: crudo !== undefined ? crudo : (cuerpo === undefined ? undefined : JSON.stringify(cuerpo))
    });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (e) { /* nada */ }
    return { codigo: r.status, json: json || {}, texto: texto, cache: r.headers.get('cache-control') };
}
const panel = (servicio, accion, datos) => pedir(servicio, 'POST', '/admin/licencias/' + accion, Object.assign({ accessPassword: CLAVE_ADMIN }, datos || {}));
const activar = (servicio, codigo, equipo) => pedir(servicio, 'POST', '/licencias/activar', { codigo: codigo, equipo: equipo });

function leerLicencia(texto) {
    const [prefijo, datos, firma] = String(texto).split('.');
    const llave = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(PUBLICA_PRUEBA, 'hex').toString('base64url') }, format: 'jwk' });
    const mensaje = Buffer.concat([Buffer.from('Controlador Ebano licencia 1\n'), Buffer.from(datos, 'base64url')]);
    return {
        prefijo: prefijo,
        firmaOk: crypto.verify(null, mensaje, llave, Buffer.from(firma, 'base64url')),
        campos: JSON.parse(Buffer.from(datos, 'base64url').toString('utf8'))
    };
}
// Un código que lleve al menos un 0 y un 1, para probar que la O y la L escritas a mano se entienden.
const escritoAMano = (codigo) => codigo.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l').replace(/(.{4})/, '$1-');

(async () => {
    const couch = await levantarCouchFalso();
    const puertoCouch = couch.srv.address().port;
    const servicio = await levantarServicio(puertoCouch);
    const { firmar, cargarClave } = require(path.join(__dirname, '..', 'licencias', 'server.js'));

    console.log('[1] Mismo formato que el programa');
    ok(firmar(cargarClave(CLAVE_PRUEBA), 'K7QM2XPA', PC1, 'Juan Pérez', '2026-10-06') === LICENCIA_ESPERADA,
        'para los mismos datos, el mismo texto que tests/test_license.py');
    let r = await pedir(servicio, 'GET', '/licencias/estado');
    ok(r.codigo === 200 && r.json.firma === true && r.json.clavePublica === PUBLICA_PRUEBA,
        'estado: con clave, y la pública que corresponde (' + String(r.json.clavePublica).slice(0, 12) + '…)');

    console.log('\n[2] Sin la clave del panel no se hace nada');
    for (const accion of ['listar', 'crear', 'sin-internet', 'pasar', 'borrar']) {
        r = await pedir(servicio, 'POST', '/admin/licencias/' + accion, { accessPassword: 'equivocada', paciente: 'X' });
        ok(r.codigo === 403, accion + ' con clave mal -> 403 (dio ' + r.codigo + ')');
    }
    r = await pedir(servicio, 'POST', '/admin/licencias/listar', {});
    ok(r.codigo === 403, 'sin clave -> 403');

    console.log('\n[3] Crear un código de activación');
    r = await panel(servicio, 'crear', { paciente: '   ' });
    ok(r.codigo === 400, 'sin paciente -> 400');
    r = await panel(servicio, 'crear', { paciente: '  Juan   Pérez\n', nota: 'PC de la casa' });
    const lic = r.json.licencia || {};
    ok(r.codigo === 200 && /^[0-9A-HJKMNP-TV-Z]{8}$/.test(lic.codigo || ''), 'crea un código de 8 (' + lic.codigo + ')');
    ok(lic.paciente === 'Juan Pérez' && lic.nota === 'PC de la casa' && lic.equipo === null, 'guarda paciente y nota, todavía sin equipo');
    ok(couch.estado.seguridad && JSON.stringify(couch.estado.seguridad.members) === JSON.stringify({ names: [], roles: ['_admin'] }),
        'la base quedó solo para el admin de CouchDB');
    r = await panel(servicio, 'listar');
    ok(r.codigo === 200 && r.json.licencias.length === 1 && r.json.licencias[0].codigo === lic.codigo, 'aparece en la lista');
    ok(r.cache === 'no-store', 'manda Cache-Control: no-store');

    console.log('\n[4] Activar');
    r = await activar(servicio, 'K7QM-2XP', PC1);
    ok(r.codigo === 400, 'código cortado -> 400');
    r = await activar(servicio, lic.codigo, 'ABC');
    ok(r.codigo === 400, 'código de equipo inválido -> 400');
    r = await activar(servicio, 'ZZZZZZZZ', PC1);
    ok(r.codigo === 404 && /no existe/.test(r.json.error), 'código que no existe -> 404 con el motivo');
    r = await activar(servicio, escritoAMano(lic.codigo), PC1.toLowerCase());
    ok(r.codigo === 200 && typeof r.json.licencia === 'string', 'activa (escrito a mano: "' + escritoAMano(lic.codigo) + '")');
    const primera = r.json.licencia;
    const leida = leerLicencia(primera);
    ok(leida.prefijo === 'CE1' && leida.firmaOk, 'la licencia tiene la firma correcta');
    ok(leida.campos.codigo === lic.codigo && leida.campos.equipo === PC1 && leida.campos.paciente === 'Juan Pérez'
        && leida.campos.emitida === '2026-10-06', 'y dice código, equipo, paciente y fecha: ' + JSON.stringify(leida.campos));

    console.log('\n[5] Un código, una computadora');
    r = await activar(servicio, lic.codigo, PC1);
    ok(r.codigo === 200 && r.json.licencia === primera, 'la misma computadora otra vez -> la misma licencia');
    r = await activar(servicio, lic.codigo, PC2);
    ok(r.codigo === 409 && /otra computadora/.test(r.json.error), 'otra computadora -> 409 "ya se usó"');

    console.log('\n[6] Dos computadoras al mismo tiempo con un código nuevo');
    const otro = (await panel(servicio, 'crear', { paciente: 'Ana' })).json.licencia.codigo;
    const [a, b] = await Promise.all([activar(servicio, otro, PC1), activar(servicio, otro, PC2)]);
    ok([a.codigo, b.codigo].sort().join(',') === '200,409', 'una activa y la otra recibe "ya se usó" (' + a.codigo + ', ' + b.codigo + ')');

    console.log('\n[7] Pasar a otro equipo');
    r = await panel(servicio, 'pasar', { codigo: lic.codigo });
    ok(r.codigo === 200 && r.json.licencia.equipo === null && r.json.licencia.anteriores.length === 1
        && r.json.licencia.anteriores[0].equipo === PC1, 'queda libre y recuerda el equipo anterior');
    r = await activar(servicio, lic.codigo, PC2);
    ok(r.codigo === 200 && leerLicencia(r.json.licencia).campos.equipo === PC2, 'ahora activa en la computadora nueva');
    ok(leerLicencia(primera).firmaOk, 'la licencia de la computadora vieja sigue valiendo (nunca se desactiva a distancia)');
    const pendiente = (await panel(servicio, 'crear', { paciente: 'Sin usar' })).json.licencia.codigo;
    r = await panel(servicio, 'pasar', { codigo: pendiente });
    ok(r.codigo === 409, 'pasar un código que nunca se usó -> 409');

    console.log('\n[8] Borrar');
    r = await panel(servicio, 'borrar', { codigo: lic.codigo });
    ok(r.codigo === 409, 'uno usado no se borra (queda como registro)');
    r = await panel(servicio, 'borrar', { codigo: pendiente });
    ok(r.codigo === 200, 'uno que nunca se usó, sí');
    r = await activar(servicio, pendiente, PC1);
    ok(r.codigo === 404, 'y después ya no existe');

    console.log('\n[9] Licencia sin internet');
    r = await panel(servicio, 'sin-internet', { paciente: 'Escuela', equipo: 'nada' });
    ok(r.codigo === 400, 'código de equipo inválido -> 400');
    r = await panel(servicio, 'sin-internet', { paciente: 'Escuela', nota: 'aula 2', equipo: '7kq2-m9xd-p4ta' });
    const sinInternet = r.json.licencia || {};
    ok(r.codigo === 200 && sinInternet.equipo === PC1 && leerLicencia(sinInternet.licencia).firmaOk,
        'firma una licencia para ese equipo, lista para el archivo');
    r = await activar(servicio, sinInternet.codigo, PC2);
    ok(r.codigo === 409, 'su código no sirve en otra computadora');
    r = await panel(servicio, 'listar');
    ok(r.json.licencias.length === 3, 'la lista tiene las 3 que quedaron (' + r.json.licencias.length + ')');

    console.log('\n[10] Pedidos raros');
    r = await pedir(servicio, 'POST', '/licencias/activar', undefined, '{esto no es json');
    ok(r.codigo === 400, 'cuerpo que no es JSON -> 400');
    r = await pedir(servicio, 'POST', '/licencias/activar', undefined, JSON.stringify({ codigo: 'x'.repeat(40000) }));
    ok(r.codigo === 413, 'cuerpo enorme -> 413');
    r = await pedir(servicio, 'GET', '/licencias/activar');
    ok(r.codigo === 404, 'GET donde va POST -> 404');
    r = await pedir(servicio, 'POST', '/admin/licencias/../licencias/estado', {});
    ok(r.codigo === 404, 'rutas con ../ -> 404');
    r = await pedir(servicio, 'POST', '/licencias/activar', [1, 2]);
    ok(r.codigo === 400, 'un JSON que no es un objeto -> 400 (datos faltantes)');

    console.log('\n[11] La fecha es la de Argentina');
    const deNoche = await levantarServicio(puertoCouch, { ahora: () => new Date('2026-10-07T02:30:00Z') });   // 23:30 del 6
    const deNocheCodigo = (await panel(deNoche, 'crear', { paciente: 'Noche' })).json.licencia.codigo;
    r = await activar(deNoche, deNocheCodigo, PC1);
    ok(leerLicencia(r.json.licencia).campos.emitida === '2026-10-06', 'a las 23:30 del 6/10 en Argentina dice 2026-10-06');
    deNoche.close();

    console.log('\n[12] Sin LICENCIAS_CLAVE_PRIVADA');
    const sinClave = await levantarServicio(puertoCouch, { clavePrivada: '' });
    r = await pedir(sinClave, 'GET', '/licencias/estado');
    ok(r.codigo === 200 && r.json.firma === false && r.json.clavePublica === null, 'estado dice que no hay clave');
    r = await panel(sinClave, 'crear', { paciente: 'X' });
    ok(r.codigo === 503 && /LICENCIAS_CLAVE_PRIVADA/.test(r.json.error), 'crear -> 503 con el motivo (no promete lo que no puede)');
    r = await activar(sinClave, sinInternet.codigo, PC1);
    ok(r.codigo === 503, 'activar -> 503');
    r = await panel(sinClave, 'listar');
    ok(r.codigo === 200 && r.json.firma === false, 'listar sigue andando y avisa');
    sinClave.close();
    const malConfigurada = await levantarServicio(puertoCouch, { clavePrivada: 'no-es-hex' });
    r = await pedir(malConfigurada, 'GET', '/licencias/estado');
    ok(r.codigo === 200 && r.json.firma === false, 'una clave mal escrita no tira el servicio');
    malConfigurada.close();

    console.log('\n[13] La clave privada no sale nunca');
    r = await panel(servicio, 'listar');
    ok(r.texto.indexOf(CLAVE_PRUEBA) === -1, 'no aparece en la lista');
    ok(couch.estado.pedidos.every((p) => p.indexOf(CLAVE_PRUEBA) === -1), 'ni en lo que se le pide a CouchDB');

    servicio.close();
    couch.srv.close();
    console.log('\n' + (fallos === 0 ? 'TODO OK: ' : fallos + ' FALLA(S) en ') + 'los chequeos del servicio de licencias');
    process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR: ' + (e && e.stack || e)); process.exit(1); });
