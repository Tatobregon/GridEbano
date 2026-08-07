// Patch de build para couch-auth: agrega los endpoints de la página de admin para crear usuarios.
//   POST /admin/verificar     -> valida la clave de acceso (ADMIN_UI_PASSWORD). Para el "gate".
//   POST /admin/crear-usuario -> valida la clave y crea el usuario reenviando a /auth/register
//                                CON el X-Register-Secret agregado ACÁ (server-side). El secreto
//                                real NUNCA llega al navegador; el browser solo manda la clave de acceso.
const fs = require('fs');
const file = 'superlogin/start.js';
let s = fs.readFileSync(file, 'utf8');

const anchor = "app.use('/api/infotree', infoTreeAPI.getRouter(config.dbServer.protocol, config.dbServer.host));";
if (!s.includes(anchor)) {
    console.error('patch-admin-endpoints: ANCHOR no encontrado en start.js. Abortando build.');
    process.exit(1);
}
if (s.includes('/admin/crear-usuario')) {
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
    try {
        const r = await fetch('http://127.0.0.1:3000/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Register-Secret': process.env.REGISTER_SECRET },
            body: JSON.stringify({ username: b.username, email: (b.email || (b.username + '@local.invalid')), password: b.password, confirmPassword: b.password })
        });
        const text = await r.text();
        return res.status(r.status).type('application/json').send(text);
    } catch (e) {
        return res.status(500).json({ error: 'Error creando el usuario' });
    }
});
`;

s = s.replace(anchor, anchor + '\n' + block);
fs.writeFileSync(file, s);
console.log('patch-admin-endpoints: endpoints /admin/verificar y /admin/crear-usuario inyectados OK.');
