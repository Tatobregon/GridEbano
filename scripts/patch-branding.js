// Patch de build (frontend): re-marca la app con el logo de EBANO, manteniendo la atribución a
// AsTeRICS Grid (autoría del software, respeta el AGPL). Reemplaza:
//   - headerIcon.vue : logo del header (escritorio + celular) por el de EBANO; en escritorio agrega
//                      "by AsTeRICS Grid" en chico y tenue al lado.
//   - index.html     : <title> y favicon.
//   - manifest       : name/short_name/description (con el eslogan) + íconos de la PWA.
//   - loginView.vue  : prefijo "Asterics AAC -" -> "EBANO -" + eslogan "desarrollando capacidades".
// Los archivos de imagen (branding/ebano-*.png) los copia el Dockerfile a app/img/.
// Anclado en strings exactos (tag pineado). Si algo no matchea, ABORTA el build.
const fs = require('fs');

function patch(file, label, find, replacement) {
    let s = fs.readFileSync(file, 'utf8');
    if (!s.includes(find)) {
        console.error(`patch-branding: NO matcheó [${label}] en ${file}. Abortando build.`);
        process.exit(1);
    }
    s = s.replace(find, replacement);
    fs.writeFileSync(file, s);
    console.log(`patch-branding: OK [${label}]`);
}

const HEADER = 'src/vue-components/components/headerIcon.vue';

// 1) Header ESCRITORIO: logo EBANO + "by AsTeRICS Grid" chiquito.
patch(HEADER, 'header escritorio',
    '<a tabindex="21" aria-hidden="true" href="#main" class="hide-mobile"><h1 class="inline"><img id="astericsIcon" src="app/img/asterics-aac-logo-raw.svg" height="40" alt="Asterics AAC"/></h1></a>',
    '<a tabindex="21" aria-hidden="true" href="#main" class="hide-mobile"><h1 class="inline" style="margin:0; display:inline-flex; align-items:flex-end; gap:7px;"><img id="astericsIcon" src="app/img/ebano-logo.png" height="40" alt="EBANO"/><span style="font-size:11px; font-weight:400; color:#6b7280; line-height:2.7; white-space:nowrap;">by AsTeRICS&nbsp;Grid</span></h1></a>'
);

// 2) Header CELULAR: logo EBANO (más chico, sin el "by" para no amontonar).
patch(HEADER, 'header celular',
    '<a tabindex="22" aria-hidden="true" href="#main" class="show-mobile"><h1 class="inline"><img id="astericsIcon" src="app/img/favicon.svg" alt="Asterics AAC" style="margin: 0"/></h1></a>',
    '<a tabindex="22" aria-hidden="true" href="#main" class="show-mobile"><h1 class="inline"><img id="astericsIcon" src="app/img/ebano-logo.png" height="34" alt="EBANO" style="margin: 0"/></h1></a>'
);

// 3) index.html: título + favicon + h1 sr-only + logo del sidebar.
patch('index.html', 'title', '<title>Asterics AAC</title>', '<title>EBANO</title>');
patch('index.html', 'h1 sr-only (lectores de pantalla)',
    '<h1 class="sr-only">Asterics AAC</h1>',
    '<h1 class="sr-only">EBANO by AsTeRICS Grid</h1>');
patch('index.html', 'logo del sidebar (escritorio)',
    '<a tabindex="-1" aria-hidden="true" href="javascript:void(0)" @click="toMain"><h1 class="inline hide-mobile"><img id="astericsIcon" src="app/img/asterics-aac-logo-raw.svg" height="40" alt="Asterics AAC"/></h1></a>',
    '<a tabindex="-1" aria-hidden="true" href="javascript:void(0)" @click="toMain"><h1 class="inline hide-mobile" style="margin:0; display:inline-flex; align-items:flex-end; gap:7px;"><img id="astericsIcon" src="app/img/ebano-logo.png" height="40" alt="EBANO"/><span style="font-size:11px; font-weight:400; color:#6b7280; line-height:2.7; white-space:nowrap;">by AsTeRICS&nbsp;Grid</span></h1></a>');
patch('index.html', 'favicon svg->png',
    '<link rel="icon" href="app/img/favicon-no-circle.svg" type="image/svg+xml">',
    '<link rel="icon" href="app/img/ebano-favicon-96.png" type="image/png">');
patch('index.html', 'apple-touch-icon',
    '<link rel="icon" href="app/img/favicon-no-circle.png" type="image/png">',
    '<link rel="apple-touch-icon" href="app/img/ebano-icon-512.png">');

// 4) manifest: nombre, descripción (con eslogan) e íconos.
const MAN = 'app/manifest.webmanifest';
patch(MAN, 'manifest name', '"name":"Asterics AAC"', '"name":"EBANO"');
patch(MAN, 'manifest short_name', '"short_name":"Asterics"', '"short_name":"EBANO"');
patch(MAN, 'manifest description',
    '"description":"Free and simple to use app for augmentative and alternative communication (AAC) with offline support, flexible input methods and media access"',
    '"description":"EBANO — desarrollando capacidades. Aplicación de comunicación aumentativa y alternativa (CAA). Basada en AsTeRICS Grid."');
patch(MAN, 'manifest icon maskable',
    '"src":"img/app-icons/icon512_maskable.png"', '"src":"img/ebano-icon-maskable-512.png"');
patch(MAN, 'manifest icon any',
    '"src":"img/app-icons/icon512_rounded.png"', '"src":"img/ebano-icon-512.png"');
patch(MAN, 'manifest screenshot label desktop',
    '"label":"Asterics AAC on desktop"', '"label":"EBANO en escritorio"');
patch(MAN, 'manifest screenshot label mobile',
    '"label":"Asterics AAC on mobile"', '"label":"EBANO en el celular"');

// 5) loginView: prefijo de marca + eslogan bajo el título.
patch('src/vue-components/views/loginView.vue', 'login: marca + eslogan',
    '<h2><span class="show-mobile">Asterics AAC - </span><span>{{ $t(\'login\') }}</span></h2>',
    '<h2><span class="show-mobile">EBANO - </span><span>{{ $t(\'login\') }}</span></h2>\n            <p style="margin:-6px 0 16px; color:#6b7280; font-size:.92rem; font-style:italic;">desarrollando capacidades</p>');

console.log('patch-branding: re-marca EBANO aplicada OK.');
