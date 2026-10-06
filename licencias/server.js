// Servicio de licencias de Controlador Ebano (el mouse con la mirada de Ébano Soluciones).
//
// Va APARTE del login del comunicador (couch-auth) a propósito: si algo falla acá, el Grid ni se
// entera (nginx lo busca recién cuando llega un pedido de licencias). Un solo archivo, sin
// dependencias: solo Node 22 (http, crypto y fetch).
//
// Rutas (nginx manda acá /licencias/ y /admin/licencias/):
//   POST /licencias/activar             PÚBLICA, con límite de intentos en nginx. La llama el programa
//                                        una vez por computadora: {codigo, equipo} -> {licencia}.
//   GET  /licencias/estado              PÚBLICA. Para chequear el despliegue: si hay clave y cuál es
//                                        la pública (tiene que ser la que trae el programa).
//   POST /admin/licencias/listar        panel (con la clave de acceso): todas las licencias.
//   POST /admin/licencias/crear         panel: {paciente, nota} -> código de activación nuevo.
//   POST /admin/licencias/sin-internet  panel: {paciente, nota, equipo} -> licencia ya firmada para
//                                        ese equipo (se lleva en un archivo).
//   POST /admin/licencias/pasar         panel: {codigo} -> el código vuelve a servir, en otro equipo.
//   POST /admin/licencias/borrar        panel: {codigo} -> borra un código que nunca se usó.
//
// La licencia es  CE1.<datos>.<firma>  (base64url): los datos son un JSON chico (código, equipo,
// paciente, fecha) y la firma es Ed25519 con LICENCIAS_CLAVE_PRIVADA. El programa la verifica con la
// clave pública, sin internet, cada vez que arranca: no vence y no se puede desactivar a distancia.
// Es el mismo formato que controlador_ebano/licensing/license.py (repo del programa): los tests de
// los dos lados esperan exactamente el mismo texto para los mismos datos.
//
// Registro: base "licencias-controlador" del mismo CouchDB, solo para el admin, un documento por
// código. Entra sola en los backups de cada noche (son del volumen entero de CouchDB).
'use strict';
const http = require('http');
const crypto = require('crypto');

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // sin I, L, O ni U, igual que el programa
const LARGO_CODIGO = 8;
const LARGO_EQUIPO = 12;
const CONTEXTO = Buffer.from('Controlador Ebano licencia 1\n', 'utf8');   // se firma delante de los datos
const BASE = 'licencias-controlador';
const MAX_CUERPO = 16 * 1024;
// La clave Ed25519 viene como la semilla de 32 bytes en hex; Node la necesita envuelta en PKCS#8.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

const SIN_CLAVE = 'El servidor todavía no tiene la clave de licencias (LICENCIAS_CLAVE_PRIVADA en el .env).';
const NO_EXISTE = 'Ese código de activación no existe. Revisalo y probá de nuevo.';

function cargarClave(hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex || '')) return null;
    const privada = crypto.createPrivateKey({
        key: Buffer.concat([PKCS8_ED25519, Buffer.from(hex, 'hex')]), format: 'der', type: 'pkcs8'
    });
    const publica = Buffer.from(crypto.createPublicKey(privada).export({ format: 'jwk' }).x, 'base64url');
    return { privada: privada, publica: publica };
}

// Códigos escritos a mano: sin espacios ni guiones, en mayúsculas, la O como 0 y la I o la L como 1.
function normalizar(texto) {
    return String(texto || '').toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
const esCodigo = (texto, largo) => texto.length === largo && [...texto].every((c) => ALFABETO.includes(c));
const agrupar = (codigo) => (codigo.match(/.{1,4}/g) || []).join('-');
// Texto libre del panel: una sola línea, sin caracteres de control, con un largo máximo.
const limpiar = (texto, largo) => String(texto || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, largo);

function firmar(clave, codigo, equipo, paciente, emitida) {
    const datos = Buffer.from(JSON.stringify({ codigo: codigo, equipo: equipo, paciente: paciente, emitida: emitida }), 'utf8');
    const firma = crypto.sign(null, Buffer.concat([CONTEXTO, datos]), clave.privada);
    return 'CE1.' + datos.toString('base64url') + '.' + firma.toString('base64url');
}

function codigoNuevo() {
    let codigo = '';
    for (let i = 0; i < LARGO_CODIGO; i++) codigo += ALFABETO[crypto.randomInt(ALFABETO.length)];
    return codigo;
}

// Lo que ve el panel de cada licencia (todo menos la revisión interna de CouchDB).
function paraElPanel(doc) {
    return {
        codigo: doc._id, paciente: doc.paciente, nota: doc.nota || '', creada: doc.creada,
        equipo: doc.equipo || null, activada: doc.activada || null, licencia: doc.licencia || null,
        anteriores: doc.anteriores || []
    };
}

function crearServicio(config) {
    const clave = (() => {
        try { return cargarClave(config.clavePrivada); } catch (e) { return null; }
    })();
    const ahora = config.ahora || (() => new Date());
    const couchAuth = 'Basic ' + Buffer.from(config.couchUsuario + ':' + config.couchClave).toString('base64');
    const couchUrl = String(config.couchUrl).replace(/\/$/, '');

    async function couch(metodo, ruta, cuerpo) {
        const r = await fetch(couchUrl + ruta, {
            method: metodo,
            headers: { Authorization: couchAuth, 'Content-Type': 'application/json' },
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
            signal: AbortSignal.timeout(15000)
        });
        const texto = await r.text();
        let json = null;
        try { json = JSON.parse(texto); } catch (e) { /* sin cuerpo JSON */ }
        return { status: r.status, json: json };
    }
    const doc = (codigo) => '/' + BASE + '/' + encodeURIComponent(codigo);

    // La base se crea sola la primera vez, y siempre queda SOLO para el admin de CouchDB (así no
    // se puede leer desde afuera, ni siquiera con una cuenta del comunicador).
    let baseLista = null;
    function asegurarBase() {
        if (!baseLista) {
            baseLista = (async () => {
                const r = await couch('PUT', '/' + BASE);
                if ([201, 202, 412].indexOf(r.status) === -1) throw new Error('no pude crear la base (HTTP ' + r.status + ')');
                const s = await couch('PUT', '/' + BASE + '/_security', {
                    admins: { names: [], roles: ['_admin'] }, members: { names: [], roles: ['_admin'] }
                });
                if (s.status !== 200) throw new Error('no pude proteger la base (HTTP ' + s.status + ')');
            })().catch((e) => { baseLista = null; throw e; });
        }
        return baseLista;
    }

    async function leer(codigo) {
        const r = await couch('GET', doc(codigo));
        if (r.status === 404) return null;
        if (r.status !== 200 || !r.json) throw new Error('lectura HTTP ' + r.status);
        return r.json;
    }

    // Guarda un documento; false si otro pedido lo cambió al mismo tiempo (conflicto de CouchDB).
    async function guardar(documento) {
        const r = await couch('PUT', doc(documento._id), documento);
        if (r.status === 201 || r.status === 202) return true;
        if (r.status === 409) return false;
        throw new Error('escritura HTTP ' + r.status);
    }

    // Crea un documento con un código libre (si justo existe, prueba con otro).
    async function crearConCodigo(armar) {
        for (let intento = 0; intento < 5; intento++) {
            const documento = armar(codigoNuevo());
            if (await guardar(documento)) return documento;
        }
        throw new Error('no encontré un código libre');
    }

    function hoy() {
        // La fecha de Argentina, no la del reloj del server (que va en UTC).
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(ahora());
    }

    const acciones = {
        async activar(b) {
            const codigo = normalizar(b.codigo);
            const equipo = normalizar(b.equipo);
            if (!esCodigo(codigo, LARGO_CODIGO)) return [400, { error: 'El código de activación tiene 8 letras y números, por ejemplo K7QM-2XPA.' }];
            if (!esCodigo(equipo, LARGO_EQUIPO)) return [400, { error: 'El código de esta computadora no es válido.' }];
            if (!clave) return [503, { error: SIN_CLAVE }];
            await asegurarBase();
            for (let intento = 0; intento < 3; intento++) {
                const d = await leer(codigo);
                if (!d) return [404, { error: NO_EXISTE }];
                // La misma computadora otra vez (se reinstaló, se borró el archivo): la misma licencia.
                if (d.equipo === equipo && d.licencia) return [200, { ok: true, licencia: d.licencia }];
                if (d.equipo) {
                    return [409, { error: 'Ese código ya se usó en otra computadora. Si esta la reemplaza, pedile a Ebano Soluciones que pase la licencia a este equipo.' }];
                }
                d.equipo = equipo;
                d.activada = ahora().toISOString();
                d.licencia = firmar(clave, codigo, equipo, d.paciente, hoy());
                if (await guardar(d)) {
                    console.log('licencias: ' + agrupar(codigo) + ' activado en el equipo ' + agrupar(equipo));
                    return [200, { ok: true, licencia: d.licencia }];
                }
            }
            throw new Error('demasiados conflictos al activar');
        },

        async estado() {
            return [200, { ok: true, firma: !!clave, clavePublica: clave ? clave.publica.toString('hex') : null }];
        },

        async listar() {
            await asegurarBase();
            const r = await couch('GET', '/' + BASE + '/_all_docs?include_docs=true');
            if (r.status !== 200 || !r.json) throw new Error('listado HTTP ' + r.status);
            const licencias = (r.json.rows || [])
                .map((fila) => fila.doc)
                .filter((d) => d && String(d._id).indexOf('_design') !== 0)
                .map(paraElPanel)
                .sort((a, b) => (a.creada < b.creada ? 1 : -1));
            return [200, { ok: true, firma: !!clave, licencias: licencias }];
        },

        async crear(b) {
            const paciente = limpiar(b.paciente, 60);
            if (!paciente) return [400, { error: 'Escribí el nombre del paciente.' }];
            if (!clave) return [503, { error: SIN_CLAVE }];
            await asegurarBase();
            const d = await crearConCodigo((codigo) => ({
                _id: codigo, paciente: paciente, nota: limpiar(b.nota, 100), creada: ahora().toISOString(),
                equipo: null, activada: null, licencia: null, anteriores: []
            }));
            console.log('licencias: código ' + agrupar(d._id) + ' creado');
            return [200, { ok: true, licencia: paraElPanel(d) }];
        },

        async 'sin-internet'(b) {
            const paciente = limpiar(b.paciente, 60);
            const equipo = normalizar(b.equipo);
            if (!paciente) return [400, { error: 'Escribí el nombre del paciente.' }];
            if (!esCodigo(equipo, LARGO_EQUIPO)) return [400, { error: 'El código del equipo tiene 12 letras y números, como lo muestra el programa (por ejemplo 7KQ2-M9XD-P4TA).' }];
            if (!clave) return [503, { error: SIN_CLAVE }];
            await asegurarBase();
            const d = await crearConCodigo((codigo) => ({
                _id: codigo, paciente: paciente, nota: limpiar(b.nota, 100), creada: ahora().toISOString(),
                equipo: equipo, activada: ahora().toISOString(), licencia: firmar(clave, codigo, equipo, paciente, hoy()),
                anteriores: [], sinInternet: true
            }));
            console.log('licencias: ' + agrupar(d._id) + ' hecha sin internet para el equipo ' + agrupar(equipo));
            return [200, { ok: true, licencia: paraElPanel(d) }];
        },

        async pasar(b) {
            const codigo = normalizar(b.codigo);
            if (!esCodigo(codigo, LARGO_CODIGO)) return [400, { error: 'Código inválido.' }];
            await asegurarBase();
            for (let intento = 0; intento < 3; intento++) {
                const d = await leer(codigo);
                if (!d) return [404, { error: NO_EXISTE }];
                if (!d.equipo) return [409, { error: 'Ese código todavía no se usó: ya sirve en cualquier computadora.' }];
                d.anteriores = (d.anteriores || []).concat([{ equipo: d.equipo, activada: d.activada, pasada: ahora().toISOString() }]);
                d.equipo = null;
                d.activada = null;
                d.licencia = null;
                if (await guardar(d)) {
                    console.log('licencias: ' + agrupar(codigo) + ' liberado para otro equipo');
                    return [200, { ok: true, licencia: paraElPanel(d) }];
                }
            }
            throw new Error('demasiados conflictos al pasar');
        },

        async borrar(b) {
            const codigo = normalizar(b.codigo);
            if (!esCodigo(codigo, LARGO_CODIGO)) return [400, { error: 'Código inválido.' }];
            await asegurarBase();
            const d = await leer(codigo);
            if (!d) return [404, { error: NO_EXISTE }];
            if (d.equipo || (d.anteriores || []).length) {
                return [409, { error: 'Solo se borran los códigos que nunca se usaron: los usados quedan como registro.' }];
            }
            const r = await couch('DELETE', doc(codigo) + '?rev=' + encodeURIComponent(d._rev));
            if (r.status !== 200 && r.status !== 202) {
                return [409, { error: 'Ese código cambió recién. Recargá la lista y probá de nuevo.' }];
            }
            console.log('licencias: código ' + agrupar(codigo) + ' borrado');
            return [200, { ok: true }];
        }
    };

    const RUTAS = {
        'POST /licencias/activar': { publica: true, accion: 'activar' },
        'GET /licencias/estado': { publica: true, accion: 'estado' },
        'POST /admin/licencias/listar': { accion: 'listar' },
        'POST /admin/licencias/crear': { accion: 'crear' },
        'POST /admin/licencias/sin-internet': { accion: 'sin-internet' },
        'POST /admin/licencias/pasar': { accion: 'pasar' },
        'POST /admin/licencias/borrar': { accion: 'borrar' }
    };

    // La clave del panel se compara en tiempo constante (sobre sus hashes, que miden lo mismo).
    function claveDelPanelOk(b) {
        const esperada = String(config.claveAdmin || '');
        if (!esperada) return false;
        const dada = typeof b.accessPassword === 'string' ? b.accessPassword : '';
        const hash = (t) => crypto.createHash('sha256').update(t, 'utf8').digest();
        return crypto.timingSafeEqual(hash(esperada), hash(dada));
    }

    function leerCuerpo(req) {
        return new Promise((resolve, reject) => {
            const partes = [];
            let largo = 0;
            req.on('data', (parte) => {
                largo += parte.length;
                if (largo <= MAX_CUERPO) partes.push(parte);
            });
            req.on('end', () => {
                if (largo > MAX_CUERPO) return reject(Object.assign(new Error('Pedido demasiado grande.'), { status: 413 }));
                const texto = Buffer.concat(partes).toString('utf8').trim();
                try {
                    const valor = texto ? JSON.parse(texto) : {};
                    resolve(valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {});
                } catch (e) {
                    reject(Object.assign(new Error('El pedido no es JSON.'), { status: 400 }));
                }
            });
            req.on('error', reject);
        });
    }

    const servidor = http.createServer(async (req, res) => {
        const responder = (status, objeto) => {
            res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(objeto));
        };
        try {
            const ruta = RUTAS[req.method + ' ' + String(req.url).split('?')[0]];
            if (!ruta) {
                req.resume();
                return responder(404, { error: 'No existe.' });
            }
            const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : {};
            if (!ruta.publica && !claveDelPanelOk(cuerpo)) return responder(403, { error: 'Clave de acceso incorrecta' });
            const [status, objeto] = await acciones[ruta.accion](cuerpo);
            responder(status, objeto);
        } catch (e) {
            if (e && e.status) return responder(e.status, { error: e.message });
            console.error('licencias: ' + (e && e.message));
            responder(500, { error: 'Algo salió mal en el servidor de licencias. Probá de nuevo en un rato.' });
        }
    });
    servidor.clavePublica = clave ? clave.publica.toString('hex') : null;
    return servidor;
}

module.exports = { crearServicio, firmar, cargarClave, normalizar, esCodigo, agrupar };

if (require.main === module) {
    const servidor = crearServicio({
        couchUrl: process.env.COUCHDB_URL || 'http://couchdb:5984',
        couchUsuario: process.env.COUCHDB_USER || 'admin',
        couchClave: process.env.COUCHDB_PASSWORD || '',
        claveAdmin: process.env.ADMIN_UI_PASSWORD || '',
        clavePrivada: process.env.LICENCIAS_CLAVE_PRIVADA || ''
    });
    const puerto = Number(process.env.PUERTO || 3100);
    servidor.listen(puerto, () => {
        console.log('licencias: escuchando en el puerto ' + puerto + ' · ' + (servidor.clavePublica
            ? 'clave pública ' + servidor.clavePublica
            : 'SIN CLAVE: no se pueden activar licencias (falta LICENCIAS_CLAVE_PRIVADA en el .env)'));
    });
    // `docker compose stop` manda SIGTERM: cerrar enseguida en vez de esperar los 10 s del kill.
    process.on('SIGTERM', () => servidor.close(() => process.exit(0)));
    process.on('unhandledRejection', (e) => console.error('licencias (sin manejar): ' + (e && e.message)));
}
