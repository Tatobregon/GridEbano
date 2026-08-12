// Patch de build (frontend): saca del MENÚ de navegación las opciones "Acerca de AsTeRICS Grid" y
// "Ayuda", para que los clientes no se metan ahí. NO borra la información ni las páginas: las vistas
// y las rutas #about/#help siguen existiendo (accesibles por URL directa). Esto es importante para
// #about, que contiene el link al código fuente (obligación AGPL): sigue existiendo, solo que no
// aparece en el menú. Puro removido de 2 <li> en index.html.
// Anclado en strings exactos (tag pineado). Si algo no matchea, ABORTA el build.
const fs = require('fs');
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');

function remove(label, find, replacement) {
    if (!s.includes(find)) {
        console.error(`patch-remove-nav-about-help: NO matcheó [${label}] en ${file}. Abortando build.`);
        process.exit(1);
    }
    s = s.replace(find, replacement);
    console.log(`patch-remove-nav-about-help: OK [${label}]`);
}

// "Acerca de AsTeRICS Grid" (link a #about).
remove('menú: Acerca de',
    '<li class="hide-mobile"><a tabindex="9" href="#about" :aria-label="$t(\'aboutAstericsGrid\')"><button tabindex="-1"><i class="fas fa-2x fa-info-circle"></i><span class="hide-mobile">{{ $t(\'aboutAstericsGrid\') }}</span></button></a></li>',
    '<!-- "Acerca de" quitado del menú (la página sigue en #about; conserva el link a la fuente AGPL) -->');

// "Ayuda" (link a #help).
remove('menú: Ayuda',
    '<li><a tabindex="10" href="#help" :aria-label="$t(\'help\')"><button tabindex="-1" id="helpButton"><i class="fas fa-2x fa-question-circle"></i><span class="hide-mobile">{{ $t(\'help\') }}</span></button></a></li>',
    '<!-- "Ayuda" quitado del menú (la página sigue en #help) -->');

fs.writeFileSync(file, s);
console.log('patch-remove-nav-about-help: opciones de menú quitadas OK.');
