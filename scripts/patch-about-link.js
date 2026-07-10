// Patch de build para el frontend: agrega en la pantalla "Acerca de" un link visible al código
// fuente de ESTA versión modificada (cumplimiento AGPL-3.0: ofrecer la fuente a los usuarios).
// Se inserta justo después del link al GitHub upstream, en la sección "Información general".
const fs = require('fs');
const file = 'src/vue-components/views/aboutView.vue';
let s = fs.readFileSync(file, 'utf8');

const anchor = "astericsGridOnGithub') }}</a><br/><br/>";
if (!s.includes(anchor)) {
    console.error('patch-about-link: ANCHOR no encontrado en aboutView.vue (¿cambió el upstream?). Abortando build.');
    process.exit(1);
}
if (s.includes('Tatobregon/GridEbano')) {
    console.log('patch-about-link: ya aplicado, salteando.');
    process.exit(0);
}

const replacement =
    "astericsGridOnGithub') }}</a><br/>\n" +
    '                        <a target="_blank" href="https://github.com/Tatobregon/GridEbano">' +
    'Código fuente de esta versión (AGPL-3.0)</a><br/><br/>';

s = s.replace(anchor, replacement);
fs.writeFileSync(file, s);
console.log('patch-about-link: link a la fuente inyectado OK.');
