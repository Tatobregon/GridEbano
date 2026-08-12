// Patch de build (frontend): agrega un indicador visual de dwell ("reloj") a la entrada por hover.
// Cuando el mouse se posa sobre un elemento con "activar superposición"/hovering, un CÍRCULO se va
// llenando (0→360°, tipo reloj) durante el tiempo de dwell (hoverTimeoutMs); al completarse coincide
// con el disparo del click. Si el mouse se va antes, se cancela. Es puro CSS (conic-gradient animado),
// self-contained (inyecta su propio <style>), defensivo (nunca rompe el input) y sin dependencias.
//
// Se engancha en el ciclo de vida ya existente de hovering.js:
//   onElement()  -> arranca el timer del click  => acá arranca el reloj
//   offElement() -> cancela el timer            => acá se cancela el reloj
//   destroy()    -> apaga el modo hover          => acá se limpia
// Anclado en strings exactos (tag pineado). Si algo no matchea, ABORTA el build.
const fs = require('fs');
const file = 'src/js/input/hovering.js';
let s = fs.readFileSync(file, 'utf8');

if (s.includes('ebano-hover-clock')) {
    console.log('patch-hover-clock: ya aplicado, salteando.');
    process.exit(0);
}

function replace(label, find, insert) {
    if (!s.includes(find)) {
        console.error(`patch-hover-clock: NO matcheó [${label}] en ${file}. Abortando build.`);
        process.exit(1);
    }
    s = s.replace(find, insert);
    console.log(`patch-hover-clock: OK [${label}]`);
}

// 1) Módulo del reloj, inyectado a nivel de archivo (accesible por closure desde onElement/offElement).
const MODULE = `import { InputConfig } from '../model/InputConfig';

// --- Indicador visual de dwell ("reloj" que se llena durante el hover hasta el click) [Ébano] ---
var hoverClock = (function () {
    var CLOCK_ID = 'ebano-hover-clock';
    var STYLE_ID = 'ebano-hover-clock-style';
    var _el = null;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '@property --ebano-hc-deg { syntax: "<angle>"; initial-value: 0deg; inherits: false; }',
            '#' + CLOCK_ID + ' {',
            '  position: fixed; pointer-events: none; z-index: 2147483000; border-radius: 50%;',
            '  --ebano-hc-color: #1f9df0;',
            '  background: conic-gradient(var(--ebano-hc-color) var(--ebano-hc-deg), rgba(20,20,20,0.28) 0deg);',
            '  opacity: 0.82;',   // círculo LLENO semitransparente: se ve el pictograma por debajo
            '  filter: drop-shadow(0 0 1.5px rgba(255,255,255,0.9)) drop-shadow(0 1px 2px rgba(0,0,0,0.4));',
            '  animation: ebano-hc-fill var(--ebano-hc-duration, 1000ms) linear forwards;',
            '}',
            '@keyframes ebano-hc-fill { to { --ebano-hc-deg: 360deg; } }'
        ].join('\\n');
        document.head.appendChild(style);
    }

    function remove() {
        if (_el && _el.parentNode) { _el.parentNode.removeChild(_el); }
        _el = null;
    }

    return {
        start: function (element, ms) {
            try {
                if (!element || !ms || ms <= 0) return;
                ensureStyle();
                remove();
                var rect = element.getBoundingClientRect();
                if (!rect || !rect.width || !rect.height) return;
                var size = Math.max(44, Math.min(90, Math.min(rect.width, rect.height) * 0.45));
                var el = document.createElement('div');
                el.id = CLOCK_ID;
                el.style.width = size + 'px';
                el.style.height = size + 'px';
                el.style.left = (rect.left + rect.width / 2 - size / 2) + 'px';
                el.style.top = (rect.top + rect.height / 2 - size / 2) + 'px';
                el.style.setProperty('--ebano-hc-duration', ms + 'ms');
                el.addEventListener('animationend', remove);
                document.body.appendChild(el);
                _el = el;
            } catch (e) { /* el indicador NUNCA debe romper el input */ }
        },
        stop: function () { remove(); }
    };
})();`;
replace('inyectar módulo hoverClock', "import { InputConfig } from '../model/InputConfig';", MODULE);

// 2) onElement(): arrancar el reloj junto con el timer del click.
replace(
    'hook start en onElement',
    "        if (_hoverTimeoutMs !== 0) {\n            _hoverMap[element] = setTimeout(function () {",
    "        if (_hoverTimeoutMs !== 0) {\n            hoverClock.start(element, _hoverTimeoutMs);\n            _hoverMap[element] = setTimeout(function () {"
);

// 3) offElement(): cancelar el reloj si el mouse se va antes de completar.
replace(
    'hook stop en offElement',
    "        L.removeClass(element, 'mouseentered');\n        clearTimeout(_hoverMap[element]);",
    "        L.removeClass(element, 'mouseentered');\n        hoverClock.stop();\n        clearTimeout(_hoverMap[element]);"
);

// 4) destroy(): limpiar el reloj al apagar el modo hover.
replace(
    'hook stop en destroy',
    "    thiz.destroy = function () {",
    "    thiz.destroy = function () {\n        hoverClock.stop();"
);

fs.writeFileSync(file, s);
console.log('patch-hover-clock: reloj de dwell agregado OK.');
