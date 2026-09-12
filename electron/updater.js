const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');

// ---------- Auto-actualización (electron-updater + GitHub Releases) ----------
//
// Cómo funciona en la práctica:
// 1. Cada vez que se publica una versión nueva con `npm run release` (ver
//    package.json), electron-builder sube el instalador .exe MÁS los
//    archivos de metadata (latest.yml, *.blockmap) a un Release de GitHub.
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
// IMPORTANTE: esto NO hace nada en `npm run dev`/`npm start` (electron-updater
// tira error "app not packed" a propósito) — solo funciona sobre el .exe
// instalado de verdad. Para probarlo en desarrollo hay que generar un build
// real con `npm run build` e instalarlo.

function send(mainWindow, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:event', payload);
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
    return autoUpdater.checkForUpdates().catch((err) => {
      send(mainWindow, { status: 'error', message: err?.message || String(err) });
    });
  });

  ipcMain.handle('updater:install', () => {
    if (!isDev) autoUpdater.quitAndInstall();
  });

  if (isDev) return;

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
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

module.exports = { setupAutoUpdater };
