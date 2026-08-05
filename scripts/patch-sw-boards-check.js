// Elimina la última referencia (MUERTA) a la fundación en el service worker.
// El check `shouldCacheStaleWhileRevalidate` comparaba contra la URL vieja
// 'https://asterics.github.io/Asterics-AAC-Data' (que la app ya NO pide, porque servimos los
// tableros same-origin en /Asterics-AAC-Data/). Era código muerto (nunca matcheaba) y NO hacía
// ninguna llamada, pero para no dejar NI UN string de la fundación en la lógica, lo corregimos a
// chequear el pathname same-origin. Bonus: ahora el SW reconoce bien nuestros tableros.
const fs = require('fs');
const file = 'serviceWorker.js';
let s = fs.readFileSync(file, 'utf8');

const anchor = "url.href.startsWith('https://asterics.github.io/Asterics-AAC-Data')";
if (!s.includes(anchor)) {
    // Cosmético: si el upstream cambió o ya está limpio, no rompemos el build.
    console.log('patch-sw-boards-check: anchor no encontrado (ya limpio o upstream cambió), salteando.');
    process.exit(0);
}
s = s.replace(anchor, "url.pathname.startsWith('/Asterics-AAC-Data')");
fs.writeFileSync(file, s);
console.log('patch-sw-boards-check: check de tableros corregido a same-origin (fundación eliminada del SW).');
