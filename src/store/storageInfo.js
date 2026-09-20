const fs = require('fs');
const path = require('path');
const { shell, app } = require('electron');
const versionManager = require('../core/versionManager');
const instanceStore = require('./instanceStore');

/** Calcula el tamaño total (bytes) de una carpeta, recorriéndola recursivamente. */
function folderSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* archivo removido entre el listado y el stat, se ignora */
        }
      }
    }
  }
  return total;
}

/** Resumen de uso de disco: instancias, versiones/librerías/assets descargados, runtimes de Java. */
function getStorageInfo() {
  const gameRoot = versionManager.getGameRoot();
  const instancesRoot = instanceStore.getInstancesRoot();
  const runtimesRoot = path.join(app.getPath('userData'), 'runtimes');

  return {
    instances: { path: instancesRoot, bytes: folderSize(instancesRoot) },
    gameFiles: { path: gameRoot, bytes: folderSize(gameRoot) },
    javaRuntimes: { path: runtimesRoot, bytes: folderSize(runtimesRoot) },
  };
}

function openFolder(folderPath) {
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  return shell.openPath(folderPath);
}

module.exports = { getStorageInfo, openFolder };
