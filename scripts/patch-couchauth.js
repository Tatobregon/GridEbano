// Patch de build para couch-auth: bloquea el registro público.
// Inserta un guard antes del router de /auth que rechaza POST /auth/register salvo que la petición
// traiga el header  X-Register-Secret == process.env.REGISTER_SECRET.
// Fail-closed: si REGISTER_SECRET no está seteado, se bloquea TODO registro.
// El admin crea usuarios con scripts/crear-usuario.sh (que manda el secreto). El público, no.
const fs = require('fs');
const file = 'superlogin/start.js';
let s = fs.readFileSync(file, 'utf8');

const anchor = "app.use('/auth', couchAuth.router);";
if (!s.includes(anchor)) {
    console.error('patch-couchauth: ANCHOR no encontrado en start.js (¿cambió el upstream?). Abortando build.');
    process.exit(1);
}
if (s.includes('X-Register-Secret')) {
    console.log('patch-couchauth: ya aplicado, salteando.');
    process.exit(0);
}

const guard =
    "app.post('/auth/register', (req, res, next) => {\n" +
    "    const secret = process.env.REGISTER_SECRET;\n" +
    "    if (!secret || req.get('X-Register-Secret') !== secret) {\n" +
    "        return res.status(403).json({ error: 'Registration is disabled' });\n" +
    "    }\n" +
    "    next();\n" +
    "});\n    ";

s = s.replace(anchor, guard + anchor);
fs.writeFileSync(file, s);
console.log('patch-couchauth: register-guard inyectado OK.');
