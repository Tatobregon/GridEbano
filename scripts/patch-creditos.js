// Patch de build (frontend): ventana de "Acerca de este comunicador" que se abre al tocar el logo.
//
// Muestra el agradecimiento a AsTeRICS y ARASAAC, los tres logos, y el link al código fuente (que
// el AGPL pide que esté a mano para quien usa la app).
//
// POR QUÉ ES HTML PLANO Y NO UN COMPONENTE DE VUE: se inyecta FUERA del <div id="app">, así no
// depende del ciclo de vida de Vue ni de que el CSS de los modales ya esté cargado. Los estilos
// replican los de src/css/modal.css (la misma pinta que las ventanas de configuración), con nombres
// propios (ebano-*) para no pisarle nada a la app.
//
// El logo llama a window.ebanoCreditos(); lo engancha scripts/patch-branding.js.
// Anclado en strings exactos del tag pineado: si no matchea, ABORTA el build.
const fs = require('fs');

const ANCLA = '<!-- browser compatibility checks and polyfills -->';
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');

if (s.includes('ebano-creditos')) {
    console.log('patch-creditos: ya aplicado, salteando.');
    process.exit(0);
}
if (!s.includes(ANCLA)) {
    console.error('patch-creditos: NO encontré el ancla en index.html. Abortando build.');
    process.exit(1);
}

const BLOQUE = `<!-- Ventana "Acerca de este comunicador" (se abre tocando el logo). Va FUERA de #app a propósito. -->
<div id="ebano-creditos" hidden>
  <div class="ebano-mask" data-cerrar="1">
    <div class="ebano-wrapper" data-cerrar="1">
      <div class="ebano-container" role="dialog" aria-modal="true" aria-labelledby="ebano-creditos-titulo">
        <a class="ebano-x" href="javascript:void(0)" data-cerrar="1" aria-label="Cerrar">&times;</a>
        <h1 id="ebano-creditos-titulo">Acerca de este comunicador</h1>
        <p class="ebano-sub">EBANO &mdash; desarrollando capacidades</p>
        <p class="ebano-texto">Este sistema de comunicaci&oacute;n aumentativa y alternativa se construy&oacute; a partir del
          c&oacute;digo fuente de AsTeRICS Grid, un proyecto de c&oacute;digo abierto dedicado a la accesibilidad.
          Agradecemos el trabajo de la comunidad de AsTeRICS y de ARASAAC por proveer la infraestructura
          tecnol&oacute;gica y los recursos pictogr&aacute;ficos que hacen posible esta herramienta.</p>
        <div class="ebano-logos">
          <img src="app/img/ebano-logo.png" height="54" alt="EBANO">
          <img src="app/img/asterics-aac-logo-raw.svg" height="40" alt="AsTeRICS AAC">
          <img src="app/img/arasaac.png" height="30" alt="ARASAAC">
        </div>
        <p class="ebano-pie">AsTeRICS Grid se distribuye bajo licencia AGPL-3.0. El c&oacute;digo de esta versi&oacute;n
          est&aacute; disponible en <a href="https://github.com/Tatobregon/GridEbano" target="_blank" rel="noopener">github.com/Tatobregon/GridEbano</a>.</p>
      </div>
    </div>
  </div>
</div>
<style>
  /* Mismos valores que src/css/modal.css, para que se vea igual que las ventanas de la app. */
  #ebano-creditos[hidden] { display: none; }
  #ebano-creditos .ebano-mask { position: fixed; z-index: 9999; top: 0; left: 0; width: 100%; height: 100%;
    background-color: rgba(0,0,0,.5); }
  /* El padding es para que en el celular la ventana no quede pegada a los bordes de la pantalla. */
  #ebano-creditos .ebano-wrapper { display: flex; justify-content: center; align-items: center; height: 100%; padding: 14px; box-sizing: border-box; }
  /* box-sizing explícito: sin esto el padding SE SUMA al ancho máximo y la ventana sale ~80px más
     ancha de la cuenta (el renglón de texto queda demasiado largo para leer cómodo). */
  #ebano-creditos .ebano-container { box-sizing: border-box; width: 100%; max-width: 660px; max-height: 85vh; margin: 0 auto;
    padding: 2em 2.6em; background-color: #fff; border-radius: 2px; box-shadow: 0 2px 8px rgba(0,0,0,.33);
    font-family: Helvetica, Arial, sans-serif; overflow-y: auto; overflow-x: hidden; }
  #ebano-creditos .ebano-x { float: right; padding: .5em 1em; color: #000; text-decoration: none;
    font-size: 1.3em; line-height: 1; }
  #ebano-creditos h1 { font-size: 1.5em; margin: 0 0 .2em; }
  #ebano-creditos .ebano-sub { color: #6b7280; font-size: .9rem; font-style: italic; margin: 0 0 1.6em; }
  #ebano-creditos .ebano-texto { font-size: 1rem; line-height: 1.6; color: #222; margin: 0 0 1.8em; }
  #ebano-creditos .ebano-logos { display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
    gap: 28px 38px; padding: 18px 10px; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
  #ebano-creditos .ebano-logos img { display: block; }
  #ebano-creditos .ebano-pie { font-size: .8rem; color: #6b7280; margin: 1.4em 0 0; line-height: 1.5; }
  #ebano-creditos .ebano-pie a { color: #2d7bb4; }
  @media (max-width: 850px) { #ebano-creditos .ebano-container { padding: 1.6em 1.4em; } }
</style>
<script type="text/javascript">
  (function () {
    var caja = document.getElementById('ebano-creditos');
    var antes = null;
    function abrir() {
      antes = document.activeElement;
      caja.hidden = false;
      var x = caja.querySelector('.ebano-x');
      if (x) { x.focus(); }
    }
    function cerrar() {
      caja.hidden = true;
      // Se devuelve el foco a donde estaba: importante para quien navega con teclado o barrido.
      if (antes && antes.focus) { try { antes.focus(); } catch (e) {} }
    }
    // Cerrar con la X, con un clic en cualquier parte del fondo oscuro, o con Escape. Generoso a
    // propósito: si un usuario la abre sin querer (por ejemplo con barrido o con el reloj de dwell),
    // tiene que poder salir tocando en cualquier lado.
    caja.addEventListener('click', function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-cerrar') === '1') { cerrar(); }
    });
    document.addEventListener('keydown', function (e) {
      if (!caja.hidden && (e.key === 'Escape' || e.keyCode === 27)) { cerrar(); }
    });
    window.ebanoCreditos = abrir;
  })();
</script>

`;

s = s.replace(ANCLA, BLOQUE + ANCLA);
fs.writeFileSync(file, s);
console.log('patch-creditos: ventana "Acerca de este comunicador" inyectada OK.');
