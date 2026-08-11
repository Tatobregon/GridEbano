// Patch de build (frontend): QUITA de la UI TODA opción de crear usuarios en el Grid (online Y
// offline). En nuestro despliegue las cuentas las crea SOLO el admin (página
// /crear-usuario-ebano-soluciones o scripts/crear-usuario.sh) y son ONLINE (respaldadas del lado
// servidor). Sin este patch la UI ofrece: (a) "registrarse" (crear cuenta online) —opción MUERTA,
// el backend la rechaza (nginx → 403 en /auth/register)— y (b) crear usuario OFFLINE (perfil local
// SIN backup, riesgoso para el modelo del proyecto). Eliminamos ambas de la UI y, por defensa en
// profundidad, hacemos que las rutas #register, #add y #welcome rendericen el LOGIN (por si alguien
// escribe el hash a mano). La app queda SOLO-LOGIN.
//
// Anclamos en las claves i18n ($t('...')), que son únicas y estables (release pineado). Si un bloque
// no matchea (upstream cambió), ABORTAMOS el build para no pasar el cambio por alto.
const fs = require('fs');

function patch(file, label, regex, replacement) {
    let s = fs.readFileSync(file, 'utf8');
    if (!regex.test(s)) {
        console.error(`patch-remove-register-ui: NO matcheó [${label}] en ${file}. Abortando build.`);
        process.exit(1);
    }
    s = s.replace(regex, replacement);
    fs.writeFileSync(file, s);
    console.log(`patch-remove-register-ui: OK [${label}] en ${file}`);
}

// 1) loginView.vue — bloque "¿no tenés cuenta? registrate ahora" (link a #register).
patch(
    'src/vue-components/views/loginView.vue',
    'login: bloque registrate',
    /<div class="srow">\s*<div class="twelve columns">\s*<span v-show="allUsersList\.length === 0">\{\{ \$t\('noAccount'\) \}\}<\/span>\s*<span v-show="allUsersList\.length > 0">\{\{ \$t\('addNewAccount'\) \}\}<\/span>\s*<a href="#register">\{\{ \$t\('registernow'\) \}\}<\/a>\s*<div v-show="allUsersList\.length === 0">\s*<span>\{\{ \$t\('astericsGridIsFreeAndAllYouNeedToRegister'\) \}\}<\/span>\s*<\/div>\s*<\/div>\s*<\/div>/,
    '<!-- registro removido: las cuentas las crea el admin -->'
);

// 2a) welcomeView.vue — info "siempre podés registrarte más tarde".
patch(
    'src/vue-components/views/welcomeView.vue',
    'welcome: info registrar-luego',
    /<div>\s*<span class="fa fa-info-circle"><\/span><span class="break-word">\{\{ \$t\('itsAlwaysPossibleToRegisterLater'\) \}\}<\/span>\s*<\/div>/,
    '<!-- registro removido -->'
);

// 2b) welcomeView.vue — sección entera "Usar CON registro" (h3 + beneficios + botón "Registrarse ahora").
patch(
    'src/vue-components/views/welcomeView.vue',
    'welcome: seccion con-registro',
    /<div class="mt-4">\s*<h3>[\s\S]*?<button[^>]*@click="toRegister\(\)"[\s\S]*?<\/button>\s*<\/div>\s*<\/div>\s*<\/div>/,
    '<!-- registro removido: las cuentas las crea el admin -->'
);

// 2c) loginView.vue — link "¿querés crear un usuario offline? agregar usuario offline" (link a #add).
patch(
    'src/vue-components/views/loginView.vue',
    'login: link usuario-offline',
    /<div class="srow">\s*<div class="twelve columns">\s*<span>\{\{ \$t\('wantToCreateAnOfflineonlyUser'\) \}\}<\/span>\s*<a href="#add">\{\{ \$t\('addOfflineUser'\) \}\}<\/a>\s*<\/div>\s*<\/div>/,
    '<!-- creación offline removida: la app es solo-login -->'
);

// 3) addOfflineView.vue — link "¿querés registrar un usuario online? registrar".
patch(
    'src/vue-components/views/addOfflineView.vue',
    'addOffline: link registrar-online',
    /<div class="srow">\s*<div class="six columns offset-by-two">\s*<span>\{\{ \$t\('wantToRegisterAnOnlineUser'\) \}\}<\/span>\s*<a href="#register">\{\{ \$t\('toRegister'\) \}\}<\/a>\s*<\/div>\s*<\/div>/,
    '<!-- registro removido -->'
);

// 4a) router.js — defensa en profundidad: #register renderiza el Login (no el form de registro).
patch(
    'src/js/router.js',
    'router: #register -> login',
    /register: function \(\) \{\s*helpService\.setHelpLocation\('06_users', '#online-users'\);\s*loadVueView\(RegisterView\);\s*\}/,
    "register: function () {\n            // registro deshabilitado: las cuentas las crea el admin. Renderizamos el login.\n            loadVueView(LoginView);\n        }"
);

// 4b) router.js — #add (crear usuario offline) renderiza el Login.
patch(
    'src/js/router.js',
    'router: #add -> login',
    /add: function \(\) \{\s*helpService\.setHelpLocation\('06_users', '#offline-users'\);\s*loadVueView\(AddOfflineView\);\s*\}/,
    "add: function () {\n            // creación offline deshabilitada: la app es solo-login. Renderizamos el login.\n            loadVueView(LoginView);\n        }"
);

// 4c) router.js — #welcome (bienvenida con registro/offline-default) renderiza el Login.
patch(
    'src/js/router.js',
    'router: #welcome -> login',
    /welcome: function \(\) \{\s*helpService\.setHelpLocationIndex\(\);\s*loadVueView\(WelcomeView\);\s*\}/,
    "welcome: function () {\n            // pantalla de bienvenida (registro/offline) deshabilitada: la app es solo-login.\n            loadVueView(LoginView);\n        }"
);

console.log('patch-remove-register-ui: toda la creación de usuarios (online y offline) removida OK.');
