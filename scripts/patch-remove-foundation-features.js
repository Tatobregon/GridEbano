// Neutraliza las 2 features OPCIONALES que llamaban a la fundación (desacople TOTAL):
//   - Podcast  -> api.asterics-foundation.org/podcastindex.php
//   - CORS proxy de grid-actions HTTP -> proxy.asterics-foundation.org/proxy_nofilter.php
// Se apuntan a un path same-origin (/_feature_deshabilitada) que nuestro nginx responde con 404.
// Ambas features manejan el fallo con gracia (podcast devuelve []; el proxy muestra un tooltip),
// así que no crashean: simplemente quedan inertes. Resultado: 0 referencias a la fundación.
const fs = require('fs');
const changed = [];

// 1) Podcast (2 llamadas idénticas)
{
    const file = 'src/js/service/podcastService.js';
    let s = fs.readFileSync(file, 'utf8');
    const anchor = 'https://api.asterics-foundation.org/podcastindex.php';
    if (!s.includes(anchor)) {
        console.error('patch-remove-foundation-features: anchor PODCAST no encontrado (¿cambió upstream?). Abortando.');
        process.exit(1);
    }
    s = s.split(anchor).join('/_feature_deshabilitada');
    fs.writeFileSync(file, s);
    changed.push('podcast');
}

// 2) CORS proxy (grid-actions HTTP con useCorsProxy)
{
    const file = 'src/js/service/httpService.js';
    let s = fs.readFileSync(file, 'utf8');
    const anchor = "new URL('https://proxy.asterics-foundation.org/proxy_nofilter.php')";
    if (!s.includes(anchor)) {
        console.error('patch-remove-foundation-features: anchor PROXY no encontrado (¿cambió upstream?). Abortando.');
        process.exit(1);
    }
    s = s.replace(anchor, "new URL('/_feature_deshabilitada', location.origin)");
    fs.writeFileSync(file, s);
    changed.push('cors-proxy');
}

console.log('patch-remove-foundation-features: neutralizadas -> ' + changed.join(', '));
