const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

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

let mainWindow;
let splashWindow;
let tray = null;
let trayPopup = null;
const isDev = !app.isPackaged;

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
const sessionMarkerPath = path.join(app.getPath('userData'), 'session-marker.json');

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

function accountFaceUrl(account) {
  if (account.type === 'premium' && account.uuid) {
    return `https://crafatar.com/avatars/${account.uuid}?size=${PREMIUM_FACE_SIZE}&overlay`;
  }
  // Una skin propia (offline) queda guardada como data URL local, no una
  // URL remota: no tiene nada que faceCache pueda ir a buscar por red, así
  // que se evita el intento (ver faceCache.js/fetchAsDataUrl, que solo sabe
  // pedir http/https).
  if (account.skinUrl && account.skinUrl.startsWith('data:')) return null;
  return account.skinUrl || null;
}

function resolveSplashLogo() {
  const packed = path.join(__dirname, 'assets/logo-mark.png');
  const fromSrc = path.join(__dirname, '../src/renderer/assets/logo-mark.png');
  const icon = path.join(__dirname, 'assets/icon.png');
  if (fs.existsSync(packed)) return packed;
  if (fs.existsSync(fromSrc)) return fromSrc;
  return icon;
}

function createSplash() {
  splashWindow = new BrowserWindow({
    // Antes 520x300: se sentía chico y apretado al lado del wordmark y la
    // barra. Este tamaño le da más aire al diseño (ver splash.html, cuyos
    // elementos internos se agrandaron en la misma proporción).
    width: 640,
    height: 380,
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
    backgroundColor: '#111214',
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.webContents.on('did-finish-load', () => {
    const href = pathToFileURL(resolveSplashLogo()).href;
    splashWindow.webContents
      .executeJavaScript(`document.getElementById('logo').src = ${JSON.stringify(href)};`)
      .catch(() => {});
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
    // Versión CON fondo del logo: en la barra de tareas de Windows/el dock
    // de macOS se ve como un ícono cuadrado normal, no recortado sobre lo
    // que sea que haya detrás. La versión sin fondo queda para el interior
    // de la propia app (ver TitleBar.jsx), donde ya hay un fondo oscuro
    // consistente detrás de ella.
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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
function resolveTrayIconPath() {
  const packed = path.join(__dirname, 'assets/icon.png');
  if (fs.existsSync(packed)) return packed;
  return path.join(__dirname, '../src/renderer/assets/logo-mark.png');
}

function destroyTrayPopup() {
  if (trayPopup && !trayPopup.isDestroyed()) trayPopup.destroy();
  trayPopup = null;
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const iconPath = resolveTrayIconPath();
  let image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) {
    // Tamaño clásico de ícono de bandeja en Windows/Linux; en pantallas de
    // alta densidad Electron sigue escalándolo bien porque el PNG fuente
    // es de resolución mucho más alta.
    image = image.resize({ width: 16, height: 16, quality: 'best' });
  }
  tray = new Tray(image);
  tray.setToolTip('Hard Launcher');
  tray.on('click', () => showTrayPopup());
  tray.on('right-click', () => showTrayPopup());
  // 'double-click' no dispara 'click' aparte en algunas plataformas — se
  // cubre igual por las dudas, no debería tener ningún costo hacerlo.
  tray.on('double-click', () => showTrayPopup());
  tray.on('destroy', () => { tray = null; });
  return tray;
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
  if (!isDev) registerAppProtocol();
  createWindow();
  setupAutoUpdater(mainWindow, { isDev });
  discordPresence.init(settingsStore.getSettings().discordRichPresence);
  // Ícono de bandeja persistente (ver comentario arriba de createTray):
  // arranca junto con la app, no recién cuando el launcher se oculta.
  createTray();
  // Se dispara en paralelo a la creación de la ventana, no después: para
  // cuando el renderer termine de montar y el usuario llegue a abrir el
  // selector de cuentas, la descarga de las caras (si hacía falta, ver
  // faceCache.js) ya lleva rato en curso en vez de recién arrancar ahí.
  faceCache.prefetchAll(accountManager.listAccounts(), accountFaceUrl);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => writeSessionMarker({ cleanExit: true }));

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
ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized());

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
ipcMain.handle('instances:create', (_e, data) => instanceStore.createInstance(data));
ipcMain.handle('instances:duplicate', (_e, id) => instanceStore.duplicateInstance(id));
ipcMain.handle('instances:update', (_e, id, data) => instanceStore.updateInstance(id, data));
ipcMain.handle('instances:delete', (_e, id) => instanceStore.deleteInstance(id));
ipcMain.handle('instances:get', (_e, id) => instanceStore.getInstance(id));
ipcMain.handle('instances:getSize', (_e, id) => instanceStore.getInstanceSize(id));
ipcMain.handle('instances:openFolder', (_e, id) => instanceStore.openInstanceFolder(id));
ipcMain.handle('instances:listWorlds', (_e, id) => instanceStore.listWorlds(id));
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
ipcMain.handle('instances:listScreenshots', (_e, id) => instanceStore.listScreenshots(id));
ipcMain.handle('instances:deleteScreenshot', (_e, id, filePath) => instanceStore.deleteScreenshot(id, filePath));
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
ipcMain.handle('instances:addLocalFiles', async (_e, instanceId) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona mods o resource packs para agregar',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Mods y Resource Packs', extensions: ['jar', 'zip'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths.map((filePath) => modInstaller.addLocalFile(instanceId, filePath));
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

// Paso "Import instance": elegir la carpeta de otro launcher (Prism/
// MultiMC/PolyMC/CurseForge) desde la que importar.
ipcMain.handle('instances:pickLauncherFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona la carpeta del launcher a importar',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle('instances:importFromLauncherPath', async (_e, launcherPath) =>
  launcherImporter.importInstances(launcherPath, (progress) => {
    mainWindow.webContents.send('instances:importProgress', progress);
  })
);

// ---------- IPC: Lanzamiento del juego ----------
// directConnect ({host, port} o null) llega desde el botón "Jugar" de un
// servidor recomendado en Inicio — hace que el juego entre directo a ese
// server (Quick Play Multiplayer / --server-port de respaldo en versiones
// viejas) en vez de abrir el menú principal. Ver core/launcher.js.
ipcMain.handle('game:launch', async (_e, instanceId, directConnect) => {
  const instance = instanceStore.getInstance(instanceId);
  const account = accountManager.getActiveAccount();
  if (!account) throw new Error('No hay ninguna cuenta activa seleccionada.');

  discordPresence.setPlaying(instance.name, instance.mcVersion);

  const result = await launcher.launch(instance, account, {
    onProgress: (data) => mainWindow.webContents.send('game:downloadProgress', data),
    onLog: (line) => mainWindow.webContents.send('game:log', line),
    onExit: (code) => {
      discordPresence.setIdle();
      mainWindow.webContents.send('game:exit', code);
      // .restore() por sí solo puede dejar la ventana "visible" pero sin
      // foco ni al frente en algunos gestores de ventanas (Windows incluido
      // en ciertos casos), dando la sensación de que "no volvió". show() +
      // focus() la traen al frente de verdad, no solo le sacan el estado
      // de minimizada/oculta.
      //
      // isVisible() cubre el caso hide()-a-la-bandeja (ver más abajo) y
      // isMinimized() el minimize() clásico, por si el usuario lo minimizó
      // a mano por su cuenta con "Mantener abierto" activado.
      if (!settingsStore.getSettings().keepLauncherOpenWhilePlaying &&
          (!mainWindow.isVisible() || mainWindow.isMinimized())) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    },
  }, directConnect || null);

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
