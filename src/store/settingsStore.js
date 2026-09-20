const Store = require('electron-store');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getConfigDir } = require('../shared/paths');

const STORE_NAME = 'settings';

/**
 * ¿Primera vez que se abre el launcher en esta PC? electron-store no
 * escribe el .json a disco hasta el primer store.set() — así que "el
 * archivo todavía no existe" es exactamente "todavía nadie tiene ningún
 * ajuste guardado acá", sin necesitar un flag aparte.
 */
const settingsFile = path.join(getConfigDir(), `${STORE_NAME}.json`);
const isFirstRun = !fs.existsSync(settingsFile);

/**
 * RAM máxima recomendada para instancias nuevas, calculada a partir de la
 * RAM total de la PC: la mitad del total, redondeada a los 512 MB más
 * cercanos, con un piso de 1536 MB (para no dejar un valor demasiado bajo
 * en PCs con poca RAM) y un techo de 8192 MB (pasado eso no hay ganancia
 * real para Minecraft, y en una PC con muchísima RAM el launcher terminaría
 * arrancando con un valor exagerado que nadie pidió).
 */
function detectRecommendedMaxMemoryMb() {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  const half = Math.round(totalMb / 2 / 512) * 512;
  return Math.min(8192, Math.max(1536, half));
}

/** Mínima recomendada: un cuarto de la máxima, con un piso de 512 MB. */
function detectRecommendedMinMemoryMb(maxMb) {
  return Math.min(maxMb, Math.max(512, Math.round(maxMb / 4 / 256) * 256));
}

/**
 * Idioma por defecto según el sistema operativo del jugador, para no
 * arrancar siempre en español la primera vez que alguien abre el launcher.
 * No se usa app.getLocale() de Electron porque esa API sólo se puede llamar
 * después del evento 'ready' (ver docs de Electron), y este módulo corre a
 * nivel de import, antes de que la app esté lista — Intl, en cambio, ya
 * refleja el locale del sistema operativo (vía ICU) sin esa restricción.
 * Si el idioma del sistema no es ninguno de los 3 que tiene el launcher
 * (es/en/pt), se cae a inglés por ser el más general/entendido.
 */
function detectDefaultLanguage() {
  let systemLocale = '';
  try {
    systemLocale = Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch {
    systemLocale = '';
  }
  const primary = systemLocale.split('-')[0].toLowerCase();
  return primary === 'es' || primary === 'pt' ? primary : 'en';
}

// Estos tres solo se calculan a partir del hardware/sistema la PRIMERA vez:
// una vez que existe el archivo de settings, lo que haya guardado ahí (a
// mano, o de esta misma detección en un arranque anterior) manda siempre,
// sin que una futura versión del launcher que cambie esta cuenta le mueva
// el piso a nadie que ya lo haya abierto antes.
const recommendedMaxMb = isFirstRun ? detectRecommendedMaxMemoryMb() : 4096;
const recommendedMinMb = isFirstRun ? detectRecommendedMinMemoryMb(recommendedMaxMb) : 1024;
const detectedLanguage = isFirstRun ? detectDefaultLanguage() : 'es';

const store = new Store({
  name: STORE_NAME,
  cwd: getConfigDir(),
  defaults: {
    defaultMemoryMin: recommendedMinMb,
    defaultMemoryMax: recommendedMaxMb,
    defaultResolutionWidth: 854,
    defaultResolutionHeight: 480,
    defaultFullscreen: false,
    javaPathOverride: null,
    keepLauncherOpenWhilePlaying: true,
    discordRichPresence: true,
    // OLED es el tema principal/por defecto (fondo 100% negro, pensado para
    // pantallas OLED y para hacer resaltar más el acento) — 'dark', 'light'
    // y 'system' siguen disponibles para quien los prefiera, se eligen a
    // mano desde Ajustes > Apariencia.
    theme: 'oled', // 'dark' | 'oled' | 'light' | 'system'
    // Color de acento del launcher: 'red' es el rubí original, 'purple' es
    // la variante nueva (mismo logo, en violeta). Se guarda aparte del tema
    // de fondo (oled/dark/light/system) para poder combinarse libremente
    // con cualquiera de ellos — ver [data-accent='purple'] en theme.css.
    accentColor: 'red', // 'red' | 'purple'
    language: detectedLanguage, // 'es' | 'en' | 'pt'
    // Iniciar Hard Launcher junto con el sistema operativo (ver
    // applyLoginItemSettings en electron/main.js). Activado por defecto —
    // se puede desactivar desde Ajustes > Comportamiento en cualquier
    // momento (ver BehaviorSection en SettingsModal.jsx).
    launchAtStartup: true,

    // Versión del launcher (package.json → app.getVersion()) para la que
    // el usuario ya aceptó los Términos y Condiciones (ver TermsModal.jsx).
    // null = todavía no los aceptó nunca (primer arranque). El renderer
    // compara esto contra la versión actual en cada arranque: si no
    // coinciden (instalación nueva O el launcher se actualizó desde la
    // última vez que se aceptaron), se le vuelve a mostrar el modal antes
    // de dejarlo usar la app — ver checkTerms()/acceptTerms() en store.js.
    termsAcceptedVersion: null,

    // --- Valores por defecto "avanzados" para instancias nuevas (igual que
    // los "global overrides" de Modrinth App: Java arguments, variables de
    // entorno y launch hooks a nivel launcher, que cada instancia nueva
    // hereda y después puede pisar desde su propio panel de Ajustes). Se
    // guardan junto a customDefaultJvmArgs/etc. para no romper instancias
    // que ya existían antes de que estos ajustes existieran. ---
    defaultJvmArgs: '',
    defaultEnvVars: '',
    defaultPreLaunchHook: '',
    defaultWrapperHook: '',
    defaultPostExitHook: '',
  },
});

// Persiste ya mismo el valor detectado en vez de dejarlo flotando como
// "default en memoria" de electron-store (que sólo se usa mientras la
// clave no esté escrita en el .json): así queda guardado tal cual se
// detectó esta vez, y de ahí en más se lee de ahí como cualquier otro
// ajuste — incluido el propio isFirstRun de un futuro arranque, que ya va
// a dar false.
if (isFirstRun) {
  store.set({ defaultMemoryMin: recommendedMinMb, defaultMemoryMax: recommendedMaxMb, language: detectedLanguage });
}

function getSettings() {
  return store.store;
}

function updateSettings(partial) {
  store.set(partial);
  return store.store;
}

module.exports = { getSettings, updateSettings };
