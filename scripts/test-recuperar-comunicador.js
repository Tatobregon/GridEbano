/**
 * Test del circuito de "Recuperar comunicador" (panel de admin).
 *
 * QUÉ PRUEBA: que la lógica que corre en el NAVEGADOR sabe abrir los documentos tal como los cifra
 * la app de verdad, y que el .grd que arma tiene la forma que espera el importador de AsTeRICS Grid.
 *
 * CÓMO: cifra tableros de prueba con el MISMO algoritmo de la app (sjcl, misma derivación de clave),
 * extrae el bloque LOGICA-PURA de nginx/admin-crear-usuario.html y lo corre contra esos datos.
 * Si alguien cambia la página y rompe el descifrado, este test lo caza.
 *
 * USO:   node scripts/test-recuperar-comunicador.js
 *        SJCL=/ruta/a/sjcl.min.js node scripts/test-recuperar-comunicador.js
 *
 * La librería sjcl se busca en: $SJCL, luego ./.sjcl-cache/sjcl.min.js, y si no está se baja del
 * sitio (la misma copia que usa la página, así se prueba contra la versión real).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..');
const PAGINA = path.join(RAIZ, 'nginx', 'admin-crear-usuario.html');
const SITIO = process.env.SITIO || 'https://comunicador.ebano-soluciones.com.ar';
const CACHE = path.join(RAIZ, '.sjcl-cache', 'sjcl.min.js');

let fallos = 0;
const ok = (cond, texto) => {
    console.log((cond ? '  OK   ' : '  FALLA') + '  ' + texto);
    if (!cond) fallos++;
};

async function cargarSjcl() {
    let codigo = null;
    if (process.env.SJCL && fs.existsSync(process.env.SJCL)) {
        codigo = fs.readFileSync(process.env.SJCL, 'utf8');
        console.log('sjcl: ' + process.env.SJCL);
    } else if (fs.existsSync(CACHE)) {
        codigo = fs.readFileSync(CACHE, 'utf8');
        console.log('sjcl: ' + CACHE + ' (cache)');
    } else {
        const url = SITIO.replace(/\/$/, '') + '/app/lib/sjcl.min.js';
        console.log('sjcl: bajando de ' + url);
        const r = await fetch(url);
        if (!r.ok) throw new Error('no pude bajar sjcl (HTTP ' + r.status + '). Pasá SJCL=/ruta/sjcl.min.js');
        codigo = await r.text();
        fs.mkdirSync(path.dirname(CACHE), { recursive: true });
        fs.writeFileSync(CACHE, codigo);
    }
    const ctx = { window: {}, console: console };
    vm.createContext(ctx);
    vm.runInContext(codigo, ctx);
    const sjcl = ctx.sjcl || ctx.window.sjcl;
    if (!sjcl || !sjcl.encrypt) throw new Error('el archivo de sjcl no definió la librería');
    return sjcl;
}

// Saca el bloque de funciones puras de la página (entre los marcadores) y lo convierte en módulo.
function cargarLogicaDeLaPagina(sjcl) {
    const html = fs.readFileSync(PAGINA, 'utf8');
    const iIni = html.indexOf('LOGICA-PURA-INICIO');
    const iFin = html.indexOf('LOGICA-PURA-FIN');
    if (iIni === -1 || iFin === -1) throw new Error('no encontré los marcadores LOGICA-PURA en ' + PAGINA);
    const desde = html.indexOf('*/', iIni) + 2;
    const hasta = html.lastIndexOf('/*', iFin);
    const bloque = html.slice(desde, hasta);
    if (!bloque.includes('function armarGrd')) throw new Error('el bloque extraído no tiene las funciones esperadas');
    const fabrica = new Function('sjcl', 'setTimeout', bloque +
        '\nreturn { clavesCandidatas, descifrarUno, descifrarTodo, armarGrd, etiqueta, nombreArchivo };');
    return fabrica(sjcl, setTimeout);
}

// Replica EXACTA de lo que hace la app al guardar (encryptionService.encryptObject del upstream).
function cifrarComoLaApp(sjcl, objeto, sal, contrasena) {
    const hex256 = (s) => sjcl.codec.hex.fromBits(sjcl.hash.sha256.hash(s));
    const claveBase = hex256('STATIC_USER_PW_SALT' + contrasena);
    const clave = hex256('' + sal + claveBase);
    return {
        _id: objeto.id,
        modelName: objeto.modelName,
        modelVersion: '{"major": 7, "minor": 0, "patch": 0}',
        encryptedDataBase64: sjcl.encrypt(clave, JSON.stringify(objeto), { iter: 1000 })
    };
}

(async () => {
    const sjcl = await cargarSjcl();
    const L = cargarLogicaDeLaPagina(sjcl);
    console.log('lógica extraída de nginx/admin-crear-usuario.html\n');

    const USUARIO = 'juanperez';
    const CLAVE = 'ClaveDePrueba123';

    // Datos de prueba: 3 tableros (uno con una "imagen" grande), la configuración y un diccionario.
    const imagenFalsa = 'data:image/png;base64,' + 'A'.repeat(200000);
    const tableros = [
        { id: 'grid-data-1', modelName: 'GridData', label: { es: 'Inicio', en: 'Home' }, gridElements: [{ id: 'e1', label: { es: 'hola' }, image: { data: imagenFalsa } }] },
        { id: 'grid-data-2', modelName: 'GridData', label: { es: 'Comidas' }, gridElements: [] },
        { id: 'grid-data-3', modelName: 'GridData', label: { en: 'Feelings' }, gridElements: [] }
    ];
    const config = { id: 'meta-data-1', modelName: 'MetaData', globalGridId: 'grid-data-1', lastOpenedGridId: 'grid-data-2' };
    const diccionario = { id: 'dictionary-1', modelName: 'Dictionary', dictionaryKey: 'es', data: '{}' };
    // Un modelo que el endpoint NO manda, para comprobar que no estorba si apareciera.
    const otro = { id: 'otro-1', modelName: 'GridPreview', algo: 'x' };

    const docs = tableros.concat([config, diccionario, otro])
        .map((o) => cifrarComoLaApp(sjcl, o, USUARIO, CLAVE));

    console.log('[1] Contraseña correcta');
    let res = await L.descifrarTodo(docs, USUARIO, CLAVE);
    ok(res.objetos.length === 6, 'abre los 6 documentos (abrió ' + res.objetos.length + ')');
    ok(res.fallidos.length === 0, 'ninguno falla');

    let grd = L.armarGrd(res.objetos);
    ok(grd.grids.length === 3, 'el .grd tiene los 3 tableros (tiene ' + grd.grids.length + ')');
    ok(!!grd.metadata && grd.metadata.globalGridId === 'grid-data-1', 'incluye la configuración del usuario');
    ok(!!grd.dictionaries && grd.dictionaries.length === 1, 'incluye el diccionario');
    ok(grd.grids[0].gridElements[0].image.data === imagenFalsa, 'la imagen grande viaja completa, sin cortarse');
    ok(!('GridPreview' in grd) && JSON.stringify(grd).indexOf('GridPreview') === -1, 'los modelos que no van al .grd quedan afuera');

    console.log('\n[2] Forma que exige el importador de AsTeRICS Grid');
    // dataService.convertFileToImportData rechaza el archivo si no trae nada de esto:
    ok(!!(grd.grids || grd.metadata || grd.dictionaries), 'tiene grids / metadata / dictionaries');
    ok(Array.isArray(grd.grids), 'grids es una lista');
    ok(!Array.isArray(grd.metadata), 'metadata es un objeto, no una lista');
    const texto = JSON.stringify(grd);
    ok(JSON.parse(texto).grids.length === 3, 'el archivo es JSON válido y se vuelve a leer igual');

    console.log('\n[3] Contraseña equivocada');
    res = await L.descifrarTodo(docs, USUARIO, 'otraClaveQueNoEs');
    ok(res.objetos.length === 0, 'no abre ningún documento (abrió ' + res.objetos.length + ')');
    ok(res.fallidos.length === docs.length, 'los marca todos como fallidos');

    console.log('\n[4] Usuario equivocado (la sal no coincide)');
    res = await L.descifrarTodo(docs, 'otrousuario', CLAVE);
    ok(res.objetos.length === 0, 'no abre nada con el usuario equivocado');

    console.log('\n[5] Datos viejos: la sal es el id de la configuración (modelo anterior a la v7)');
    const docsViejos = tableros.concat([config])
        .map((o) => cifrarComoLaApp(sjcl, o, 'meta-data-1', CLAVE));
    res = await L.descifrarTodo(docsViejos, USUARIO, CLAVE);
    ok(res.objetos.length === 4, 'también los abre usando la sal vieja (abrió ' + res.objetos.length + ')');

    console.log('\n[6] Detalles de presentación');
    ok(L.etiqueta({ es: 'Inicio', en: 'Home' }) === 'Inicio', 'muestra el nombre en español cuando existe');
    ok(L.etiqueta({ en: 'Feelings' }) === 'Feelings', 'si no hay español, usa el que haya');
    ok(L.etiqueta(null) === '(sin nombre)', 'un tablero sin nombre no rompe nada');
    const nombre = L.nombreArchivo('juanperez', new Date(2026, 9, 1, 9, 5));
    ok(nombre === 'juanperez_2026-10-01_0905_comunicador.grd', 'el nombre del archivo queda ' + nombre);

    console.log('\n' + (fallos === 0 ? 'TODO OK (' : fallos + ' FALLA(S) de ') + 'los chequeos del circuito de recuperación');
    process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
