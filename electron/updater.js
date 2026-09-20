const { autoUpdater } = require('electron-updater');
const { ipcMain, app } = require('electron');
const axios = require('axios');

// ---------- Auto-actualización (electron-updater + GitHub Releases) ----------
//
// Cómo funciona en la práctica:
// 1. Cada vez que se publica una versión nueva con `npm run release` (ver
//    package.json), electron-builder sube los instaladores de cada SO más
//    los archivos de metadata (latest.yml para Windows, latest-linux.yml
//    para Linux, *.blockmap) a un Release de GitHub. El workflow de
//    GitHub Actions (.github/workflows/release.yml) corre ese build tanto
//    en windows-latest como en ubuntu-latest para el mismo tag.
// 2. Esta app, ya instalada en la PC de un jugador, chequea ese Release
//    (según "publish" en package.json) al arrancar y cada 4 horas mientras
//    sigue abierta.
// 3. Si hay una versión más nueva, la descarga en segundo plano (el jugador
//    puede seguir usando el launcher normalmente) y avisa por IPC al
//    renderer en cada paso, para que se muestre un toast/progreso (ver
//    UpdateToast.jsx).
// 4. Cuando termina de bajar, se le ofrece al jugador reiniciar para
//    aplicarla ("quitAndInstall"). Si no reinicia en el momento, se instala
//    sola la próxima vez que cierre el launcher del todo.
//
// LINUX (BUG FIX — el auto-updater "solo funcionaba en Windows"): había dos
// problemas separados, uno de infraestructura y uno de comportamiento:
//
//   a) El workflow de release solo corría en `windows-latest`, así que
//      nunca se subía NINGÚN instalador de Linux a los Releases de GitHub
//      (ni el paquete en sí ni el latest-linux.yml que electron-updater
//      necesita para comparar versiones). No importaba qué tan bien
//      estuviera escrito este archivo: no había nada que encontrar del
//      otro lado. Ya se agregó el build de Linux (AppImage + .deb) en
//      package.json y ubuntu-latest al workflow.
//
//   b) electron-updater SOLO sabe autoactualizar el formato AppImage en
//      Linux (su AppImageUpdater reemplaza el propio archivo .AppImage en
//      caliente). Un launcher instalado desde el .deb (o corrido "a mano"
//      sin empaquetar) no tiene forma de autoactualizarse así — ni con
//      privilegios de administrador, porque tocar archivos del sistema
//      instalados por dpkg desde un proceso sin privilegios no es un
//      camino confiable. Antes, en ese caso, `checkForUpdates()` terminaba
//      tirando un error genérico de electron-updater que el usuario veía
//      como "no se pudo buscar actualizaciones", sin más contexto. Ahora
//      se detecta ese caso (Linux + no-AppImage) ANTES de llamar a
//      autoUpdater, y se hace un chequeo manual liviano contra la API de
//      GitHub: si hay una versión más nueva, se avisa con un estado
//      'manual' (link directo a la Release para descargarla e instalarla
//      con el gestor de paquetes), en vez de intentar una descarga
//      automática que no puede completarse.
//
// IMPORTANTE: esto NO hace nada en `npm run dev`/`npm start` (electron-updater
// tira error "app not packed" a propósito) — solo funciona sobre la app
// empaquetada de verdad. Para probarlo en desarrollo hay que generar un
// build real con `npm run build` e instalarlo (o correr el AppImage).

const GITHUB_OWNER = 'whoishard';
const GITHUB_REPO = 'hardlauncher';

function send(mainWindow, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:event', payload);
  }
}

function isLinuxNonAppImage() {
  return process.platform === 'linux' && !process.env.APPIMAGE;
}

/** Compara versiones semver simples (x.y.z), sin dependencias extra. */
function isNewerVersion(latest, current) {
  const a = latest.replace(/^v/, '').split('.').map(Number);
  const b = current.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Chequeo manual contra la API pública de GitHub Releases, para el caso
 * Linux + no-AppImage (ver comentario grande arriba): no descarga nada,
 * solo informa si hay una versión más nueva y de dónde bajarla a mano.
 */
async function checkForUpdatesManually(mainWindow) {
  send(mainWindow, { status: 'checking' });
  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    const latestVersion = String(data.tag_name || '').replace(/^v/, '');
    const currentVersion = app.getVersion();
    if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
      send(mainWindow, { status: 'manual', version: latestVersion, url: data.html_url });
    } else {
      send(mainWindow, { status: 'not-available' });
    }
  } catch (err) {
    send(mainWindow, { status: 'error', message: err?.message || String(err) });
  }
}

function setupAutoUpdater(mainWindow, { isDev }) {
  // Los handlers IPC se registran siempre (para que un click en "Buscar
  // actualizaciones" desde Ajustes no explote con "no handler registered"
  // si por lo que sea se ejecuta en dev), pero en dev no hacen nada real:
  // electron-updater tira error "app not packed" a propósito si se llama a
  // checkForUpdates() sobre una app no empaquetada.
  ipcMain.handle('updater:check', () => {
    if (isDev) {
      send(mainWindow, { status: 'not-available' });
      return;
    }
    if (isLinuxNonAppImage()) return checkForUpdatesManually(mainWindow);
    return autoUpdater.checkForUpdates().catch((err) => {
      send(mainWindow, { status: 'error', message: err?.message || String(err) });
    });
  });

  ipcMain.handle('updater:install', () => {
    if (!isDev) autoUpdater.quitAndInstall();
  });

  if (isDev) return;

  const checkOnce = () =>
    isLinuxNonAppImage() ? checkForUpdatesManually(mainWindow) : autoUpdater.checkForUpdates().catch(() => {});

  if (isLinuxNonAppImage()) {
    // Sin AppImageUpdater disponible: solo se puede avisar, nunca
    // descargar/instalar solo. Se salta toda la configuración de
    // autoUpdater de acá para abajo (autoDownload, listeners de progreso,
    // etc.) porque no aplica a este caso.
    setTimeout(checkOnce, 8000);
    setInterval(checkOnce, 4 * 60 * 60 * 1000);
    return;
  }

  // No queremos que autoUpdater instale sin avisar ni que trabe el arranque
  // esperando la respuesta del server: se pide explícitamente en cada paso.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    send(mainWindow, { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    send(mainWindow, { status: 'available', version: info.version });
    autoUpdater.downloadUpdate();
  });

  autoUpdater.on('update-not-available', () => {
    send(mainWindow, { status: 'not-available' });
  });

  autoUpdater.on('error', (err) => {
    send(mainWindow, { status: 'error', message: err?.message || String(err) });
  });

  autoUpdater.on('download-progress', (progress) => {
    send(mainWindow, {
      status: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    send(mainWindow, { status: 'ready', version: info.version });
  });

  // Chequeo silencioso al arrancar (con un pequeño delay para no competir
  // por ancho de banda/CPU con todo lo que ya está cargando el launcher en
  // ese momento) y cada 4 horas mientras la app sigue abierta.
  setTimeout(checkOnce, 8000);
  setInterval(checkOnce, 4 * 60 * 60 * 1000);
}

module.exports = { setupAutoUpdater };
