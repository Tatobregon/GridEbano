/**
 * Volcado por usuario: guarda los documentos de cada usuario TAL CUAL están en CouchDB (cifrados)
 * en un archivo por fecha, para poder recuperar "el comunicador de hace N días" desde el panel de
 * admin sin tener que levantar un CouchDB con un backup entero.
 *
 * NO descifra nada: copia bloques cifrados. El .tgz de backup.sh sigue siendo la red para desastres;
 * esto es la red para "un usuario se mandó un moco".
 *
 * Corre dentro de un contenedor descartable (ver scripts/dump-usuarios.sh), no en couch-auth: el
 * contenedor que mira a internet monta esta carpeta SOLO LECTURA.
 *
 * Variables de entorno:
 *   COUCHDB_URL     http://couchdb:5984                    (obligatoria)
 *   COUCHDB_USER    usuario admin de CouchDB                (default: admin)
 *   COUCHDB_PASSWORD clave de ese admin                     (obligatoria)
 *   SALIDA          carpeta donde escribir                 (obligatoria)
 *   FECHA           sello de tiempo YYYY-MM-DD_HHMM        (obligatoria; la pone el .sh con la hora local)
 *   RETENCION_DIAS  días de historial a conservar          (default 30; se cuentan desde el
 *                   volcado más nuevo de cada usuario, no desde hoy)
 *   FORZAR          1 = volcar aunque el usuario no haya cambiado
 *   SOLO_USUARIO    volcar solo a ese usuario (opcional)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const COUCHDB_URL = (process.env.COUCHDB_URL || '').replace(/\/$/, '');
// Credenciales por cabecera y no dentro de la URL: así una clave con caracteres raros (@, :, /)
// no rompe nada y no queda escrita en mensajes de error.
const COUCHDB_AUTH = 'Basic ' + Buffer.from(
    (process.env.COUCHDB_USER || 'admin') + ':' + (process.env.COUCHDB_PASSWORD || '')
).toString('base64');
const SALIDA = process.env.SALIDA || '';
const FECHA = process.env.FECHA || '';
const RETENCION_DIAS = parseInt(process.env.RETENCION_DIAS || '30', 10);
const FORZAR = process.env.FORZAR === '1';
const SOLO_USUARIO = process.env.SOLO_USUARIO || '';

const MODELOS_GRD = ['GridData', 'MetaData', 'Dictionary'];
const USUARIO_OK = /^[a-z0-9][a-z0-9_-]{2,15}$/;
const FECHA_OK = /^\d{4}-\d{2}-\d{2}_\d{4}$/;

if (!COUCHDB_URL || !SALIDA || !FECHA || !process.env.COUCHDB_PASSWORD) {
    console.error('ERROR: faltan COUCHDB_URL, COUCHDB_PASSWORD, SALIDA o FECHA.');
    process.exit(1);
}
if (!FECHA_OK.test(FECHA)) {
    console.error('ERROR: FECHA tiene que ser YYYY-MM-DD_HHMM (vino "' + FECHA + '").');
    process.exit(1);
}

async function couch(ruta) {
    const r = await fetch(COUCHDB_URL + ruta, { headers: { Authorization: COUCHDB_AUTH } });
    if (!r.ok) throw new Error('CouchDB ' + r.status + ' en ' + ruta.split('?')[0]);
    return r.json();
}

// Usuarios con su base personal, leídos de auth-users (igual que el panel de admin).
async function listarUsuarios() {
    const data = await couch('/auth-users/_all_docs?include_docs=true');
    return (data.rows || [])
        .map((row) => row.doc)
        .filter((doc) => doc && doc.key && String(doc._id).indexOf('_design') !== 0)
        .map((doc) => ({
            usuario: String(doc.key),
            base: Object.keys(doc.personalDBs || {}).filter((n) => n.indexOf('asterics-grid-data') === 0)[0] || null
        }))
        .filter((u) => !!u.base && USUARIO_OK.test(u.usuario.toLowerCase()))
        .sort((a, b) => a.usuario.localeCompare(b.usuario));
}

function carpetaDe(usuario) { return path.join(SALIDA, usuario.toLowerCase()); }

// Lee los .meta.json de un usuario, del más nuevo al más viejo.
function puntosDe(usuario) {
    const dir = carpetaDe(usuario);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => {
            try {
                const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                meta.punto = f.replace('.meta.json', '');
                return meta;
            } catch (e) { return null; }
        })
        .filter((m) => !!m && FECHA_OK.test(m.punto))
        .sort((a, b) => (a.punto < b.punto ? 1 : -1));
}

async function volcar(u) {
    // ¿Cambió algo desde el último volcado? update_seq de CouchDB sube con cada escritura.
    const info = await couch('/' + encodeURIComponent(u.base));
    const seq = String(info.update_seq || '');
    // Se compara contra el volcado ANTERIOR MÁS CERCANO (no contra el más nuevo de todos): así
    // también funciona cuando se rellena el historial hacia atrás desde los .tgz viejos.
    const previos = puntosDe(u.usuario).filter((p) => p.punto <= FECHA);
    if (!FORZAR && previos.length && previos[0].update_seq === seq) {
        console.log('  = ' + u.usuario + ': sin cambios desde ' + previos[0].punto + ', no vuelco');
        return { saltado: true };
    }
    if (fs.existsSync(path.join(carpetaDe(u.usuario), FECHA + '.json.gz')) && !FORZAR) {
        console.log('  = ' + u.usuario + ': ya existe el volcado de ' + FECHA + ', no lo piso');
        return { saltado: true };
    }

    const data = await couch('/' + encodeURIComponent(u.base) + '/_all_docs?include_docs=true');
    const documentos = [];
    for (const row of (data.rows || [])) {
        const d = row.doc;
        if (!d || String(d._id).indexOf('_design') === 0) continue;
        if (MODELOS_GRD.indexOf(d.modelName) === -1 || !d.encryptedDataBase64) continue;
        documentos.push({
            _id: d._id,
            modelName: d.modelName,
            modelVersion: d.modelVersion,
            encryptedDataBase64: d.encryptedDataBase64
        });
    }
    if (!documentos.length) {
        console.log('  - ' + u.usuario + ': todavía no tiene tableros, no vuelco');
        return { saltado: true };
    }

    const dir = carpetaDe(u.usuario);
    fs.mkdirSync(dir, { recursive: true });
    const contenido = {
        formato: 1,
        usuario: u.usuario,
        base: u.base,
        fecha: FECHA,
        update_seq: seq,
        documentos: documentos
    };
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(contenido), 'utf8'), { level: 6 });
    // Primero a un archivo temporal y después rename: así nunca queda un .json.gz a medio escribir
    // que el panel pueda leer (rename es atómico dentro del mismo sistema de archivos).
    const destino = path.join(dir, FECHA + '.json.gz');
    const temporal = destino + '.parcial';
    fs.writeFileSync(temporal, gz);
    fs.renameSync(temporal, destino);

    const tableros = documentos.filter((d) => d.modelName === 'GridData').length;
    fs.writeFileSync(path.join(dir, FECHA + '.meta.json'), JSON.stringify({
        fecha: FECHA, update_seq: seq, documentos: documentos.length, tableros: tableros, bytes: gz.length
    }));
    console.log('  + ' + u.usuario + ': ' + tableros + ' tableros, ' + (gz.length / 1048576).toFixed(1) + ' MB -> ' + FECHA);
    return { saltado: false, bytes: gz.length };
}

// "2026-09-24_0030" -> Date. Se usa para la retención.
function fechaDe(punto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/.exec(punto);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

// Limpieza. Dos reglas:
//   1) NUNCA se borra el volcado más nuevo de un usuario. Alguien que no toca su comunicador en
//      meses tiene uno solo: si lo borráramos por viejo, se quedaría sin red.
//   2) La antigüedad se mide por la FECHA DEL VOLCADO (no por la fecha del archivo) y contra el
//      volcado más nuevo que tenga ese usuario. Así rescatar historial viejo desde los .tgz no
//      dispara borrados raros, y copiar la carpeta a otro lado no cambia lo que se conserva.
function limpiar(usuario) {
    const dir = carpetaDe(usuario);
    const puntos = puntosDe(usuario);
    if (puntos.length < 2) return;
    const masNuevo = fechaDe(puntos[0].punto);
    if (!masNuevo) return;
    const corte = masNuevo.getTime() - RETENCION_DIAS * 86400000;
    let borrados = 0;
    puntos.slice(1).forEach((p) => {
        const f = fechaDe(p.punto);
        if (!f || f.getTime() >= corte) return;
        try { fs.unlinkSync(path.join(dir, p.punto + '.json.gz')); } catch (e) {}
        try { fs.unlinkSync(path.join(dir, p.punto + '.meta.json')); } catch (e) {}
        borrados++;
    });
    if (borrados) console.log('  . ' + usuario + ': ' + borrados + ' volcado(s) viejo(s) borrado(s)');
}

(async () => {
    fs.mkdirSync(SALIDA, { recursive: true });
    let usuarios = await listarUsuarios();
    if (SOLO_USUARIO) usuarios = usuarios.filter((u) => u.usuario.toLowerCase() === SOLO_USUARIO.toLowerCase());
    if (!usuarios.length) {
        console.log('No hay usuarios con base de datos para volcar.');
        return;
    }
    console.log('Volcando ' + usuarios.length + ' usuario(s), sello ' + FECHA + ':');
    let nuevos = 0, bytes = 0, errores = 0;
    for (const u of usuarios) {
        try {
            const r = await volcar(u);
            if (!r.saltado) { nuevos++; bytes += r.bytes; }
            limpiar(u.usuario);
        } catch (e) {
            errores++;
            console.error('  ! ' + u.usuario + ': ' + e.message);
        }
    }
    console.log('Volcado OK: ' + nuevos + ' nuevo(s) (' + (bytes / 1048576).toFixed(1) + ' MB), '
        + (usuarios.length - nuevos - errores) + ' sin cambios, ' + errores + ' con error.');
    if (errores) process.exit(1);
})().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
