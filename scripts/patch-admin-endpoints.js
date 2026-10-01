// Patch de build para couch-auth: agrega los endpoints de la página de admin para crear usuarios.
//   POST /admin/verificar     -> valida la clave de acceso (ADMIN_UI_PASSWORD). Para el "gate".
//   POST /admin/crear-usuario -> valida la clave y crea el usuario reenviando a /auth/register
//                                CON el X-Register-Secret agregado ACÁ (server-side). El secreto
//                                real NUNCA llega al navegador; el browser solo manda la clave de acceso.
//   POST /admin/listar-usuarios -> nombres de los usuarios existentes (para el desplegable del panel).
//   POST /admin/datos-usuario   -> documentos de un usuario TAL CUAL están guardados: CIFRADOS.
//
// POR QUÉ /admin/datos-usuario NO DESCIFRA NADA: los datos del usuario están cifrados con una clave
// derivada de SU contraseña (ver nota de abajo). El servidor no la tiene y no la quiere: manda los
// bloques cifrados al navegador del admin, que los abre ahí con la contraseña que el admin escribe.
// Así la contraseña del usuario nunca viaja al servidor, no queda en ningún log, y el archivo .grd
// descifrado no existe nunca en el disco del server. Si este endpoint se filtrara, lo que se escapa
// es texto cifrado.
const fs = require('fs');
const file = 'superlogin/start.js';
let s = fs.readFileSync(file, 'utf8');

// NOTA CLAVE (bug de login resuelto 2026-08-11): la app del Grid NO manda la contraseña en texto
// plano. En loginService.loginPlainPassword hashea la clave con
//   encryptionService.getUserPasswordHash(pw) = sha256_hex('STATIC_USER_PW_SALT' + pw)
// (ver src/js/service/data/encryptionService.js) y manda ESE hash tanto al registrar como al
// loguear. Por eso, al crear un usuario desde el admin hay que guardar el MISMO hash; si guardáramos
// la clave plana, el login de la app (que manda el hash) nunca matchea -> "usuario o contraseña
// incorrectos". El salt 'STATIC_USER_PW_SALT' es la string literal (constante del upstream).

const anchor = "app.use('/api/infotree', infoTreeAPI.getRouter(config.dbServer.protocol, config.dbServer.host));";
if (!s.includes(anchor)) {
    console.error('patch-admin-endpoints: ANCHOR no encontrado en start.js. Abortando build.');
    process.exit(1);
}
if (s.includes('/admin/crear-usuario') && s.includes('/admin/datos-usuario')) {
    console.log('patch-admin-endpoints: ya aplicado, salteando.');
    process.exit(0);
}

const block = `
app.post('/admin/verificar', (req, res) => {
    const ok = !!process.env.ADMIN_UI_PASSWORD && req.body && req.body.accessPassword === process.env.ADMIN_UI_PASSWORD;
    res.status(ok ? 200 : 403).json({ ok: ok });
});
app.post('/admin/crear-usuario', async (req, res) => {
    const b = req.body || {};
    if (!process.env.ADMIN_UI_PASSWORD || b.accessPassword !== process.env.ADMIN_UI_PASSWORD) {
        return res.status(403).json({ error: 'Clave de acceso incorrecta' });
    }
    if (!b.username || !b.password) {
        return res.status(400).json({ error: 'Faltan usuario o contraseña' });
    }
    if (String(b.password).length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    // Hasheamos la clave IGUAL que la app (sha256 de 'STATIC_USER_PW_SALT' + clave) y guardamos ESE
    // hash. Así el login de la app (que manda el mismo hash) matchea. Ver nota al inicio del archivo.
    const require_crypto = require('crypto');
    const hashedPw = require_crypto.createHash('sha256').update('STATIC_USER_PW_SALT' + String(b.password), 'utf8').digest('hex');
    try {
        const r = await fetch('http://127.0.0.1:3000/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Register-Secret': process.env.REGISTER_SECRET },
            body: JSON.stringify({ username: b.username, email: (b.email || (b.username + '@local.invalid')), password: hashedPw, confirmPassword: hashedPw })
        });
        const text = await r.text();
        return res.status(r.status).type('application/json').send(text);
    } catch (e) {
        return res.status(500).json({ error: 'Error creando el usuario' });
    }
});

// ── Helpers de los endpoints de recuperación ──────────────────────────────────
const _adminOk = (req) => !!process.env.ADMIN_UI_PASSWORD
    && !!req.body && req.body.accessPassword === process.env.ADMIN_UI_PASSWORD;
const _couchHeaders = {
    Authorization: 'Basic ' + Buffer.from(config.dbServer.user + ':' + config.dbServer.password).toString('base64')
};
const _couchGet = (path) => fetch(config.dbServer.protocol + config.dbServer.host + path, { headers: _couchHeaders });
// Modelos necesarios para armar un .grd: los mismos que exporta la app en "Guardar copia de
// seguridad" (ver dataService.getBackupData del upstream: grids + metadata + dictionaries).
const _MODELOS_GRD = ['GridData', 'MetaData', 'Dictionary'];

// Usuarios con su base personal. El nombre de la base NUNCA se arma con texto que venga del
// navegador: se lee del registro del usuario en auth-users (evita que alguien pida una base ajena).
async function _listarUsuarios() {
    const r = await _couchGet('/' + encodeURIComponent(config.dbServer.userDB) + '/_all_docs?include_docs=true');
    if (!r.ok) throw new Error('auth-users HTTP ' + r.status);
    const data = await r.json();
    return (data.rows || [])
        .map((row) => row.doc)
        .filter((doc) => doc && doc.key && String(doc._id).indexOf('_design') !== 0)
        .map((doc) => ({
            usuario: String(doc.key),
            base: Object.keys(doc.personalDBs || {}).filter((n) => n.indexOf('asterics-grid-data') === 0)[0] || null
        }))
        .filter((u) => !!u.base)
        .sort((a, b) => a.usuario.localeCompare(b.usuario));
}

app.post('/admin/listar-usuarios', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!_adminOk(req)) return res.status(403).json({ error: 'Clave de acceso incorrecta' });
    try {
        const usuarios = (await _listarUsuarios()).map((u) => u.usuario);
        return res.json({ ok: true, usuarios: usuarios });
    } catch (e) {
        console.error('admin/listar-usuarios:', e.message);
        return res.status(502).json({ error: 'No pude leer la lista de usuarios' });
    }
});

app.post('/admin/datos-usuario', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!_adminOk(req)) return res.status(403).json({ error: 'Clave de acceso incorrecta' });
    const pedido = String((req.body || {}).usuario || '').trim().toLowerCase();
    if (!USERNAME_REGEX.test(pedido)) return res.status(400).json({ error: 'Nombre de usuario inválido' });
    try {
        const encontrado = (await _listarUsuarios()).filter((u) => u.usuario.toLowerCase() === pedido)[0];
        if (!encontrado) return res.status(404).json({ error: 'Ese usuario no existe' });
        const r = await _couchGet('/' + encodeURIComponent(encontrado.base) + '/_all_docs?include_docs=true');
        if (!r.ok) throw new Error('base del usuario HTTP ' + r.status);
        const data = await r.json();
        const documentos = [];
        let totalEnBase = 0;
        for (const row of (data.rows || [])) {
            const d = row.doc;
            if (!d || String(d._id).indexOf('_design') === 0) continue;
            totalEnBase++;
            if (_MODELOS_GRD.indexOf(d.modelName) === -1 || !d.encryptedDataBase64) continue;
            // Solo la versión completa. La "corta" (encryptedDataBase64Short) viene sin las imágenes:
            // sirve para listados rápidos en la app, no para restaurar un comunicador.
            documentos.push({
                _id: d._id,
                modelName: d.modelName,
                modelVersion: d.modelVersion,
                encryptedDataBase64: d.encryptedDataBase64
            });
        }
        return res.json({ ok: true, usuario: encontrado.usuario, documentos: documentos, totalEnBase: totalEnBase });
    } catch (e) {
        console.error('admin/datos-usuario:', e.message);
        return res.status(502).json({ error: 'No pude leer los datos del usuario' });
    }
});
`;

s = s.replace(anchor, anchor + '\n' + block);
fs.writeFileSync(file, s);
console.log('patch-admin-endpoints: endpoints /admin/verificar, /admin/crear-usuario, /admin/listar-usuarios y /admin/datos-usuario inyectados OK.');
