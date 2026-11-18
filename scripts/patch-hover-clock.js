// Patch de build (frontend): agrega un indicador visual de dwell a la entrada por hover.
// Cuando el mouse se posa sobre un elemento con "activar superposición"/hovering, el indicador se va
// llenando durante el tiempo de dwell (hoverTimeoutMs); al completarse coincide con el disparo del
// click. Si el mouse se va antes, se cancela. Es puro CSS (animaciones), self-contained (inyecta su
// propio <style>), defensivo (nunca rompe el input) y sin dependencias.
//
// Formas (se eligen en la ventana de entrada por mouse/táctil, junto con el color):
//   clock      -> reloj: círculo en el centro que se llena de 0 a 360° (la forma original)
//   circle     -> círculo que crece desde el centro hasta cubrir el elemento
//   curtainIn  -> cortina que se cierra, de afuera hacia adentro
//   curtainOut -> cortina que se abre, de adentro hacia afuera
// Se guardan en InputConfig (hoverIndicatorStyle / hoverIndicatorColor), así que viajan con el usuario
// a todos sus dispositivos. Quien no lo configuró ve el reloj azul de siempre.
//
// Se engancha en el ciclo de vida ya existente de hovering.js:
//   onElement()  -> arranca el timer del click  => acá arranca el indicador
//   offElement() -> cancela el timer            => acá se cancela el indicador
//   destroy()    -> apaga el modo hover          => acá se limpia
// Anclado en strings exactos (tag pineado). Si algo no matchea, ABORTA el build.
const fs = require('fs');

const HOVERING = 'src/js/input/hovering.js';
const INPUT_CONFIG = 'src/js/model/InputConfig.js';
const MOUSE_MODAL = 'src/vue-components/modals/input/mouseModal.vue';

if (fs.readFileSync(HOVERING, 'utf8').includes('ebano-hover-clock')) {
    console.log('patch-hover-clock: ya aplicado, salteando.');
    process.exit(0);
}

function replace(file, label, find, insert) {
    let s = fs.readFileSync(file, 'utf8');
    if (!s.includes(find)) {
        console.error(`patch-hover-clock: NO matcheó [${label}] en ${file}. Abortando build.`);
        process.exit(1);
    }
    s = s.replace(find, () => insert);
    fs.writeFileSync(file, s);
    console.log(`patch-hover-clock: OK [${label}]`);
}

// 1) Módulo del indicador, inyectado a nivel de archivo (accesible por closure desde onElement/offElement).
const MODULE = `import { InputConfig } from '../model/InputConfig';

// --- Indicador visual de dwell (se llena durante el hover hasta el click) [Ébano] ---
// Forma y color salen de InputConfig: ver scripts/patch-hover-clock.js en el repo de Ébano.
var hoverClock = (function () {
    var CLOCK_ID = 'ebano-hover-clock';
    var STYLE_ID = 'ebano-hover-clock-style';
    var DEFAULT_COLOR = '#1f9df0';
    var _el = null;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '@property --ebano-hc-deg { syntax: "<angle>"; initial-value: 0deg; inherits: false; }',
            '#' + CLOCK_ID + ' { position: fixed; pointer-events: none; z-index: 2147483000; }',
            // Reloj: círculo LLENO semitransparente, se ve el pictograma por debajo
            '#' + CLOCK_ID + '.ebano-hc-clock {',
            '  border-radius: 50%;',
            '  background: conic-gradient(var(--ebano-hc-color) var(--ebano-hc-deg), rgba(20,20,20,0.28) 0deg);',
            '  opacity: 0.82;',
            '  filter: drop-shadow(0 0 1.5px rgba(255,255,255,0.9)) drop-shadow(0 1px 2px rgba(0,0,0,0.4));',
            '  animation: ebano-hc-fill var(--ebano-hc-duration, 1000ms) linear forwards;',
            '}',
            '@keyframes ebano-hc-fill { to { --ebano-hc-deg: 360deg; } }',
            // Círculo y cortinas: ocupan el elemento entero, recortados a su forma, y semitransparentes
            // para que el pictograma se siga viendo cuando terminan de cubrirlo
            '#' + CLOCK_ID + '.ebano-hc-cover { overflow: hidden; }',
            '#' + CLOCK_ID + ' .ebano-hc-part {',
            '  position: absolute; background: var(--ebano-hc-color); opacity: 0.45;',
            '  animation-duration: var(--ebano-hc-duration, 1000ms); animation-timing-function: linear;',
            '  animation-fill-mode: forwards;',
            '}',
            '#' + CLOCK_ID + ' .ebano-hc-circle { border-radius: 50%; transform: scale(0); animation-name: ebano-hc-grow; }',
            '#' + CLOCK_ID + ' .ebano-hc-left { left: 0; top: 0; bottom: 0; width: 50%; transform-origin: left center; transform: scaleX(0); animation-name: ebano-hc-grow-x; }',
            '#' + CLOCK_ID + ' .ebano-hc-right { right: 0; top: 0; bottom: 0; width: 50%; transform-origin: right center; transform: scaleX(0); animation-name: ebano-hc-grow-x; }',
            '#' + CLOCK_ID + ' .ebano-hc-middle { left: 0; top: 0; bottom: 0; width: 100%; transform-origin: center; transform: scaleX(0); animation-name: ebano-hc-grow-x; }',
            '@keyframes ebano-hc-grow { to { transform: scale(1); } }',
            '@keyframes ebano-hc-grow-x { to { transform: scaleX(1); } }'
        ].join('\\n');
        document.head.appendChild(style);
    }

    function addPart(container, className, sizes) {
        var part = document.createElement('div');
        part.className = 'ebano-hc-part ' + className;
        if (sizes) {
            Object.keys(sizes).forEach(function (key) { part.style[key] = sizes[key]; });
        }
        container.appendChild(part);
    }

    function remove() {
        if (_el && _el.parentNode) { _el.parentNode.removeChild(_el); }
        _el = null;
    }

    return {
        start: function (element, ms, shape, color) {
            try {
                if (!element || !ms || ms <= 0) return;
                ensureStyle();
                remove();
                var rect = element.getBoundingClientRect();
                if (!rect || !rect.width || !rect.height) return;
                // El color termina dentro del CSS: solo se acepta #rrggbb; si no, el azul de siempre.
                color = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : DEFAULT_COLOR;
                var el = document.createElement('div');
                el.id = CLOCK_ID;
                el.style.setProperty('--ebano-hc-duration', ms + 'ms');
                el.style.setProperty('--ebano-hc-color', color);
                if (shape === 'circle' || shape === 'curtainIn' || shape === 'curtainOut') {
                    el.className = 'ebano-hc-cover';
                    el.style.left = rect.left + 'px';
                    el.style.top = rect.top + 'px';
                    el.style.width = rect.width + 'px';
                    el.style.height = rect.height + 'px';
                    el.style.borderRadius = window.getComputedStyle(element).borderRadius;
                    if (shape === 'circle') {
                        // Diámetro = diagonal del elemento: al terminar cubre también las esquinas.
                        var d = Math.ceil(Math.sqrt(rect.width * rect.width + rect.height * rect.height));
                        addPart(el, 'ebano-hc-circle', {
                            width: d + 'px', height: d + 'px',
                            left: (rect.width - d) / 2 + 'px', top: (rect.height - d) / 2 + 'px'
                        });
                    } else if (shape === 'curtainIn') {
                        addPart(el, 'ebano-hc-left');
                        addPart(el, 'ebano-hc-right');
                    } else {
                        addPart(el, 'ebano-hc-middle');
                    }
                } else {
                    var size = Math.max(44, Math.min(90, Math.min(rect.width, rect.height) * 0.45));
                    el.className = 'ebano-hc-clock';
                    el.style.width = size + 'px';
                    el.style.height = size + 'px';
                    el.style.left = (rect.left + rect.width / 2 - size / 2) + 'px';
                    el.style.top = (rect.top + rect.height / 2 - size / 2) + 'px';
                }
                // animationend sube desde las partes hasta el contenedor. Solo se saca si sigue siendo
                // el indicador actual (las dos hojas de la cortina terminan juntas).
                el.addEventListener('animationend', function () {
                    if (_el === el) { remove(); }
                });
                document.body.appendChild(el);
                _el = el;
            } catch (e) { /* el indicador NUNCA debe romper el input */ }
        },
        stop: function () { remove(); }
    };
})();`;
replace(HOVERING, 'inyectar módulo hoverClock', "import { InputConfig } from '../model/InputConfig';", MODULE);

// 2) getInstanceFromConfig(): pasar la forma y el color elegidos por el usuario.
replace(
    HOVERING,
    'forma y color desde InputConfig',
    "        hideCursor: inputConfig.hoverHideCursor",
    "        hideCursor: inputConfig.hoverHideCursor,\n        indicatorStyle: inputConfig.hoverIndicatorStyle,\n        indicatorColor: inputConfig.hoverIndicatorColor"
);

// 3) onElement(): arrancar el indicador junto con el timer del click.
replace(
    HOVERING,
    'hook start en onElement',
    "        if (_hoverTimeoutMs !== 0) {\n            _hoverMap[element] = setTimeout(function () {",
    "        if (_hoverTimeoutMs !== 0) {\n            hoverClock.start(element, _hoverTimeoutMs, options.indicatorStyle, options.indicatorColor);\n            _hoverMap[element] = setTimeout(function () {"
);

// 4) offElement(): cancelar el indicador si el mouse se va antes de completar.
replace(
    HOVERING,
    'hook stop en offElement',
    "        L.removeClass(element, 'mouseentered');\n        clearTimeout(_hoverMap[element]);",
    "        L.removeClass(element, 'mouseentered');\n        hoverClock.stop();\n        clearTimeout(_hoverMap[element]);"
);

// 5) destroy(): limpiar el indicador al apagar el modo hover.
replace(
    HOVERING,
    'hook stop en destroy',
    "    thiz.destroy = function () {",
    "    thiz.destroy = function () {\n        hoverClock.stop();"
);

// 6) InputConfig: los dos campos nuevos, declarados para que se guarden y se sincronicen con el resto.
replace(
    INPUT_CONFIG,
    'campos del indicador',
    "    hoverDisableHoverpane: [Boolean],\n",
    "    hoverDisableHoverpane: [Boolean],\n" +
    "    hoverIndicatorStyle: [String], // [Ébano] forma del indicador de dwell: clock | circle | curtainIn | curtainOut\n" +
    "    hoverIndicatorColor: [String], // [Ébano] color del indicador de dwell, #rrggbb\n"
);

// 7) Ventana de entrada por mouse/táctil: elegir forma y color. Se muestra solo con el hover activado,
// y el área "Probar configuración" de la misma ventana ya lo muestra en vivo.
replace(
    MOUSE_MODAL,
    'opciones del indicador',
    '                        <div class="mb-4"></div>',
    '                        <div class="srow" v-show="inputConfig.hoverEnabled">\n' +
    '                            <label class="four columns" for="ebanoHoverIndicator">Indicador de espera</label>\n' +
    '                            <select id="ebanoHoverIndicator" class="eight columns" v-model="inputConfig.hoverIndicatorStyle">\n' +
    '                                <option value="clock">Reloj</option>\n' +
    '                                <option value="circle">Círculo que crece desde el centro</option>\n' +
    '                                <option value="curtainIn">Cortina que se cierra (de afuera hacia adentro)</option>\n' +
    '                                <option value="curtainOut">Cortina que se abre (de adentro hacia afuera)</option>\n' +
    '                            </select>\n' +
    '                        </div>\n' +
    '                        <div class="srow" v-show="inputConfig.hoverEnabled">\n' +
    '                            <label class="four columns" for="ebanoHoverColor">Color del indicador</label>\n' +
    '                            <input type="color" id="ebanoHoverColor" v-model="inputConfig.hoverIndicatorColor"/>\n' +
    '                        </div>\n' +
    '                        <div class="mb-4"></div>'
);

// 8) Al abrir la ventana: completar los valores que falten ANTES de que Vue observe el objeto (si no,
// el desplegable no reacciona). Los usuarios que nunca lo configuraron no los tienen guardados.
replace(
    MOUSE_MODAL,
    'valores por defecto del indicador',
    '                thiz.inputConfig = JSON.parse(JSON.stringify(metadata.inputConfig));',
    '                let ebanoInputConfig = JSON.parse(JSON.stringify(metadata.inputConfig));\n' +
    "                ebanoInputConfig.hoverIndicatorStyle = ebanoInputConfig.hoverIndicatorStyle || 'clock';\n" +
    "                ebanoInputConfig.hoverIndicatorColor = ebanoInputConfig.hoverIndicatorColor || '#1f9df0';\n" +
    '                thiz.inputConfig = ebanoInputConfig;'
);

console.log('patch-hover-clock: indicador de dwell configurable agregado OK.');
