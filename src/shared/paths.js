const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Carpeta interna donde vive todo lo que el launcher necesita para
 * funcionar pero que a alguien curioseando su carpeta de datos (la que
 * abre "Explorar carpeta del launcher" o similar) no le sirve de nada
 * ver ni tocar a mano: configuración, cuentas (con sus tokens), la base
 * de datos de instancias y el marcador de crash/sesión.
 *
 * Sacar todo esto de la raíz deja ahí solo lo que sí tiene sentido que
 * alguien abra directamente: instances/ (para entrar a una modpack
 * puntual, ver sus mundos, etc.), game/ y runtimes/ (cachés que se
 * pueden borrar y se vuelven a descargar solas si hace falta).
 */
function getConfigDir() {
  return ensureDir(path.join(app.getPath('userData'), 'config'));
}

// Nombres reservados en Windows que no pueden usarse como nombre de
// archivo/carpeta (con o sin extensión): CON, PRN, AUX, NUL, COM1-9, LPT1-9.
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Convierte el nombre "lindo" de una instancia (el que el jugador ve y
 * elige, ej. "SkyFactory 4 ⚡") en un nombre de carpeta válido en
 * Windows/macOS/Linux por igual: sin caracteres prohibidos (\/:*?"<>|),
 * sin espacios/puntos colgando al final, sin nombres reservados de
 * Windows, y con un largo razonable (para no chocar con el límite de
 * ruta total en Windows una vez metida adentro de mods/resourcepacks/etc).
 *
 * Si después de sanitizar no queda nada usable (nombre vacío, todo
 * emojis, etc.) cae a "instancia" — nunca a la carpeta sin nombre.
 */
function sanitizeFolderName(rawName) {
  const fallback = 'instancia';
  if (!rawName || typeof rawName !== 'string') return fallback;

  let name = rawName
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ') // caracteres prohibidos en Windows
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, ''); // Windows no permite terminar en espacio o punto

  if (name.length > 60) name = name.slice(0, 60).trim();
  if (!name || WINDOWS_RESERVED_NAMES.test(name)) return fallback;
  return name;
}

/**
 * Arma una carpeta de instancia distinguible a simple vista: el nombre
 * sanitizado y, si ya existe una carpeta con ese nombre (dos instancias
 * con el mismo nombre, o "Copia de X"), un sufijo numerado — igual que
 * hace el explorador de archivos con "archivo (2).txt". Devuelve la ruta
 * completa, ya reservada (no hace falta volver a chequear colisión).
 */
function uniqueInstanceDir(instancesRoot, desiredName) {
  const base = sanitizeFolderName(desiredName);
  let candidate = base;
  let suffix = 1;
  while (fs.existsSync(path.join(instancesRoot, candidate))) {
    suffix += 1;
    candidate = `${base} (${suffix})`;
  }
  return path.join(instancesRoot, candidate);
}

module.exports = { getConfigDir, ensureDir, sanitizeFolderName, uniqueInstanceDir };
