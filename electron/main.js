const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const { getConfigDir } = require('../src/shared/paths');

// Todo lo que Chromium/Electron genera solo (Cache, GPUCache, Local
// Storage, Session Storage, blob_storage, IndexedDB, Service Worker,
// Cookies, Preferences, etc.) se guarda por defecto suelto en la raíz de
// userData — es, de lejos, lo que más "ensucia" esa carpeta si alguien la
// abre desde el explorador de archivos, y no es nada que el jugador vaya
// a necesitar tocar a mano. Se lo redirige a una subcarpeta ("cache/")
// para que la raíz quede con solo lo que sí tiene sentido ver ahí. Tiene
// que ejecutarse antes de 'ready' (y antes de crear cualquier ventana),
// por eso está acá arriba, a nivel de módulo.
app.setPath('sessionData', path.join(app.getPath('userData'), 'cache'));

const offlineAuth = require('../src/auth/offlineAuth');
const microsoftAuth = require('../src/auth/microsoftAuth');
const accountManager = require('../src/auth/accountManager');
const faceCache = require('../src/auth/faceCache');
const instanceStore = require('../src/store/instanceStore');
const settingsStore = require('../src/store/settingsStore');
const storageInfo = require('../src/store/storageInfo');
const versionManager = require('../src/core/versionManager');
const loaderManager = require('../src/core/loaderManager');
const launcher = require('../src/core/launcher');
const launcherImporter = require('../src/core/launcherImporter');
const modrinthApi = require('../src/api/modrinthApi');
const modInstaller = require('../src/api/modInstaller');
const serverListStore = require('../src/store/serverListStore');
const { pingServer } = require('../src/core/serverPing');
const { setupAutoUpdater } = require('./updater');
const discordPresence = require('./discordPresence');
const onlinePresence = require('../src/core/onlinePresence');

// BUG FIX (videos de YouTube en descripciones de proyecto no reproducen —
// "Error 153: Video player configuration error"): además de reactivar el
// header referrer del lado del iframe (ver ProjectDetailView.jsx), el otro
// factor que dispara este error puntualmente en apps de Electron es servir
// el build ya empaquetado con mainWindow.loadFile(), que carga todo bajo el
// esquema file:// — un origen "null"/opaco para Chromium. El reproductor de
// YouTube trata ese origen como no confiable y rechaza el embed con el
// mismo error 153, incluso con el referrer bien configurado. Se registra
// acá un esquema propio ('app://') como "privileged" (standard + secure,
// básicamente tratado como https por el motor) y se sirve el contenido de
// dist/ a través de él en vez de file://, para que el iframe de YouTube
// quede embebido en un origen real. Esto tiene que ejecutarse antes de
// 'ready' — por eso está a nivel de módulo y no dentro de app.whenReady().
const APP_SCHEME = 'app';
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ---------- Lag general "desde la segunda apertura en adelante" ----------
//
// Síntoma reportado: la primera vez que se abre el launcher en una PC anda
// fluido, pero al cerrarlo y volver a abrirlo (sin que haya mediado ningún
// crash) queda con todo lageado — no una pantalla puntual, sino la app
// entera, animaciones incluidas, durante toda esa sesión.
//
// Esto encaja exactamente con dos comportamientos de Chromium en Windows
// que no tienen que ver con nuestro propio "modo seguro" (ver
// startInSafeMode más abajo, que solo se activa tras un cierre sucio real
// y no es lo que dispara esto — se probó reproduciendo cierres normales uno
// atrás del otro y el marcador de sesión sí queda limpio):
//
// 1. CalculateNativeWinOcclusion: Windows le avisa a Chromium cuándo una
//    ventana queda tapada por otra (u oculta/minimizada) para que deje de
//    gastar CPU/GPU pintando algo que no se ve — pensado para pestañas de
//    Chrome en segundo plano. El tracker de oclusión de Windows tiene bugs
//    conocidos y bastante reportados (ventanas frameless como esta, con
//    barra de título propia, son un caso típico) donde queda "pegado"
//    pensando que la ventana sigue tapada/oculta después de haberla
//    cerrado y vuelto a abrir (o minimizado a la bandeja y restaurado), y
//    Chromium responde reduciendo el framerate del compositor de forma
//    persistente para esa ventana durante el resto de la sesión — exacto
//    al síntoma: todo se siente lageado, animaciones incluidas, y recién
//    se nota "desde que la volví a abrir". Se desactiva ese tracking acá
//    (no afecta nada más que esa heurística de ahorro de batería, que no
//    aporta nada en un launcher que casi siempre está en primer plano o
//    en la bandeja del todo).
//
// 2. disable-gpu-process-crash-limit: por default, si el proceso de GPU se
//    cae más de un puñado de veces en poco tiempo, Chromium se rinde y
//    pasa a renderizado por software para el resto de esa sesión — sin
//    avisar nada visible más que "todo se puso lento". Un GPUCache recién
//    escrito (de la sesión anterior, ver redirección de sessionData más
//    abajo) que todavía esté siendo liberado por el SO/antivirus justo al
//    arrancar de nuevo es un disparador común de un par de caídas
//    puntuales del proceso de GPU en el arranque — que hoy alcanzan para
//    tirar abajo la aceleración por hardware el resto de la sesión aunque
//    el proceso de GPU se recupere solo enseguida. Se le saca ese límite
//    para que un par de caídas transitorias en el arranque no condenen
//    toda la sesión a ir por software.
//
// Tienen que ejecutarse antes de 'ready' (y antes de crear cualquier
// ventana), por eso van acá arriba a nivel de módulo, junto con el resto de
// los ajustes que comparten esa misma restricción.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

let mainWindow;
let splashWindow;
let tray = null;
let trayPopup = null;
// Distingue "cerrar de verdad" (Salir desde el popup de la bandeja, Cmd+Q en
// mac, señales del SO, etc. — ver los distintos app.quit() del archivo) de
// "se tocó la cruz de la ventana", que ahora no cierra el launcher sino que
// lo manda a la bandeja (ver mainWindow.on('close', ...) en createWindow).
// Sin esta bandera, mainWindow.close() dentro de ese mismo handler de
// 'close' terminaría interceptándose a sí mismo en un loop: se necesita
// alguna forma de decir "esta vez sí, dejalo cerrar".
let isQuittingApp = false;
app.on('before-quit', () => {
  isQuittingApp = true;
});
const isDev = !app.isPackaged;

// ---------- Instancia única del proceso ----------
// BUG FIX ("a veces salen duplicados los del launcher" en el mostrador de
// íconos ocultos de Windows): el ícono de bandeja se crea una vez por
// PROCESO (ver createTray, más abajo, llamado desde app.whenReady). Nada
// impedía que el launcher se abriera dos veces a la vez — doble clic al
// acceso directo de nuevo mientras ya está minimizado en la bandeja, o
// estar configurado para iniciar con el sistema y encima abrirlo a mano —
// y cada apertura es un proceso de Electron totalmente aparte que llega a
// su propio app.whenReady() y crea su propio ícono de bandeja, sin que
// ninguno de los dos procesos sepa que el otro existe. Resultado: dos
// íconos "Hard Launcher" conviviendo en la bandeja en vez de uno solo.
//
// requestSingleInstanceLock() es el mecanismo estándar de Electron para
// esto: el primer proceso en pedirlo se queda con el lock; cualquier
// proceso que arranque después lo pierde de inmediato (gotTheLock ===
// false acá abajo) y se cierra ya mismo, sin llegar a crear ventana ni
// tray propios — así nunca hay un segundo ícono que crear. El proceso
// original se entera de ese segundo intento vía 'second-instance' y en vez
// de ignorarlo trae al frente su propia ventana (restaurándola si estaba
// minimizada), el mismo comportamiento de Discord/Steam al "abrirlos" con
// la app ya corriendo. Esto tiene que resolverse ANTES de app.whenReady()
// y de crear cualquier ventana o tray, por eso va acá arriba de todo.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  // El módulo entero (imports pesados de más abajo, definición de
  // app.whenReady().then(() => { ...createWindow(); createTray()... }),
  // etc.) seguiría ejecutándose igual después de este app.quit() si no se
  // corta acá: quit() solo AVISA a Electron que cierre, no interrumpe el
  // resto del script de forma síncrona. Sin este return, el proceso
  // perdedor del lock alcanzaría a crear su propia ventana y su propio
  // ícono de bandeja de todos modos antes de terminar de cerrarse —
  // exactamente el ícono duplicado que se busca evitar. main.js se carga
  // como módulo CommonJS (ver "main" en package.json), así que un
  // `return` a este nivel es válido: corta el resto del archivo para este
  // proceso sin tocar nada del proceso que sí se quedó con el lock.
  return;
}
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ---------- BUG FIX: íconos "H" fantasma/duplicados en la bandeja ----------
// El single-instance lock de arriba ya evita que dos PROCESOS corran a la
// vez, así que no es la causa de los varios íconos "H" apilados en el
// desplegable de "íconos ocultos" de Windows (ver captura reportada). La
// causa real es otra: `npm run dev` levanta `electron .` bajo
// `concurrently` (ver scripts en package.json), y cada vez que se corta esa
// sesión con Ctrl+C en la terminal, concurrently reenvía la señal
// (SIGINT/SIGTERM) directo al proceso de Electron. Node.js termina el
// proceso ante esa señal de inmediato por default, SIN pasar por
// app.quit() — que es lo único que dispara 'before-quit' y, con él,
// destroyTray() (ver más abajo). El ícono de bandeja de ese proceso recién
// muerto queda "fantasma": Windows lo sigue mostrando en el desplegable
// hasta que alguien pasa el mouse por encima o se reinicia el Explorador,
// y cada reinicio en caliente de una sesión de desarrollo (Ctrl+C + volver
// a correr `npm run dev`) suma uno más — exactamente la fila repetida de
// "H" de la captura.
//
// Se capturan las señales acá y se llama a app.quit() en vez de dejar que
// el proceso se muera solo: así SÍ pasa por el flujo normal de cierre (y
// por lo tanto por destroyTray()) sin importar si el reinicio vino de
// cerrar la ventana o de un Ctrl+C en la terminal.
//
// Esto sólo previene que se sigan acumulando ÍCONOS NUEVOS de acá en
// adelante — los que ya quedaron fantasma de sesiones de desarrollo
// anteriores a este fix no los limpia ningún código corriendo ahora (son
// bitmaps cacheados por el Explorador de un proceso que ya no existe): se
// van solos pasándoles el mouse por encima uno por uno, o reiniciando el
// Explorador de Windows (Administrador de tareas → buscar "Explorador de
// Windows" → Reiniciar), o con el próximo reinicio de la PC.
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => app.quit());
});

// ---------- Recuperación automática ante crashes (GPU/drivers) ----------
//
// Síntoma típico en PCs con drivers de video viejos/raros: la ventana se
// pone negra, deja de responder, y la app termina cayéndose — sin que en tu
// propia PC (con otro hardware) se reproduzca nunca. Como a la persona que
// le pasa esto no le podemos pedir que abra una consola, se resuelve solo:
// 1. Si la sesión anterior no cerró "limpio" (ver writeCrashMarker), esta
//    vez arranca en modo seguro (sin aceleración por GPU) automáticamente.
// 2. Cualquier caída del proceso de renderizado, del proceso de GPU, o un
//    error no manejado del proceso principal, queda anotada en un archivo
//    de texto en el Escritorio — para poder pedírselo a quien le pasó y
//    entender qué fue sin acceso remoto a esa PC.
const sessionMarkerPath = path.join(getConfigDir(), 'session-marker.json');

function readSessionMarker() {
  try {
    return JSON.parse(fs.readFileSync(sessionMarkerPath, 'utf-8'));
  } catch {
    return { cleanExit: true, safeMode: false };
  }
}

function writeSessionMarker(partial) {
  try {
    fs.writeFileSync(sessionMarkerPath, JSON.stringify({ ...readSessionMarker(), ...partial }));
  } catch {
    /* si ni esto se puede escribir, no hay mucho más para hacer acá */
  }
}

function writeCrashLog(title, details) {
  try {
    const logPath = path.join(app.getPath('desktop'), 'HardLauncher-error.txt');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${title}\n${details}\n\n`);
  } catch {
    /* sin Escritorio accesible (permisos raros, etc.) no es crítico */
  }
}

const previousSession = readSessionMarker();
// safeMode manual (ver toggle en Ajustes) prende esto para siempre hasta que
// se desactive a mano; cleanExit=false (la sesión anterior se cortó mal) lo
// prende UNA vez, para intentar recuperarse solo del próximo arranque.
const startInSafeMode = previousSession.safeMode || previousSession.cleanExit === false;
if (startInSafeMode) app.disableHardwareAcceleration();
// Se marca "sucia" desde ya: si el cierre es normal (ver app.on('before-quit')
// más abajo), se vuelve a poner en limpio. Si la app se cae antes de llegar
// ahí, queda así — y por eso el PRÓXIMO arranque activa el modo seguro solo.
writeSessionMarker({ cleanExit: false });

const SPLASH_MIN_MS = 1700;
// Duración de la transición de salida del splash (ver .frame.exit en
// splash.html): tiene que coincidir con la del CSS, porque es lo que le dice
// a destroy() cuánto esperar antes de cerrar la ventana de verdad. Si se
// desalinean, o se corta la animación a mitad de camino (valor muy chico) o
// la ventana (ya invisible al ojo pero technically todavía viva) queda dando
// vueltas de más (valor muy grande).
const SPLASH_EXIT_MS = 600;
// Cuánto se le deja a la barra de progreso llegar de verdad al 100% (clase
// .done) antes de arrancar el fade/scale/blur de salida del frame entero.
// Sin esta pausa, "done" y "exit" arrancarían en el mismo instante y el
// usuario nunca llega a ver la barra completarse.
const SPLASH_DONE_MS = 280;

// Mismo tamaño que PREMIUM_FACE_SIZE en AccountAvatar.jsx: si estos dos
// números se desalinean, la URL que pide el proceso principal para
// precargar (abajo) ya no sería la misma que la que arma el renderer, y el
// caché de faceCache.js nunca haría match con lo que realmente se termina
// mostrando.
const PREMIUM_FACE_SIZE = 128;

// Textura completa (64x64, con ambas capas) para esta cuenta, si hay una
// resoluble sin salir a un servicio de terceros — o null si no hay. Esto es
// justo lo que faceCache/getFace cachea en disco bajo la clave `account.id`
// para que AccountAvatar.jsx la recorte él mismo con background-position
// (ver layerBg en ese archivo, que asume un sprite de 64x64 con la cara en
// 8,8 y el overlay en 40,8). A propósito NO incluye el respaldo de
// mc-heads (ver discordFaceUrl más abajo): esa cara viene YA recortada a
// 128x128, no es una hoja de skin completa, así que cachearla bajo esta
// misma clave rompía el recorte de layerBg — se muestra en blanco casi
// siempre porque el recorte cae fuera de la imagen real. Ver
// faceCacheKeyFor/remoteUrlFor en AccountAvatar.jsx, que sigue exactamente
// esta misma regla del lado del renderer.
function fullSkinFaceUrl(account) {
  if (account.type === 'premium' && account.skinUrl) return account.skinUrl;
  // Una skin propia (offline) queda guardada como data URL local, no una
  // URL remota: no tiene nada que faceCache pueda ir a buscar por red, así
  // que se evita el intento (ver faceCache.js/fetchAsDataUrl, que solo sabe
  // pedir http/https).
  if (account.skinUrl && account.skinUrl.startsWith('data:')) return null;
  return account.skinUrl || null;
}

// Mejor URL disponible para MOSTRAR la cara del jugador como insignia
// chica de la Rich Presence de Discord (ver discordPresence.js /
// game:launch más abajo). Discord no recorta nada de su lado: la URL que
// se le pasa se muestra tal cual, achicada, en el círculo — por eso NO
// alcanza con fullSkinFaceUrl de arriba (esa devuelve la TEXTURA COMPLETA
// de 64x64, pensada para que el propio launcher la recorte con CSS en
// AccountAvatar.jsx). Pasarle esa textura completa a Discord mostraría la
// hoja de skin entera (de frente, de costado, brazos...) apachurrada en el
// círculo chico, no una cara.
//
// mc-heads sí devuelve la cara YA recortada, pero solo sabe resolverla por
// UUID/nombre de una cuenta de Mojang real — no hay forma de pedirle que
// recorte una URL de skin arbitraria (Ely.by, un archivo local subido a
// mano). Por eso esto solo funciona para cuentas premium con uuid; el
// resto se queda sin cara en la Rich Presence (solo el logo grande) en vez
// de mandarle a Discord algo que se vería mal.
function discordFaceUrl(account) {
  if (account.type === 'premium' && account.uuid) {
    return `https://mc-heads.net/avatar/${account.uuid}/${PREMIUM_FACE_SIZE}/true`;
  }
  return null;
}

// ---------- Isotipo (logo) del launcher: siempre la versión SIN fondo ----------
// Todo el launcher (splash, ícono de ventana, bandeja/"íconos ocultos", y el
// propio TitleBar.jsx dentro de la app) usa el mismo par de PNG recortados
// sin fondo (logo-mark.png / logo-mark-purple.png) en vez de la variante con
// fondo — así el ícono se ve como un isotipo "recortado" en cualquier lugar
// donde Windows lo dibuje (barra de tareas, Alt+Tab, Administrador de
// tareas, desplegable de íconos ocultos), en vez de un cuadrado con relleno
// detrás. resolveAccentLogoPath centraliza esa elección para los tres
// consumidores de acá abajo (createSplash, createWindow, createTray), todos
// leyendo el mismo settingsStore.accentColor que ya usa el resto de la app
// (ver AppearanceSection en SettingsModal.jsx) para elegir entre las dos.
function currentAccentColor() {
  try {
    return settingsStore.getSettings().accentColor || 'red';
  } catch {
    // settingsStore puede no estar listo todavía en algún arranque raro;
    // ante la duda, se cae al rojo de siempre.
    return 'red';
  }
}

function resolveAccentLogoPath(accent) {
  const filename = accent === 'purple' ? 'logo-mark-purple.png' : 'logo-mark.png';
  const packed = path.join(__dirname, 'assets', filename);
  const fromSrc = path.join(__dirname, '../src/renderer/assets', filename);
  // Antes el último recurso era assets/icon.png (la versión CON fondo) —
  // ahora que icon.png en sí también es la variante sin fondo (ver
  // regeneración de build/icon.png y electron/assets/icon.png), este
  // fallback sigue siendo consistente con "siempre sin fondo" aunque
  // ninguno de los dos logo-mark exista por algún motivo.
  const fallback = path.join(__dirname, 'assets/icon.png');
  if (fs.existsSync(packed)) return packed;
  if (fs.existsSync(fromSrc)) return fromSrc;
  return fallback;
}

function resolveSplashLogo() {
  return resolveAccentLogoPath(currentAccentColor());
}

// ---------- "Iniciar con el sistema" ----------
// Registra (o saca) a Hard Launcher de los programas que Windows/macOS/Linux
// arrancan solos al iniciar sesión, usando la API nativa de Electron para
// esto (app.setLoginItemSettings) — no hace falta tocar el Registro de
// Windows a mano ni nada por el estilo. El ajuste en sí vive en
// settingsStore (ver defaults.launchAtStartup) para que el toggle de
// Ajustes > Comportamiento lo pueda leer/mostrar como cualquier otro, pero
// como esto es una configuración del propio sistema operativo (no algo que
// el launcher "recuerde" solo), hay que además avisarle al SO cada vez que
// cambia — v.g. ipcMain.handle('settings:update') más abajo — y una vez
// al arrancar, para que ambos lados (el valor guardado y lo que el SO tiene
// registrado de verdad) no se desincronicen si alguien lo desinstaló o
// reinstaló el launcher en el medio.
//
// isDev se salta a propósito: en desarrollo esto registraría el propio
// binario de Electron (no un "Hard Launcher.exe" real) como programa de
// inicio, que no tiene ningún sentido y ensuciaría el inicio de sesión de
// quien esté programando.
function applyLoginItemSettings(enabled) {
  if (isDev) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
    });
  } catch (err) {
    console.error('[applyLoginItemSettings] No se pudo registrar el inicio con el sistema:', err);
  }
}

function createSplash() {
  splashWindow = new BrowserWindow({
    // Mismo tamaño con el que arranca mainWindow (ver createWindow, más
    // abajo) en vez de una ventana chica centrada. Antes el splash era
    // 640x380 y el launcher de atrás ya estaba en 1280x800: al mostrar
    // mainWindow y recién ahí desvanecer/agrandar el splash (ver
    // revealMain/closeSplash), la ventana grande "se asomaba" de golpe por
    // los bordes del splash chico durante toda la transición, que se sentía
    // más un salto que una revelación. Con el mismo tamaño y el mismo
    // center:true de mainWindow, ambas quedan exactamente superpuestas y la
    // animación de salida de closeSplash() sí se ve como el launcher
    // "emergiendo" de la pantalla de carga, sin ningún salto de tamaño.
    width: 1280,
    height: 800,
    frame: false,
    // ANTES: transparent: true. Una ventana con transparencia real de
    // Windows (compuesta por el DWM a través del GPU) es una causa muy
    // conocida de que el compositor de escritorio se caiga en PCs con
    // drivers de video viejos/raros — cuando eso pasa, Windows muestra el
    // fondo de pantalla en negro (síntoma reportado) y esta misma ventana,
    // que depende de esa transparencia para dibujarse, se queda colgada sin
    // terminar de aparecer (el "queda cargando y no abre" reportado). El
    // .frame de splash.html ya es 100% opaco y cubre toda la ventana, así
    // que la transparencia real no aportaba nada más que las esquinas
    // redondeadas — y roundedCorners (abajo) ya las resuelve sin usar
    // composición GPU entre procesos.
    transparent: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    center: true,
    hasShadow: true,
    roundedCorners: true,
    // Mismo backgroundColor que mainWindow (ver createWindow más abajo): es
    // lo primero que se pinta antes de que cargue splash.html, y con las dos
    // ventanas superpuestas al mismo tamaño conviene que ni ese primer
    // instante desentone.
    backgroundColor: '#16181c',
    icon: resolveSplashLogo(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.webContents.on('did-finish-load', () => {
    const href = pathToFileURL(resolveSplashLogo()).href;
    let accent = 'red';
    try {
      accent = settingsStore.getSettings().accentColor || 'red';
    } catch {
      // ante la duda, rojo de siempre.
    }
    // #logo-inline es el logo grande a la izquierda del wordmark (ver
    // .brand-logo en splash.html) — la "H" de "Hard" es texto normal de
    // nuevo, el logo ya no vive metido adentro de la palabra.
    // La clase accent-purple en <body> es lo que hace que TODO lo rojo de
    // la pantalla (grilla, resplandor, barra, corchetes HUD, etc. — ver
    // body.accent-purple en splash.html) pase a morado junto con el logo,
    // en vez de que quede un logo morado sobre una pantalla que se quedó
    // en rojo.
    const script = `
      var inline = document.getElementById('logo-inline');
      if (inline) inline.src = ${JSON.stringify(href)};
      document.body.classList.toggle('accent-purple', ${JSON.stringify(accent)} === 'purple');
    `;
    splashWindow.webContents.executeJavaScript(script).catch(() => {});
  });
  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });
}

// Antes esto ocurría todo en el mismo tick: dejar de capturar clicks,
// bajarle el alwaysOnTop, hide() y destroy(), sin ninguna espera real de por
// medio. En la práctica eso significaba destruir la ventana antes de que el
// compositor llegara a pintar el frame ya oculto/transparente, lo que en
// Windows en particular podía dejar un "fantasma" del último frame del
// splash flotando encima del launcher, todavía capturando los clicks que en
// teoría ya debían pasar de largo (de ahí que el launcher pareciera
// "trabado" justo al terminar de cargar).
//
// Ahora la salida es un proceso con tres pasos separados en el tiempo:
//  1. Al toque: dejar de capturar mouse (por si el usuario hace click
//     mientras el splash todavía se está desvaneciendo, que le llegue al
//     launcher de atrás en vez de perderse contra el splash).
//  2. Reproducir la animación de salida en el propio HTML del splash
//     (barra al 100%, logo destella, y recién ahí todo el frame se
//     desvanece/agranda/difumina) — para que el launcher se sienta "emerger"
//     desde la pantalla de carga en vez de que esta simplemente desaparezca
//     de un tirón.
//  3. Recién cuando esa animación terminó de verdad (no antes), destruir la
//     ventana.
function closeSplash() {
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  const win = splashWindow;
  splashWindow = null;

  try {
    win.setIgnoreMouseEvents(true, { forward: true });
  } catch (_) {}

  const destroyNow = () => {
    if (win.isDestroyed()) return;
    try {
      win.setAlwaysOnTop(false);
      win.hide();
    } catch (_) {}
    win.destroy();
  };

  win.webContents
    .executeJavaScript(`document.getElementById('frame').classList.add('done');`)
    .catch(() => {});

  setTimeout(() => {
    if (win.isDestroyed()) return;
    win.webContents
      .executeJavaScript(`document.getElementById('frame').classList.add('exit');`)
      .catch(() => {});
    setTimeout(destroyNow, SPLASH_EXIT_MS);
  }, SPLASH_DONE_MS);
}

function createWindow() {
  createSplash();
  const splashStartedAt = Date.now();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#16181c',
    show: false,
    // Mismo centrado que el splash (ver createSplash): si quedaran en
    // posiciones distintas de la pantalla, la salida animada del splash
    // "revelaría" al launcher en un lugar y este aparecería efectivamente
    // en otro, rompiendo la ilusión de que uno emerge del otro.
    center: true,
    frame: false, // barra de título propia, en vez de la nativa de Windows
    // Isotipo sin fondo (ver resolveAccentLogoPath arriba), en el color de
    // acento que el jugador tenga elegido: esto es lo que Windows dibuja en
    // la barra de tareas, Alt+Tab y el Administrador de tareas. setIcon()
    // más abajo (ver ipcMain.handle('settings:update')) lo actualiza en
    // caliente si el acento cambia mientras la ventana ya está abierta, sin
    // hacer falta reiniciar el launcher.
    icon: resolveAccentLogoPath(currentAccentColor()),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Explícito (aunque ya es el valor por defecto) porque ahora importa
      // más que antes: es lo que hace que, con la ventana escondida en la
      // bandeja (ver mainWindow.on('close', ...) más abajo), Chromium
      // frene los timers/animaciones de este webContents en vez de seguir
      // trabajando como si estuviera a la vista.
      backgroundThrottling: true,
    },
  });

  let revealed = false;
  const revealMain = () => {
    if (revealed) return;
    revealed = true;
    const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashStartedAt));
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // Mostrar el launcher ANTES de arrancar la salida del splash (y no
      // después de destruirlo) es lo que produce el efecto de que "sale"
      // de la pantalla de carga: el splash sigue tapando todo un instante
      // más mientras el launcher ya está listo y visible debajo, y recién
      // ahí closeSplash() lo desvanece/agranda encima, revelándolo — en vez
      // del corte seco de antes (splash desaparece y solo entonces se
      // muestra el launcher).
      mainWindow.show();
      mainWindow.focus();
      closeSplash();
      if (isDev) {
        // IMPORTANTE: 'detach' abre una ventana de SO separada que puede robarle
        // el foco de teclado a la ventana principal (los inputs dejan de recibir
        // teclas). 'right' la acopla dentro de la misma ventana y evita ese bug.
        mainWindow.webContents.openDevTools({ mode: 'right' });
      }
    }, wait);
  };

  mainWindow.once('ready-to-show', revealMain);
  setTimeout(revealMain, 12000);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // Ver registro de APP_SCHEME más arriba: se sirve dist/ por 'app://' en
    // vez de con loadFile() (que hubiera quedado en file://) para que los
    // embeds de YouTube/Vimeo de las descripciones de proyecto tengan un
    // origen real y no se rompan con el error 153.
    mainWindow.loadURL(`${APP_SCHEME}://bundle/index.html`);
  }

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximizedChanged', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximizedChanged', false));

  // Avisa al renderer cada vez que la ventana del launcher vuelve a tener
  // foco (ej. el jugador alt-tabea de vuelta después de jugar, o vuelve de
  // la bandeja). Se usa como red de seguridad en la pestaña Mundos
  // (WorldsTab, ver InstanceDetailView.jsx): el refresco automático normal
  // pasa por game:exit, pero si el proceso del juego termina de una forma
  // que ese listener no llega a capturar (ej. Alt+F4 sobre la ventana del
  // juego, un crash que mata el proceso de forma abrupta, o el jugador
  // vuelve a esta ventana sin haber cerrado el juego todavía para chequiar
  // el progreso), reenfocar el launcher igual dispara una relectura fresca
  // de /saves — sin esto, la única forma de refrescar sería cambiar de
  // pestaña o reabrir el launcher entero.
  mainWindow.on('focus', () => mainWindow.webContents.send('window:focus'));

  // Cerrar con la cruz de la barra de título propia (ver window:close más
  // abajo, que termina llamando a mainWindow.close() y disparando esto) ya
  // no cierra el launcher: lo manda a la bandeja, igual que "Mantener
  // abierto" ya hace con hide() cuando el jugador entra a una partida (ver
  // game:launch más abajo) — el ícono de la bandeja sigue ahí (createTray
  // vive durante toda la vida de la app, no solo mientras la ventana está
  // oculta) para volver a abrirlo o para salir de verdad con "Salir" en su
  // menú. Solo se dispara al cerrar la ventana desde ATENTAS (isQuittingApp
  // en false); una vez que de verdad se está cerrando la app (tray → Salir,
  // antes de destruirlo también) 'before-quit' ya puso la bandera en true y
  // este handler deja pasar el close normal en vez de interceptarlo nunca.
  mainWindow.on('close', (event) => {
    if (isQuittingApp) return;
    event.preventDefault();
    mainWindow.hide();
    // Chromium ya suspende el compositing y frena (throttlea) timers y
    // rAF de una ventana oculta por su cuenta (backgroundThrottling, que
    // queda en su valor por defecto — true — en el webPreferences de
    // arriba); acá no hace falta nada más de este lado para que, estando
    // en la bandeja, no siga gastando CPU/GPU como si estuviera a la
    // vista. El resto del proceso principal (bandeja, Discord Rich
    // Presence, el conteo de "jugadores en línea") sigue corriendo igual
    // que antes, como cualquier otra app que vive en la bandeja.
  });
}

// Handler del esquema 'app://' (ver registro de APP_SCHEME más arriba):
// resuelve cada pedido contra un archivo real dentro de dist/, tratando la
// parte "host" de la URL (bundle) como ignorable y usando solo el pathname.
// Se valida que la ruta resuelta no se escape de dist/ (../../algo) antes de
// servirla, ya que en teoría un <a href> o fetch() malicioso dentro del
// contenido renderizado podría intentarlo.
function registerAppProtocol() {
  const distRoot = path.join(__dirname, '../dist');
  protocol.handle(APP_SCHEME, (request) => {
    const requestUrl = new URL(request.url);
    let relativePath = decodeURIComponent(requestUrl.pathname);
    if (!relativePath || relativePath === '/') relativePath = '/index.html';
    const resolved = path.normalize(path.join(distRoot, relativePath));
    if (!resolved.startsWith(distRoot)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(resolved).href);
  });
}

// ---------- Ícono de bandeja del sistema ----------
// El ícono vive en la bandeja (la "flechita" de íconos ocultos) todo el
// tiempo que el launcher está corriendo, igual que hace Discord — no solo
// mientras el juego está en curso con la ventana oculta. Se crea una única
// vez al arrancar la app (ver app.whenReady) y se destruye recién cuando la
// app termina de verdad (ver 'trayMenu:action' con action 'quit' y
// app.on('before-quit')), nunca al ocultar o volver a mostrar la ventana
// principal — así siempre está ahí disponible, aunque el launcher esté
// abierto y a la vista.
// Mismo isotipo sin fondo que la ventana y el splash (ver
// resolveAccentLogoPath), en vez de assets/icon.png a secas: así el ícono
// de la bandeja/"íconos ocultos" combina con el acento rojo/morado elegido,
// en vez de mostrar siempre el mismo cuadrado sin importar el ajuste.
function resolveTrayIconPath(accent) {
  return resolveAccentLogoPath(accent);
}

function buildTrayImage(accent) {
  let image = nativeImage.createFromPath(resolveTrayIconPath(accent));
  if (!image.isEmpty()) {
    // Tamaño clásico de ícono de bandeja en Windows/Linux; en pantallas de
    // alta densidad Electron sigue escalándolo bien porque el PNG fuente
    // es de resolución mucho más alta.
    image = image.resize({ width: 16, height: 16, quality: 'best' });
  }
  return image;
}

function destroyTrayPopup() {
  if (trayPopup && !trayPopup.isDestroyed()) trayPopup.destroy();
  trayPopup = null;
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  tray = new Tray(buildTrayImage(currentAccentColor()));
  tray.setToolTip('Hard Launcher');
  tray.on('click', () => showTrayPopup());
  tray.on('right-click', () => showTrayPopup());
  // 'double-click' no dispara 'click' aparte en algunas plataformas — se
  // cubre igual por las dudas, no debería tener ningún costo hacerlo.
  tray.on('double-click', () => showTrayPopup());
  tray.on('destroy', () => { tray = null; });
  return tray;
}

// Se llama cuando el jugador cambia el acento en Ajustes > Apariencia (ver
// ipcMain.handle('settings:update') más abajo), para que el ícono de la
// ventana (barra de tareas/Alt+Tab/Administrador de tareas) y el de la
// bandeja cambien de una sin necesitar reiniciar el launcher — mismo
// criterio que ya usa discordPresence.setAccentColor para la Rich Presence.
function applyAccentColorToIcons(accent) {
  const iconPath = resolveAccentLogoPath(accent);
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setIcon(iconPath);
    } catch (err) {
      console.error('[applyAccentColorToIcons] No se pudo actualizar el ícono de la ventana:', err);
    }
  }
  if (tray && !tray.isDestroyed()) {
    try {
      tray.setImage(buildTrayImage(accent));
    } catch (err) {
      console.error('[applyAccentColorToIcons] No se pudo actualizar el ícono de la bandeja:', err);
    }
  }
}

function destroyTray() {
  destroyTrayPopup();
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}

function createTrayPopup() {
  trayPopup = new BrowserWindow({
    width: 200,
    height: 176,
    show: false,
    frame: false,
    // Ver el mismo cambio y comentario en createSplash(): transparencia real
    // de ventana = riesgo de tirar abajo el compositor de Windows en placas
    // de video problemáticas. Esta ventana se abre cada vez que se toca el
    // ícono de la bandeja mientras el launcher sigue corriendo — más
    // seguido todavía que el splash — así que vale el mismo arreglo.
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#1c1d20',
    webPreferences: {
      preload: path.join(__dirname, 'trayPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  trayPopup.loadFile(path.join(__dirname, 'trayMenu.html'));
  // Se cierra solo apenas pierde el foco (clickear afuera), igual que
  // cualquier menú contextual nativo — si no, quedaría flotando arriba de
  // todo hasta que el usuario elija explícitamente una opción.
  trayPopup.on('blur', () => destroyTrayPopup());
  trayPopup.on('closed', () => { trayPopup = null; });
  return trayPopup;
}

// Calcula el punto de anclaje del popup y decide si conviene abrirlo para
// arriba o para abajo de ese punto — sin asumir de entrada "la bandeja
// siempre vive abajo" (cierto en Windows, pero no en Linux: GNOME/algunos
// KDE la tienen en el panel de ARRIBA de la pantalla).
//
// Anclaje: se prioriza tray.getBounds() (posición real del ícono) cuando
// devuelve algo válido — que es el caso normal en Linux (AppIndicator/
// StatusNotifierItem sí exponen la geometría del ícono) y en macOS. Solo
// cuando esos bounds vienen en (0,0,0,0) — el caso típico de Windows con el
// ícono escondido detrás de la flechita del área de notificación, donde
// Electron no puede resolver su posición real — se cae a la posición del
// cursor en el momento del click, que ahí sí es precisa.
function resolveTrayAnchor(trayBounds, cursorPoint) {
  const hasValidBounds = trayBounds && trayBounds.width > 0 && trayBounds.height > 0;
  if (hasValidBounds) {
    return {
      x: trayBounds.x + trayBounds.width / 2,
      y: trayBounds.y + trayBounds.height / 2,
      trayTop: trayBounds.y,
      trayBottom: trayBounds.y + trayBounds.height,
    };
  }
  return { x: cursorPoint.x, y: cursorPoint.y, trayTop: cursorPoint.y, trayBottom: cursorPoint.y };
}

function positionTrayPopup(win, anchor) {
  const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
  const work = display.workArea;
  const winBounds = win.getBounds();

  let x = Math.round(anchor.x - winBounds.width / 2);
  x = Math.max(work.x + 8, Math.min(x, work.x + work.width - winBounds.width - 8));

  // Si el ancla (ícono o cursor) cae en la mitad superior de la pantalla,
  // el panel/bandeja está arriba (GNOME, típico en Linux) y el popup se
  // abre hacia ABAJO; si cae en la mitad inferior (Windows, la mayoría de
  // paneles de KDE/XFCE), se abre hacia ARRIBA, como antes.
  const anchorOnTopHalf = anchor.y < work.y + work.height / 2;
  let y = anchorOnTopHalf
    ? anchor.trayBottom + 10
    : anchor.trayTop - winBounds.height - 10;

  y = Math.max(work.y + 8, Math.min(y, work.y + work.height - winBounds.height - 8));

  win.setPosition(x, y, false);
}

function showTrayPopup() {
  if (!tray || tray.isDestroyed()) return;
  const anchor = resolveTrayAnchor(tray.getBounds(), screen.getCursorScreenPoint());
  // Si el popup ya está abierto (por ejemplo, se abrió con el click
  // izquierdo y ahora se clickeó con el derecho, o al revés), no lo cierra
  // como un toggle estricto — lo reposiciona y lo trae al frente. Antes
  // ambos botones llamaban a un toggle() que, si el popup ya estaba
  // abierto, lo cerraba en vez de mostrarlo: en la práctica eso hacía que
  // el segundo botón que se probara pareciera "no funcionar" (abrías con
  // uno y el otro solo lo cerraba). Ahora cualquiera de los dos clicks
  // siempre termina con el popup visible; solo se cierra clickeando afuera
  // (blur), con Escape, o eligiendo una opción.
  if (trayPopup && !trayPopup.isDestroyed()) {
    positionTrayPopup(trayPopup, anchor);
    trayPopup.show();
    trayPopup.focus();
    return;
  }
  const win = createTrayPopup();
  win.once('ready-to-show', () => {
    positionTrayPopup(win, anchor);
    win.show();
    win.focus();
  });
}

function showMainWindowFromTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

ipcMain.on('trayMenu:dismiss', () => destroyTrayPopup());
ipcMain.on('trayMenu:action', (_e, action) => {
  destroyTrayPopup();
  if (action === 'quit') {
    destroyTray();
    app.quit();
    return;
  }
  showMainWindowFromTray();
  if (action === 'home') mainWindow.webContents.send('nav:goto', '/');
  else if (action === 'instances') mainWindow.webContents.send('nav:goto', '/instances');
  else if (action === 'settings') mainWindow.webContents.send('nav:openSettings');
  // El ícono de bandeja NO se destruye acá: vive todo el tiempo que la app
  // está abierta (ver comentario arriba de createTray), no solo mientras
  // el launcher está oculto.
});

app.whenReady().then(() => {
  // Best-effort y una sola vez por arranque: renombra a nombres
  // distinguibles las carpetas de instancias creadas antes de este
  // cambio (ver migrateLegacyInstanceFolders en instanceStore.js). Va
  // antes de crear la ventana para que la UI ya liste los "dir"
  // actualizados desde el primer render, no a mitad de sesión.
  instanceStore.migrateLegacyInstanceFolders();
  if (!isDev) registerAppProtocol();
  createWindow();
  setupAutoUpdater(mainWindow, { isDev });
  discordPresence.init(settingsStore.getSettings().discordRichPresence, settingsStore.getSettings().accentColor);
  // Deja registrado (o saca) a Hard Launcher de los programas de inicio del
  // SO según lo que diga el ajuste guardado (ver BehaviorSection en
  // SettingsModal.jsx) — se re-aplica en cada arranque, no solo cuando el
  // jugador toca el toggle, para no desincronizarse con lo que el SO tenga
  // registrado de verdad (ver applyLoginItemSettings más arriba).
  applyLoginItemSettings(settingsStore.getSettings().launchAtStartup);
  // Contador de "jugadores en línea" (ver src/core/onlinePresence.js): no
  // hace nada si no hay credenciales de Supabase cargadas en
  // src/shared/onlinePresenceConfig.js. Cada actualización se reenvía tal
  // cual al renderer; si la ventana ya se cerró (por ej. justo en medio de
  // un cierre de la app) el guard de mainWindow evita mandarle a un
  // webContents ya destruido.
  onlinePresence.start(
    (count) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('onlinePlayers:update', count);
      }
    },
    // "Tu ping" del badge de Inicio (ver MinecraftServerList.jsx/SignalBars,
    // reutilizado ahí para pintarlo igual que un server de Multijugador):
    // no es el ping a NINGÚN server de Minecraft, sino la latencia de este
    // launcher contra el mismo servicio que alimenta el contador de arriba
    // (ver medirPing en onlinePresence.js).
    (ping) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('onlinePlayers:pingUpdate', ping);
      }
    }
  );
  // Ícono de bandeja persistente (ver comentario arriba de createTray):
  // arranca junto con la app, no recién cuando el launcher se oculta.
  createTray();
  // Se dispara en paralelo a la creación de la ventana, no después: para
  // cuando el renderer termine de montar y el usuario llegue a abrir el
  // selector de cuentas, la descarga de las caras (si hacía falta, ver
  // faceCache.js) ya lleva rato en curso en vez de recién arrancar ahí.
  // Dos precargas separadas, con la MISMA regla de claves que usa el
  // renderer (ver faceCacheKeyFor/remoteUrlFor en AccountAvatar.jsx): la
  // textura completa bajo `account.id` (la que después se recorta con
  // background-position) y, aparte, la cara ya recortada de mc-heads bajo
  // `account.id:mchead` para las cuentas premium sin skinUrl guardada. Si
  // esto se junta en una sola precarga bajo la misma clave, se vuelve a
  // meter la cara ya recortada donde el renderer espera una textura
  // completa para recortar — el bug original.
  faceCache.prefetchAll(accountManager.listAccounts(), fullSkinFaceUrl);
  faceCache.prefetchAll(
    accountManager.listAccounts().filter((acc) => acc.type === 'premium' && acc.uuid && !acc.skinUrl),
    (acc) => `https://mc-heads.net/avatar/${acc.uuid}/${PREMIUM_FACE_SIZE}/true`,
    (acc) => `${acc.id}:mchead`
  );
  app.on('activate', () => {
    // En mac, clickear el ícono del Dock con el launcher ya corriendo pero
    // escondido en la bandeja (ver mainWindow.on('close', ...) en
    // createWindow) tiene que traerlo de vuelta, no solo cubrir el caso
    // "no hay ninguna ventana" de siempre.
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindowFromTray();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => writeSessionMarker({ cleanExit: true }));
app.on('before-quit', () => onlinePresence.stop());

// Caída del proceso de renderizado (la ventana en sí) — el caso típico de
// "se puso todo negro y no respondía más" en PCs con drivers de GPU
// problemáticos.
app.on('render-process-gone', (_e, _wc, details) => {
  writeCrashLog(
    'Se cayó la ventana del launcher',
    `Razón: ${details.reason}\nCódigo de salida: ${details.exitCode}\nModo seguro estaba: ${startInSafeMode ? 'activado' : 'desactivado'}`
  );
});

// Caída de un proceso hijo de Electron — en la práctica, en el caso que nos
// interesa acá, casi siempre el proceso de GPU.
app.on('child-process-gone', (_e, details) => {
  writeCrashLog('Se cayó un proceso interno de Electron', `Tipo: ${details.type}\nRazón: ${details.reason}`);
});

// Cualquier excepción no atrapada en el proceso principal (fuera de un
// ipcMain.handle, que ya devuelve el error al renderer solo) — sin esto,
// antes simplemente tiraba la app abajo sin dejar rastro de qué pasó.
process.on('uncaughtException', (err) => {
  writeCrashLog('Error no manejado en el proceso principal', err?.stack || String(err));
});

// Por las dudas de que la app termine (Alt+F4 en la ventana principal
// mientras el ícono de bandeja seguía activo, señales del SO, etc.) sin
// pasar por el botón "Cerrar" del popup: sin esto el ícono podía quedar
// huérfano en la bandeja, ya sin ventana ni proceso detrás, hasta el
// próximo reinicio de sesión de Windows.
app.on('before-quit', () => destroyTray());

// ---------- IPC: Controles de ventana (barra de título propia) ----------
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:toggleMaximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow.close());
// Salida real del launcher, sin pasar por el "minimizar a la bandeja" de
// mainWindow.on('close', ...) — ver el comentario de quit() en preload.js.
// app.quit() ya dispara 'before-quit' (donde isQuittingApp pasa a true)
// ANTES de intentar cerrar las ventanas, así que para cuando le toque a
// mainWindow su propio 'close' ya va a dejarlo pasar de largo.
ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized());
ipcMain.handle('onlinePlayers:get', () => onlinePresence.getCount());
ipcMain.handle('onlinePlayers:getPing', () => onlinePresence.getPing());

// ---------- IPC: Cuentas ----------
ipcMain.handle('auth:createOffline', async (_e, username, skinUrl) => {
  const account = offlineAuth.createOfflineAccount(username, {
    skinUrl: skinUrl || null,
    skinSource: skinUrl ? 'url' : 'default',
  });
  accountManager.saveAccount(account);
  return account;
});

ipcMain.handle('auth:loginMicrosoft', async () => {
  const account = await microsoftAuth.login();
  accountManager.saveAccount(account);
  return account;
});

ipcMain.handle('auth:listAccounts', () => accountManager.listAccounts());
ipcMain.handle('auth:setActive', (_e, accountId) => accountManager.setActiveAccount(accountId));
ipcMain.handle('auth:removeAccount', (_e, accountId) => accountManager.removeAccount(accountId));
ipcMain.handle('auth:getActive', () => accountManager.getActiveAccount());

// Selector de skin LOCAL para cuentas offline/no-premium: antes la única
// forma de poner una cara propia era pegar una URL externa (Ely.by, NameMC),
// y si esa URL fallaba o no se cargaba nada, la cuenta se quedaba mostrando
// la cara genérica de NoSoyHard para siempre (ver AccountAvatar.jsx). Ahora
// se puede elegir directamente el archivo .png de la skin real de Minecraft
// desde el disco — se lee acá (el renderer no tiene acceso a fs) y se
// devuelve como data URL, que AccountAvatar ya sabe pintar recortando solo
// la cara de frente (capa base 8,8 + overlay/hat 40,8 de la textura),
// exactamente el mismo recorte "solo cara" que usa Crafatar para las
// cuentas premium.
ipcMain.handle('auth:pickSkinFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona tu skin de Minecraft (PNG)',
    properties: ['openFile'],
    filters: [{ name: 'Skin de Minecraft', extensions: ['png'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const buffer = fs.readFileSync(result.filePaths[0]);
  return `data:image/png;base64,${buffer.toString('base64')}`;
});

// Cambia la skin de una cuenta que ya existía (el botón "Cambiar skin" del
// modal de cuentas), sin tener que borrarla y crearla de nuevo.
ipcMain.handle('auth:updateSkin', (_e, accountId, skinUrl) => accountManager.updateAccountSkin(accountId, skinUrl));

// Ver src/auth/faceCache.js: devuelve lo que ya esté guardado en disco
// para esta cuenta al instante (o null si nunca se guardó nada todavía).
// Si hacía falta descargar o refrescar, esa descarga sigue en segundo
// plano y, al terminar, se avisa por el evento 'auth:faceUpdated' — el
// renderer que llamó es quien decide qué hacer con eso (ver
// AccountAvatar.jsx), acá no se sabe ni importa desde qué parte del
// launcher se pidió.
ipcMain.handle('auth:getFace', (event, accountId, remoteUrl) =>
  faceCache.getFace(accountId, remoteUrl, (dataUrl) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('auth:faceUpdated', { accountId, dataUrl });
    }
  })
);

// ---------- IPC: Servidores recomendados ----------
// Lista fija de servidores definida en código (ver
// src/store/serverListStore.js) — reemplaza al panel de sponsors/ads del
// home. A propósito NO hay handlers para agregar/quitar servidores desde
// acá: la única forma de cambiar la lista es editando ese archivo. Consultar
// el estado en vivo (serverPing.js, protocolo Server List Ping) sigue
// siendo una operación separada, nunca se guarda, porque cambia todo el
// tiempo.
ipcMain.handle('recommendedServers:list', () => serverListStore.listServers());

ipcMain.handle('recommendedServers:ping', (_e, host, port) => pingServer(host, port));

// A diferencia de arriba (la lista en sí es de solo lectura, fija en
// código), esto SÍ modifica algo del lado del jugador: agrega uno de esos
// servidores fijos al servers.dat de cada instancia que ya tenga creada,
// para el botón "Agregar a todas las instancias" del server en Inicio.
ipcMain.handle('recommendedServers:addToAllInstances', (_e, serverId) => {
  const server = serverListStore.listServers().find((s) => s.id === serverId);
  if (!server) throw new Error('Servidor no encontrado.');
  return instanceStore.addServerToAllInstances(server);
});

// ---------- IPC: Ajustes generales y almacenamiento ----------
// Enlaces externos (Modrinth, código fuente, wiki, Discord, etc.) del
// detalle de un proyecto: se abren en el navegador del sistema, nunca
// adentro de la propia ventana del launcher (que no tiene barra de
// direcciones ni forma de "volver" de una navegación así). Se valida que
// sea http(s) antes de pasárselo a shell.openExternal — el renderer no
// tiene por qué tener permiso de abrir rutas file:// u otros esquemas.
// BUG FIX (los botones de enlace externo -Discord/Wiki/Código fuente/Ver en
// Modrinth- no llevan a ningún lado): shell.openExternal() delega en el
// manejador de protocolos por default del sistema operativo (en Windows el
// asociado a "https", en macOS el navegador default, en Linux xdg-open más
// abajo). En varias distros de Linux ese mecanismo falla de forma
// silenciosa o rechaza la promesa aunque haya un navegador instalado —
// típicamente porque falta la asociación MIME para http/https en
// xdg-mime, porque $BROWSER no está seteado, o porque xdg-open termina
// resolviendo a una herramienta (gio, gvfs-open, kde-open) que no está
// presente en el sistema — sin que eso signifique que no hay forma de abrir
// el enlace. Antes de resignarse a copiar el link al portapapeles (ver
// fallback en el catch), se intenta invocar directamente al abridor nativo
// de cada plataforma como segunda vía.
function openWithNativeCommand(url) {
  return new Promise((resolve, reject) => {
    let command;
    let args;
    if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      // 'start' es un comando interno de cmd.exe, no un ejecutable — hace
      // falta invocarlo a través de cmd. El primer argumento vacío es el
      // título de la ventana que 'start' espera cuando el comando siguiente
      // viene entre comillas.
      command = 'cmd.exe';
      args = ['/c', 'start', '""', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    execFile(command, args, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

ipcMain.handle('system:openExternal', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  // BUG FIX: shell.openExternal() devuelve una Promise que puede rechazar
  // (por ejemplo si el SO no tiene un navegador/handler por default
  // configurado, o el esquema no está asociado a nada). Antes no se
  // esperaba esa promesa ni se atrapaba el error: el handler ya había
  // devuelto `true` al renderer (que mostraba el click como "exitoso")
  // mientras el rechazo quedaba como una unhandled promise rejection
  // perdida en el proceso principal — el resultado visible para la
  // persona era exactamente "no lleva a ningún lado" al hacer click en
  // Discord/Wiki/Código fuente/etc., sin ningún error ni feedback. Ahora
  // se espera de verdad y, si falla, se intenta el comando nativo de la
  // plataforma como segunda vía antes de reportarle la falla al renderer.
  try {
    await shell.openExternal(url);
    return true;
  } catch (err) {
    console.error('[system:openExternal] shell.openExternal falló, probando comando nativo:', url, err);
    try {
      await openWithNativeCommand(url);
      return true;
    } catch (fallbackErr) {
      console.error('[system:openExternal] No se pudo abrir el enlace:', url, fallbackErr);
      return false;
    }
  }
});

ipcMain.handle('settings:get', () => settingsStore.getSettings());

// El modo seguro (sin aceleración por GPU) tiene que decidirse ANTES de que
// Electron esté "ready" (ver arriba de todo el archivo), así que no puede
// vivir solo en settingsStore como el resto de los ajustes — se guarda
// también en el mismo archivo chico que ya se lee en ese punto tan
// temprano. Acá se expone nada más para que el toggle de Ajustes pueda leer
// y escribir ese valor.
ipcMain.handle('app:getSafeMode', () => readSessionMarker().safeMode || false);
ipcMain.handle('app:setSafeMode', (_e, value) => {
  writeSessionMarker({ safeMode: value });
  return value;
});

ipcMain.handle('settings:update', (_e, partial) => {
  const updated = settingsStore.updateSettings(partial);
  // Ver electron/discordPresence.js: si el toggle de "Discord Rich Presence"
  // cambió, se conecta/desconecta ahí mismo, sin esperar a que se reinicie
  // el launcher.
  if (Object.prototype.hasOwnProperty.call(partial, 'discordRichPresence')) {
    discordPresence.setEnabled(partial.discordRichPresence);
  }
  // Ver electron/discordPresence.js: el logo de la Rich Presence sigue al
  // color de acento (rojo/morado) elegido en Ajustes > Apariencia, sin
  // esperar a que se reinicie el launcher.
  if (Object.prototype.hasOwnProperty.call(partial, 'accentColor')) {
    discordPresence.setAccentColor(partial.accentColor);
    // Ídem para el ícono de la ventana (barra de tareas/Alt+Tab/
    // Administrador de tareas) y el de la bandeja: ver applyAccentColorToIcons.
    applyAccentColorToIcons(partial.accentColor);
  }
  // "Iniciar con el sistema" (ver BehaviorSection en SettingsModal.jsx):
  // se aplica ya mismo contra el SO, sin esperar a que se reinicie el
  // launcher, igual que el resto de los toggles de Comportamiento.
  if (Object.prototype.hasOwnProperty.call(partial, 'launchAtStartup')) {
    applyLoginItemSettings(partial.launchAtStartup);
  }
  return updated;
});
ipcMain.handle('system:getTotalMemoryMB', () => Math.floor(os.totalmem() / (1024 * 1024)));
ipcMain.handle('system:getVersion', () => app.getVersion());
ipcMain.handle('storage:info', () => storageInfo.getStorageInfo());
ipcMain.handle('storage:openFolder', (_e, folderPath) => storageInfo.openFolder(folderPath));
ipcMain.handle('settings:pickJavaExecutable', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona el ejecutable de Java (java o javaw)',
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle('instances:list', () => instanceStore.listInstances());
ipcMain.handle('instances:reorder', (_e, orderedIds) => instanceStore.reorderInstances(orderedIds));
ipcMain.handle('instances:create', (_e, data) => instanceStore.createInstance(data));
ipcMain.handle('instances:duplicate', (_e, id) => instanceStore.duplicateInstance(id));
ipcMain.handle('instances:update', (_e, id, data) => instanceStore.updateInstance(id, data));
ipcMain.handle('instances:delete', (_e, id) => instanceStore.deleteInstance(id));
// BUG FIX: antes esto devolvía el registro guardado tal cual, sin mirar
// nunca el disco. Si mods/resourcepacks/shaders/datapacks se agregaban de
// una forma que no pasara por las funciones de instalación de la app (por
// ejemplo arrastrando el .jar a mano a la carpeta de la instancia desde el
// explorador de archivos del sistema), la pestaña "Contenido" los mostraba
// vacíos aunque el juego sí los cargara. scanInstanceContent reconcilia el
// registro contra lo que hay realmente en disco antes de devolver la
// instancia — se llama tanto al abrir la pestaña como al apretar
// "Refrescar".
ipcMain.handle('instances:get', (_e, id) => modInstaller.scanInstanceContent(id));
ipcMain.handle('instances:getSize', (_e, id) => instanceStore.getInstanceSize(id));
ipcMain.handle('instances:openFolder', (_e, id) => instanceStore.openInstanceFolder(id));
ipcMain.handle('instances:listWorlds', (_e, id) => instanceStore.listWorlds(id));
// Arrastrar y soltar una carpeta de mundo o un .zip sobre "Mundos" (ver
// WorldsTab, InstanceDetailView.jsx): la ruta ya viene resuelta desde el
// propio evento "drop" del renderer (File.path), así que no hay diálogo
// nativo que abrir — instanceStore.importWorld hace la extracción/copiado.
ipcMain.handle('instances:importWorld', (_e, id, sourcePath) => instanceStore.importWorld(id, sourcePath));
ipcMain.handle('instances:duplicateWorld', (_e, id, worldPath) => instanceStore.duplicateWorld(id, worldPath));
ipcMain.handle('instances:renameWorld', (_e, id, worldPath, newName) =>
  instanceStore.renameWorld(id, worldPath, newName)
);
ipcMain.handle('instances:updateWorldSettings', (_e, id, worldPath, changes) =>
  instanceStore.updateWorldSettings(id, worldPath, changes)
);
ipcMain.handle('instances:deleteWorld', (_e, id, worldPath) => instanceStore.deleteWorld(id, worldPath));
ipcMain.handle('instances:openWorldFolder', (_e, id, worldPath) => instanceStore.openWorldFolder(id, worldPath));
// Exportar un mundo listo para servidor: el diálogo "guardar como" vive acá
// (no en instanceStore, que no tiene acceso a BrowserWindow) para elegir
// dónde va a parar el .zip; si el jugador cancela el diálogo, se devuelve
// null en vez de tirar error, así el botón del renderer sabe distinguir
// "cancelado" de "algo salió mal".
ipcMain.handle('instances:exportWorldForServer', async (_e, id, worldPath, worldName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar mundo para servidor',
    defaultPath: `${(worldName || 'mundo').replace(/[\\/:*?"<>|]/g, '_')}-server.zip`,
    filters: [{ name: 'Archivo ZIP', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return null;
  return instanceStore.exportWorldForServer(id, worldPath, result.filePath);
});
// Importar una instancia completa desde un .hlpack que alguien más exportó
// (ver instanceStore.importInstancePackage). El diálogo nativo vive acá por
// la misma razón que el de arriba.
ipcMain.handle('instances:importPackage', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar instancia',
    properties: ['openFile'],
    filters: [{ name: 'Paquete de Hard Launcher', extensions: ['hlpack', 'zip'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return instanceStore.importInstancePackage(result.filePaths[0]);
});
ipcMain.handle('instances:listScreenshots', (_e, id) => instanceStore.listScreenshots(id));
ipcMain.handle('instances:deleteScreenshot', (_e, id, filePath) => instanceStore.deleteScreenshot(id, filePath));
ipcMain.handle('instances:showScreenshotInFolder', (_e, id, filePath) =>
  instanceStore.showScreenshotInFolder(id, filePath)
);
ipcMain.handle('instances:readImageAsDataUrl', (_e, id, filePath) => instanceStore.readImageAsDataUrl(id, filePath));

// ---------- IPC: Versiones de Minecraft ----------
ipcMain.handle('versions:list', async () => versionManager.getVersionManifest());
ipcMain.handle('loaders:list', async (_e, loader, mcVersion) => loaderManager.listLoaderVersions(loader, mcVersion));

// ---------- IPC: Modrinth ----------
ipcMain.handle('modrinth:search', async (_e, params) => modrinthApi.search(params));
ipcMain.handle('modrinth:project', async (_e, idOrSlug) => modrinthApi.getProject(idOrSlug));
ipcMain.handle('modrinth:versions', async (_e, idOrSlug, params) => modrinthApi.getProjectVersions(idOrSlug, params));
ipcMain.handle('modrinth:categories', async () => modrinthApi.getCategories());
ipcMain.handle('modrinth:loaders', async () => modrinthApi.getLoaders());
ipcMain.handle('modrinth:gameVersions', async () => modrinthApi.getGameVersions());
ipcMain.handle('modrinth:installMod', async (_e, instanceId, versionData) => {
  return modInstaller.installProjectVersion(instanceId, versionData, (progress) => {
    mainWindow.webContents.send('modrinth:installProgress', progress);
  });
});
ipcMain.handle('modrinth:toggleContent', async (_e, instanceId, fileName, enabled) =>
  modInstaller.toggleContent(instanceId, fileName, enabled)
);
ipcMain.handle('modrinth:removeContent', async (_e, instanceId, fileName) =>
  modInstaller.removeContent(instanceId, fileName)
);
// Pestaña Contenido: completa autor/versión legible de lo ya instalado y
// devuelve qué archivos tienen una actualización pendiente.
ipcMain.handle('modrinth:refreshContentMeta', async (_e, instanceId) =>
  modInstaller.refreshContentMeta(instanceId)
);
ipcMain.handle('modrinth:updateContent', async (_e, instanceId, fileName) =>
  modInstaller.updateContentItem(instanceId, fileName, (progress) => {
    mainWindow.webContents.send('modrinth:installProgress', progress);
  })
);
// Cambio manual de versión (botón "swap" en la fila, cuando el mod NO tiene
// una actualización pendiente): instala la versión puntual que el usuario
// eligió en el modal, en vez de "la más nueva compatible".
ipcMain.handle('modrinth:changeContentVersion', async (_e, instanceId, fileName, versionId) =>
  modInstaller.changeContentVersion(instanceId, fileName, versionId, (progress) => {
    mainWindow.webContents.send('modrinth:installProgress', progress);
  })
);
ipcMain.handle('modrinth:updateAllContent', async (_e, instanceId) =>
  modInstaller.updateAllContent(instanceId, (progress) => {
    mainWindow.webContents.send('modrinth:installProgress', progress);
  })
);
ipcMain.handle('modrinth:toggleContentFreeze', async (_e, instanceId, fileName, frozen) =>
  modInstaller.toggleContentFreeze(instanceId, fileName, frozen)
);
ipcMain.handle('modrinth:installModpack', async (_e, mrpackPath, instanceName) =>
  modInstaller.installModpack(mrpackPath, instanceName, (progress) => {
    mainWindow.webContents.send('modrinth:installProgress', progress);
  })
);
// Paso "Install modpack" → "Search for modpack": instalar directo una
// versión encontrada en Modrinth, sin pasar por un archivo .mrpack local.
ipcMain.handle('modrinth:installModpackFromVersion', async (_e, versionData, instanceName) =>
  modInstaller.installModpackFromVersion(versionData, instanceName, (progress) => {
    mainWindow.webContents.send('modrinth:installProgress', progress);
  })
);
// Paso "Install modpack" → "Import modpack": elegir un .mrpack del disco.
ipcMain.handle('modrinth:pickMrpackFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona un archivo de modpack (.mrpack)',
    properties: ['openFile'],
    filters: [{ name: 'Modpack de Modrinth', extensions: ['mrpack'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
// Botón "Subir archivos" de la pestaña Contenido: deja elegir uno o más
// .jar/.zip locales y los copia + registra en la instancia.
// BUG FIX (el diálogo se abría siempre en una carpeta de Documentos sin
// relación con la instancia): al no pasarle `defaultPath` a
// dialog.showOpenDialog, Electron cae en la carpeta "Documentos" del
// sistema la primera vez (y después recuerda la última carpeta usada por
// CUALQUIER diálogo de la app, no una por tipo de contenido) — nunca
// apuntaba a la instancia en sí. Ahora se abre directo en la subcarpeta que
// corresponde al filtro activo en la pestaña Contenido (mods/resourcepacks/
// shaderpacks/datapacks) dentro de esa instancia puntual, creándola si
// todavía no existe para que el diálogo tenga dónde pararse.
ipcMain.handle('instances:addLocalFiles', async (_e, instanceId, contentType) => {
  const instance = instanceStore.getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  const folderName = modInstaller.folderForType(contentType);
  const defaultPath = path.join(instance.dir, folderName);
  fs.mkdirSync(defaultPath, { recursive: true });

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona mods o resource packs para agregar',
    defaultPath,
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Mods y Resource Packs', extensions: ['jar', 'zip'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  // BUG FIX: `contentType` (el filtro activo en la pestaña Contenido) ya se
  // usaba arriba para elegir la carpeta del diálogo, pero nunca se lo
  // pasábamos a addLocalFile — ahí el tipo se adivinaba solo por extensión
  // (.jar → mod, cualquier otra cosa → resourcepack), así que un shader o
  // datapack subido como .zip quedaba siempre mal clasificado como
  // resourcepack y no aparecía en su pestaña correspondiente.
  return result.filePaths.map((filePath) => modInstaller.addLocalFile(instanceId, filePath, contentType));
});

// Pestaña "Archivos" de la instancia: explorador de archivos integrado para
// ver/crear/renombrar/borrar/editar lo que hay dentro de su carpeta sin salir
// del launcher (mismo espíritu que el explorador de archivos que traen
// CurseForge App y Modrinth App). Todas las rutas relativas se resuelven y
// validan del lado de instanceStore (ver resolveInstancePath ahí), nunca acá.
ipcMain.handle('instances:listFiles', (_e, id, relativePath) => instanceStore.listInstanceFiles(id, relativePath));
ipcMain.handle('instances:createFolder', (_e, id, relativePath, name) =>
  instanceStore.createInstanceFolder(id, relativePath, name)
);
ipcMain.handle('instances:renamePath', (_e, id, relativePath, newName) =>
  instanceStore.renameInstancePath(id, relativePath, newName)
);
ipcMain.handle('instances:deletePaths', (_e, id, relativePaths) => instanceStore.deleteInstancePaths(id, relativePaths));
ipcMain.handle('instances:revealPath', (_e, id, relativePath) => instanceStore.revealInstancePath(id, relativePath));
ipcMain.handle('instances:openPath', (_e, id, relativePath) => instanceStore.openInstancePathExternally(id, relativePath));
ipcMain.handle('instances:readTextFile', (_e, id, relativePath) => instanceStore.readInstanceTextFile(id, relativePath));
ipcMain.handle('instances:writeTextFile', (_e, id, relativePath, content) =>
  instanceStore.writeInstanceTextFile(id, relativePath, content)
);
// "Subir archivos" de la pestaña Archivos: a diferencia de
// instances:addLocalFiles (que solo copia mods/resourcepacks/etc. a su
// carpeta fija y los registra como contenido), esto copia cualquier archivo
// suelto a la carpeta que se esté navegando en ese momento, sin más.
ipcMain.handle('instances:importFiles', async (_e, id, relativePath) => {
  const instance = instanceStore.getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const targetDir = instanceStore.resolveInstancePath(instance, relativePath);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona archivos para agregar',
    defaultPath: targetDir,
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  const copied = [];
  for (const filePath of result.filePaths) {
    const dest = path.join(targetDir, path.basename(filePath));
    fs.copyFileSync(filePath, dest);
    copied.push(path.basename(filePath));
  }
  return copied;
});

// Arrastrar y soltar archivos directamente sobre la pestaña Archivos (ver
// handleDrop en FilesTab, InstanceDetailView.jsx). Mismo destino y misma
// lógica de copiado que instances:importFiles de arriba, pero acá las
// rutas ya vienen resueltas desde el propio evento "drop" del renderer
// (File.path de cada archivo soltado) en vez de salir de
// dialog.showOpenDialog, así que no hay diálogo nativo que abrir.
ipcMain.handle('instances:importFilesFromPaths', async (_e, id, relativePath, filePaths) => {
  const instance = instanceStore.getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  const targetDir = instanceStore.resolveInstancePath(instance, relativePath);
  const copied = [];
  for (const filePath of filePaths) {
    try {
      // Las carpetas arrastradas se ignoran en vez de tirar abajo todo el
      // drop: fs.copyFileSync no soporta directorios y "Archivos" todavía
      // no tiene un flujo de copiado recursivo para armar uno acá.
      if (fs.statSync(filePath).isDirectory()) continue;
      const dest = path.join(targetDir, path.basename(filePath));
      fs.copyFileSync(filePath, dest);
      copied.push(path.basename(filePath));
    } catch {
      // Un archivo puntual que falla (ruta rara, permisos, etc.) no debería
      // cancelar el resto de los archivos soltados junto con él.
    }
  }
  return copied;
});

// Ajustes de instancia → Instalación → "Repair instance".
ipcMain.handle('instances:repair', async (_e, id) => {
  const instance = instanceStore.getInstance(id);
  if (!instance) throw new Error('Instancia no encontrada.');
  await launcher.repairInstance(
    instance,
    (data) => mainWindow.webContents.send('instances:repairProgress', data),
    (line) => mainWindow.webContents.send('instances:repairLog', line)
  );
  return true;
});

// Ajustes de instancia → Instalación → "Actualizar versión": antes de
// cambiar la versión/loader de la instancia, arma un preview de qué
// mods/resourcepacks/shaders se pueden actualizar solos y cuáles no (ver
// checkVersionUpdatePlan en modInstaller.js), para que el asistente del
// renderer pueda mostrarle al usuario la lista de "no compatibles" antes
// de aplicar nada.
ipcMain.handle('instances:checkVersionUpdate', async (_e, id, target) =>
  modInstaller.checkVersionUpdatePlan(id, target)
);
// Aplica el cambio de versión/loader ya confirmado por el usuario:
// `decision` solo importa si hubo contenido incompatible en el chequeo de
// arriba ('omitAndDelete' lo borra, cualquier otro valor lo deja instalado
// tal cual).
ipcMain.handle('instances:applyVersionUpdate', async (_e, id, target, decision) =>
  modInstaller.updateInstanceVersion(id, target, decision, (progress) => {
    mainWindow.webContents.send('instances:versionUpdateProgress', progress);
  })
);

// Paso "Import instance": ahora arranca revisando sola si hay algún
// launcher soportado (Prism/MultiMC/PolyMC/CurseForge/Modrinth) instalado
// en esta PC, en sus ubicaciones por defecto (ver launcherDefinitions() en
// core/launcherImporter.js), y le muestra al usuario las instancias que le
// encontró a cada uno para que elija cuáles importar con checkboxes.
ipcMain.handle('instances:detectLaunchers', async () => launcherImporter.detectInstalledLaunchers());

// Además del detectado automático, se puede seguir apuntando a mano a
// cualquier otra carpeta (un launcher instalado en otro lado, un pendrive,
// un backup, etc.): se abre el explorador de archivos y se escanea lo que
// el usuario eligió, sin importar nada todavía.
ipcMain.handle('instances:pickLauncherFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona la carpeta del launcher a importar',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle('instances:scanLauncherFolder', async (_e, folderPath) => launcherImporter.scanLauncherPath(folderPath));

// Import final: solo las instancias puntuales que el usuario tildó (de
// cualquier fuente — detectada sola o carpeta agregada a mano), no "todo lo
// que haya bajo esta carpeta" como antes.
ipcMain.handle('instances:importSelected', async (_e, instanceDirs) =>
  launcherImporter.importSelectedInstances(instanceDirs, (progress) => {
    mainWindow.webContents.send('instances:importProgress', progress);
  })
);

// ---------- IPC: Lanzamiento del juego ----------
// directConnect ({host, port} o null) llega desde el botón "Jugar" de un
// servidor recomendado en Inicio — hace que el juego entre directo a ese
// server (Quick Play Multiplayer / --server-port de respaldo en versiones
// viejas) en vez de abrir el menú principal. quickPlaySingleplayer (nombre
// de carpeta del mundo, o null) es el mismo mecanismo pero para el botón
// "Jugar" de un mundo puntual en la pestaña "Mundos" (ver
// InstanceDetailView.jsx) — nunca llegan los dos juntos. Ver core/launcher.js.
ipcMain.handle('game:launch', async (_e, instanceId, directConnect, quickPlaySingleplayer) => {
  const instance = instanceStore.getInstance(instanceId);
  let account = accountManager.getActiveAccount();
  if (!account) throw new Error('No hay ninguna cuenta activa seleccionada.');

  // Se marca "jugada" apenas se pide el lanzamiento, no recién cuando el
  // proceso del juego cierra (eso ya lo hace, aparte, core/launcher.js al
  // terminar): así, si algo más dispara un refreshInstances() de por medio
  // mientras el juego todavía está abriéndose (descargando la versión,
  // preparando Java, etc. — puede tardar), el timestamp guardado en disco
  // ya es el correcto y no pisa la actualización optimista que hace el
  // renderer al tocar "Jugar" (ver touchInstanceLastPlayed en store.js).
  instanceStore.updateInstance(instanceId, { lastPlayed: Date.now() });

  // BUG FIX ("pide iniciar sesión con Microsoft cada tanto y no deja jugar
  // en servidores"): el accessToken de una cuenta premium vence a las 24hs,
  // y hasta ahora nada lo refrescaba nunca — se lanzaba el juego siempre
  // con el mismo token del login original, así que en cuanto vencía (usando
  // el launcher varios días seguidos, o retomándolo después de un tiempo)
  // el juego arrancaba pero Minecraft rechazaba ese token vencido apenas se
  // intentaba entrar a un server (que sí lo valida contra los servidores de
  // sesión de Mojang), aunque el modo un jugador siguiera andando bien — de
  // ahí lo intermitente y lo de "no deja jugar en servidores" puntualmente.
  // Ahora se revisa ANTES de lanzar y, si falta poco para vencer (o ya
  // venció), se refresca solo con el refresh_token guardado (ver
  // microsoftAuth.js) sin volver a mostrarle la ventana de login al
  // jugador. Si el refresco en sí falla (refresh_token también vencido o
  // revocado — esto sí requiere volver a iniciar sesión de verdad) se deja
  // que el error se propague con un mensaje claro en vez de intentar jugar
  // igual con un token que se sabe inválido.
  if (microsoftAuth.needsRefresh(account)) {
    account = await microsoftAuth.refresh(account);
    accountManager.saveAccount(account);
    mainWindow.webContents.send('auth:accountsChanged');
  }

  discordPresence.setPlaying(instance.name, instance.mcVersion, {
    username: account.username,
    faceUrl: discordFaceUrl(account),
  });
  // Si ya se sabe a qué server se va a unir (botón "Jugar" de un servidor
  // recomendado, ver MinecraftServerList.jsx → directConnect.name), no hace
  // falta esperar al log del juego: se muestra en la Rich Presence desde ya.
  if (directConnect) {
    discordPresence.setServer(directConnect.host, directConnect.port || 25565, directConnect.name);
  }

  const result = await launcher.launch(instance, account, {
    onProgress: (data) => mainWindow.webContents.send('game:downloadProgress', data),
    onLog: (line) => mainWindow.webContents.send('game:log', line),
    // El jugador entró a un server desde el propio menú de Minecraft (no
    // vino de directConnect, ver CONNECTING_TO_RE en core/launcher.js). Si
    // ese host coincide con uno de los "Servidores recomendados", se usa su
    // nombre lindo en vez del host pelado.
    onServerConnect: ({ host, port }) => {
      const known = serverListStore.listServers().find((s) => s.host === host);
      discordPresence.setServer(host, port, known?.name);
    },
    // El jugador se fue del server sin unirse a otro ni cerrar el juego
    // (ver DISCONNECTED_RE en core/launcher.js) — la Rich Presence vuelve a
    // mostrar la instancia en vez de quedarse pegada al server anterior.
    onServerDisconnect: () => discordPresence.clearServer(),
    onExit: (code) => {
      discordPresence.setIdle();
      mainWindow.webContents.send('game:exit', code);

      // .restore() por sí solo puede dejar la ventana "visible" pero sin
      // foco ni al frente en algunos gestores de ventanas (Windows incluido
      // en ciertos casos), dando la sensación de que "no volvió".
      //
      // Si "Mantener abierto" está desactivado, más abajo (fuera de este
      // hook) se hizo hide() apenas arrancó el juego — hay que deshacer eso
      // acá. isVisible() cubre ese caso y también el de que el usuario haya
      // usado "cerrar a la bandeja" a mano durante la partida; isMinimized()
      // el minimize() clásico, por si lo minimizó a mano con "Mantener
      // abierto" sí activado. Si el usuario se mandó a la bandeja a
      // propósito con "Mantener abierto" activado, se respeta eso.
      if (!settingsStore.getSettings().keepLauncherOpenWhilePlaying &&
          (!mainWindow.isVisible() || mainWindow.isMinimized())) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
      }

      // Bug: con "Mantener launcher abierto mientras juego" activado, la
      // ventana queda VISIBLE (nunca se oculta, ver hide() más abajo) todo
      // el tiempo que Minecraft tiene el foco/pantalla completa. Chromium
      // suele dejarla en un estado "visible pero sin responder a input"
      // después de que otra ventana tuvo foco/exclusividad de pantalla un
      // buen rato — se ve como si el launcher se hubiera "congelado" (no
      // reacciona a ningún click) hasta cerrarlo y reabrirlo del todo.
      // Antes, el show()+focus() de arriba sólo corría cuando la ventana
      // estaba oculta/minimizada, así que este caso (visible todo el
      // tiempo) nunca lo disparaba. focus() fuerza a Chromium a
      // redibujar/re-registrar el foco de verdad y saca a la ventana de
      // ese estado, así que se llama siempre que la ventana esté visible,
      // sin importar si "Mantener abierto" está activado o no.
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      }
    },
  }, directConnect || null, quickPlaySingleplayer || null);

  // Si el usuario prefiere no ver el launcher mientras juega, recién acá
  // (una vez que el proceso del juego arrancó de verdad, no antes, para no
  // perderse el progreso de descarga/preparación) se oculta del todo — no
  // un minimize() de sistema operativo normal, que dejaría un botón
  // ocupando lugar en la barra de tareas. hide() saca la ventana de la
  // barra de tareas por completo; el ícono de la bandeja (ver createTray,
  // ya activo desde que arrancó la app) es desde donde se puede volver a
  // abrir el launcher.
  //
  // Antes esto se evaluaba una sola vez, con lo cual si el proceso de Java
  // fallaba en arrancar por cualquier motivo silencioso, o si el usuario
  // cambiaba el ajuste mientras la descarga previa estaba en curso, el
  // launcher podía quedar sin ocultarse. Se vuelve a leer el ajuste acá
  // (fresco desde disco, no cacheado) justo antes de aplicarlo para asegurar
  // que siempre respete el valor más reciente.
  const keepOpen = settingsStore.getSettings().keepLauncherOpenWhilePlaying;
  if (!keepOpen) {
    mainWindow.hide();
  }

  return result;
});

// Cierra el proceso del juego de una instancia (ver launcher.stopInstance) y
// espera a que termine de verdad antes de resolver. Lo usa InstanceDetailView
// cuando el jugador pide "entrar" a un servidor con la MISMA instancia que ya
// está corriendo: se reinicia esa instancia ya conectada, en vez de intentar
// (inútilmente) avisarle al proceso viejo que se conecte a otro lado.
ipcMain.handle('game:stop', (_e, instanceId) => launcher.stopInstance(instanceId));
