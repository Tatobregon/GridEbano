// Voz natural OFFLINE con Voces Ebano (programa aparte, instalado en cada PC: 127.0.0.1:5555) — cambios
// al frontend de Grid.
//
//   (a) URL del servicio de voz externo POR DEFECTO, pero SOLO dentro de Comunicador Ebano (la app de
//       escritorio, con el motor de Edge: tiene window.chrome.webview) → usa Voces Ebano sin configurar
//       nada en cada PC. En Chrome/Edge común no: ahí pedirle algo a 127.0.0.1 muestra el permiso de
//       "acceso a la red local" a cada usuario. Se toma de la variable de entorno EBANO_VOZ_URL (vacía =
//       no poner valor por defecto).
//   (b) Reintento: si Grid arrancó antes que Voces Ebano (típico al prender la PC), vuelve a pedir las
//       voces cada pocos segundos hasta encontrarlas. Upstream solo las pide una vez al cargar.
//   (c) FALLBACK A LA VOZ DEL SISTEMA: si Voces Ebano no responde (caído, colgado, error), la frase se
//       dice igual con la voz de Windows. Upstream en ese caso NO dice nada (silencio total).
//   (d) La voz externa respeta el volumen configurado en Grid (upstream lo ignoraba).
//   (e) audioUtil: un solo AudioContext reutilizado (upstream crea uno nuevo por frase y no lo cierra)
//       y la promesa se resuelve también si el audio no se puede decodificar (upstream se colgaba).
//   (f) Ajustes: si la voz elegida no está cargada todavía, NO se reemplaza por "Automática".
//
// Todos los reemplazos usan anclas exactas: si upstream cambia, el build FALLA (no se aplica a medias).
const fs = require('fs');

const DEFAULT_URL = (process.env.EBANO_VOZ_URL === undefined ? 'http://127.0.0.1:5555' : process.env.EBANO_VOZ_URL).trim();
const done = [];

function patch(file, pairs) {
    let s = fs.readFileSync(file, 'utf8');
    for (const [label, anchor, replacement] of pairs) {
        const n = s.split(anchor).length - 1;
        if (n !== 1) {
            console.error(`patch-voz-local: ancla "${label}" encontrada ${n} veces en ${file} (se esperaba 1). ¿Cambió upstream? Abortando.`);
            process.exit(1);
        }
        s = s.replace(anchor, () => replacement);
        done.push(label);
    }
    fs.writeFileSync(file, s);
}

// ── (a) URL por defecto, solo en Comunicador Ebano ───────────────────────────────────────────────
if (DEFAULT_URL) {
    patch('src/js/model/SettingsApp.js', [[
        'url-por-defecto',
        'this.externalSpeechServiceUrl = settings.externalSpeechServiceUrl;',
        // undefined = nunca configurado → Voces Ebano, si es Comunicador Ebano; en un navegador común queda
        // como upstream (sin URL). "" = alguien lo borró a propósito → se respeta.
        `this.externalSpeechServiceUrl = settings.externalSpeechServiceUrl !== undefined ? settings.externalSpeechServiceUrl : (typeof window !== 'undefined' && window.chrome && window.chrome.webview ? ${JSON.stringify(DEFAULT_URL)} : undefined);`
    ]]);
}

// ── (c)(d) speak con timeout, resultado explícito y volumen; getVoices tolerante ──────────────────
{
    const file = 'src/js/service/speechServiceExternal.js';
    let s = fs.readFileSync(file, 'utf8');
    const start = 'speechServiceExternal.speak = async function (text, providerId, voice) {';
    const end = 'speechServiceExternal.getVoices = async function (url) {';
    if (s.split(start).length !== 2 || s.split(end).length !== 2 || s.indexOf(start) > s.indexOf(end)) {
        console.error('patch-voz-local: anclas de speechServiceExternal.speak no encontradas. Abortando.');
        process.exit(1);
    }
    const newSpeak = `/**
 * EBANO: devuelve true si sonó, false si falló (el llamador usa la voz del sistema) o null si fue
 * cancelado porque el usuario pidió otra frase.
 */
speechServiceExternal.speak = async function (text, providerId, voice) {
    if (!externalSpeechServiceUrl) {
        return false;
    }
    spokeAtAnyTime = true;
    let rawLength = (text || '').length;
    text = encodeURIComponent(text);
    providerId = encodeURIComponent(providerId);
    let voiceId = encodeURIComponent(voice.id);
    if (voice.type === constants.VOICE_TYPE_EXTERNAL_PLAYING) {
        fetchErrorHandling(\`\${externalSpeechServiceUrl}/speak/\${text}/\${providerId}/\${voiceId}\`);
        return true;
    }
    if (voice.type !== constants.VOICE_TYPE_EXTERNAL_DATA) {
        return false;
    }
    speakFetchController.abort();
    let controller = new AbortController();
    speakFetchController = controller;
    speakFetchSignal = controller.signal;
    let timedOut = false;
    // frases cortas: si en ~6-8 s no hay audio, se usa la voz del sistema. Textos largos: más margen.
    let timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, Math.min(6000 + 40 * rawLength, 45000));
    let superseded = () => controller.signal.aborted && !timedOut;
    try {
        let response = await fetchErrorHandling(
            \`\${externalSpeechServiceUrl}/speakdata/\${text}/\${providerId}/\${voiceId}\`,
            {
                signal: controller.signal,
                noLogErrorNames: ['AbortError']
            }
        );
        if (superseded()) {
            return null;
        }
        if (!response || !response.ok) {
            return false;
        }
        let buffer = await response.arrayBuffer();
        if (superseded()) {
            return null;
        }
        if (!buffer || buffer.byteLength === 0) {
            log.warn("got no data from external speech service.");
            return false;
        }
        clearTimeout(timer);
        let userSettings = localStorageService.getUserSettings();
        let volume = userSettings && typeof userSettings.systemVolume === 'number' ? userSettings.systemVolume / 100.0 : 1;
        let started = await audioUtil.playAudioUint8(buffer, {
            volume: volume,
            onended: () => {
                playingInternal = false;
            }
        });
        if (started === false) {
            return false;
        }
        playingInternal = true;
        return true;
    } catch (e) {
        if (superseded()) {
            return null;
        }
        log.warn('ebano: fallo la voz externa', e);
        return false;
    } finally {
        clearTimeout(timer);
    }
};

`;
    s = s.slice(0, s.indexOf(start)) + newSpeak + s.slice(s.indexOf(end));
    fs.writeFileSync(file, s);
    done.push('speak-con-fallback');

    patch(file, [[
        'getVoices-tolerante',
        'lastGetVoicesResult = result ? (await result.json()) : [];',
        `let parsedVoices = [];
    if (result) {
        try {
            let json = await result.json();
            parsedVoices = Array.isArray(json) ? json : [];
        } catch (e) {
            log.warn('ebano: respuesta de voces inválida', e);
        }
    }
    lastGetVoicesResult = parsedVoices;`
    ]]);
}

// ── (b)(c) speechService: fallback a voz del sistema + reintento de voces externas ────────────────
patch('src/js/service/speechService.js', [
    ['import-mainvue',
        "import voiceUtil from '../util/voiceUtil';",
        "import voiceUtil from '../util/voiceUtil';\nimport { MainVue } from '../vue/mainVue.js';"],
    ['fallback-en-speak',
        'speechServiceExternal.speak(text, externalVoices[0].ref.providerId, externalVoices[0]);',
        `let ebanoFallbackLang = externalVoices[0].langFull || langToUse;
        speechServiceExternal.speak(text, externalVoices[0].ref.providerId, externalVoices[0]).then((result) => {
            if (result === false) {
                ebanoSpeakWithSystemVoice(text, ebanoFallbackLang, options);
            }
        });`],
    ['reintento-voces',
        `    let externalVoices = await speechServiceExternal.getVoices();
    for (let voice of externalVoices) {
        addVoice(voice.id, voice.name, voice.lang, voice.type, voice.local || false, voice);
    }
    _initPromiseResolveFn();
}`,
        `    let externalVoices = await speechServiceExternal.getVoices();
    for (let voice of externalVoices) {
        addVoice(voice.id, voice.name, voice.lang, voice.type, voice.local || false, voice);
    }
    _initPromiseResolveFn();
    ebanoRetryExternalVoices(externalVoices.length);
}

// ── EBANO: voz del sistema si la voz externa falla ──
let _ebanoLastFallbackNotice = 0;
function ebanoSpeakWithSystemVoice(text, lang, options) {
    try {
        if (!speechService.nativeSpeechSupported()) {
            return;
        }
        let isNative = (v) => v.type === constants.VOICE_TYPE_NATIVE && !!v.ref;
        let candidates = getVoicesByLang(lang).filter(isNative);
        if (candidates.length === 0) {
            candidates = allVoices.filter((v) => isNative(v) && v.lang === i18nService.getBaseLang(lang));
        }
        let msg = new SpeechSynthesisUtterance(text);
        if (candidates.length > 0) {
            candidates.sort((a, b) => (b.local ? 1 : 0) - (a.local ? 1 : 0)); // offline primero
            msg.voice = candidates[0].ref;
            msg.lang = candidates[0].langFull || candidates[0].lang;
        } else {
            msg.lang = lang;
        }
        let userSettings = localStorageService.getUserSettings();
        msg.volume = userSettings.systemVolume / 100.0;
        msg.rate = (options && options.rate) || _voiceRate || 1;
        msg.addEventListener('start', () => {
            hasSpoken = true;
            isSpeakingNative = true;
        });
        msg.addEventListener('end', () => {
            isSpeakingNative = false;
        });
        msg.addEventListener('error', () => {
            isSpeakingNative = false;
        });
        window.speechSynthesis.speak(msg);
        log.warn('ebano: la voz natural no respondió, se usó la voz del sistema');
        if (Date.now() - _ebanoLastFallbackNotice > 30 * 60 * 1000) {
            _ebanoLastFallbackNotice = Date.now();
            MainVue.setTooltip('La voz natural no respondió: se está usando la voz del sistema.', {
                msgType: 'warn',
                closeOnNavigate: true,
                timeout: 6000
            });
        }
    } catch (e) {
        log.warn('ebano: también falló la voz del sistema', e);
    }
}

// ── EBANO: si Grid arrancó antes que el servidor de voces, reintentar hasta encontrarlas ──
let _ebanoRetryTimer = null;
function ebanoRetryExternalVoices(foundCount) {
    if (_ebanoRetryTimer) {
        clearTimeout(_ebanoRetryTimer);
        _ebanoRetryTimer = null;
    }
    if (foundCount > 0 || !localStorageService.getAppSettings().externalSpeechServiceUrl) {
        return;
    }
    let attempt = 0;
    let tryAgain = async () => {
        _ebanoRetryTimer = null;
        attempt++;
        let voices = [];
        try {
            voices = (await speechServiceExternal.getVoices()) || [];
        } catch (e) {
            voices = [];
        }
        if (voices.length > 0) {
            for (let voice of voices) {
                addVoice(voice.id, voice.name, voice.lang, voice.type, voice.local || false, voice);
            }
            log.info('ebano: voces externas disponibles tras reintento', attempt);
            return;
        }
        _ebanoRetryTimer = setTimeout(tryAgain, Math.min(3000 * attempt, 60000));
    };
    _ebanoRetryTimer = setTimeout(tryAgain, 3000);
}`]
]);

// ── (f) Ajustes: no borrar la voz elegida si todavía no cargó (ej. Voces Ebano arrancando) ────────
// Upstream la "corrige" a Automática si no la encuentra en la lista, y al guardar cualquier ajuste
// esa voz queda perdida aunque el servidor vuelva a los pocos segundos.
patch('src/vue-components/views/settings/settingsLanguage.vue', [[
    'no-borrar-voz-no-cargada',
    `            fixCurrentVoice(dontSave) {
                if (!this.selectVoices.map(v => v.id).includes(this.userSettingsLocal.voiceConfig.preferredVoice)) {`,
    `            fixCurrentVoice(dontSave) {
                let ebanoPref = this.userSettingsLocal.voiceConfig.preferredVoice;
                if (ebanoPref && !(this.voices || []).some(v => v.id === ebanoPref)) {
                    return; // EBANO: voz desconocida por ahora (servidor de voces no disponible): se conserva
                }
                if (!this.selectVoices.map(v => v.id).includes(this.userSettingsLocal.voiceConfig.preferredVoice)) {`
]]);

// ── (d)(e) audioUtil: AudioContext compartido, volumen y sin cuelgues ─────────────────────────────
{
    const file = 'src/js/util/audioUtil.js';
    let s = fs.readFileSync(file, 'utf8');
    const start = 'audioUtil.playAudioUint8 = function (arrayBuffer, options) {';
    const end = 'audioUtil.waitForAudioEnded = async function () {';
    if (s.split(start).length !== 2 || s.split(end).length !== 2 || s.indexOf(start) > s.indexOf(end)) {
        console.error('patch-voz-local: anclas de audioUtil.playAudioUint8 no encontradas. Abortando.');
        process.exit(1);
    }
    const newPlay = `let _ebanoAudioContext = null;
audioUtil.playAudioUint8 = function (arrayBuffer, options) {
    options = options || {};
    return new Promise((resolve) => {
        let context;
        try {
            if (!_ebanoAudioContext || _ebanoAudioContext.state === 'closed') {
                _ebanoAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            context = _ebanoAudioContext;
            if (context.state === 'suspended' && context.resume) {
                context.resume().catch(() => {});
            }
        } catch (e) {
            log.warn('error creating audio context', e);
            return resolve(false);
        }
        let source = context.createBufferSource();
        _currentAudioSource = source;
        let destination = context.destination;
        if (typeof options.volume === 'number' && options.volume >= 0 && options.volume < 1) {
            let gain = context.createGain();
            gain.gain.value = options.volume;
            gain.connect(context.destination);
            destination = gain;
        }
        source.connect(destination);
        let settled = false;
        let fail = (e) => {
            log.warn('error decoding audio', e);
            if (_currentAudioSource === source) {
                _currentAudioSource = null;
            }
            if (!settled) {
                settled = true;
                resolve(false);
            }
        };
        let play = (audioBuffer) => {
            source.buffer = audioBuffer;
            source.onended = () => {
                if (options.onended) {
                    options.onended();
                }
            };
            try {
                source.start(0);
            } catch (e) {
                return fail(e);
            }
            if (!settled) {
                settled = true;
                resolve(true);
            }
        };
        try {
            let p = context.decodeAudioData(arrayBuffer, play, fail);
            if (p && p.catch) {
                p.catch(() => {});
            }
        } catch (e) {
            fail(e);
        }
    });
};

`;
    s = s.slice(0, s.indexOf(start)) + newPlay + s.slice(s.indexOf(end));
    fs.writeFileSync(file, s);
    done.push('audio-context-compartido');
}

console.log('patch-voz-local: aplicado -> ' + done.join(', ') + (DEFAULT_URL ? ` (URL por defecto ${DEFAULT_URL})` : ' (sin URL por defecto)'));
