const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { app } = require('electron');
const { downloadFile, downloadQueue } = require('./versionManager');
const settingsStore = require('../store/settingsStore');

// Mojang publica los runtimes de Java (Adoptium/Temurin embebido) en este manifest.
const RUNTIME_MANIFEST_URL =
  'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

/**
 * Cada versión de Minecraft indica en su JSON de versión qué "javaVersion.component"
 * necesita, por ejemplo: 'jre-legacy' (<=1.16), 'java-runtime-alpha' (1.17),
 * 'java-runtime-gamma' (1.18+). Este mapa asocia el componente a la carpeta local.
 */
function componentForVersion(versionDetails) {
  return versionDetails.javaVersion?.component || 'jre-legacy';
}

function platformKey() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === 'win32') return arch === 'x64' ? 'windows-x64' : 'windows-x86';
  if (plat === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return arch === 'arm64' ? 'linux-arm64' : 'linux';
}

function getRuntimesRoot() {
  const root = path.join(app.getPath('userData'), 'runtimes');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Descarga (si hace falta) el runtime de Java correcto para la versión de MC
 * y devuelve la ruta absoluta al ejecutable `java`/`javaw`.
 *
 * `instanceJavaPath` es la instalación de Java propia de una instancia
 * puntual (pestaña "Java y memoria" → "Custom Java installation"), y tiene
 * prioridad sobre el override global de Ajustes si está presente.
 */
async function ensureJavaForVersion(versionDetails, onProgress, instanceJavaPath) {
  if (instanceJavaPath && fs.existsSync(instanceJavaPath)) return instanceJavaPath;

  const override = settingsStore.getSettings().javaPathOverride;
  if (override && fs.existsSync(override)) return override;

  const component = componentForVersion(versionDetails);
  const runtimeDir = path.join(getRuntimesRoot(), component);
  const javaBin = process.platform === 'win32' ? 'javaw.exe' : 'java';
  const existing = findJavaExecutable(runtimeDir, javaBin);
  if (existing) return existing;

  const { data: manifest } = await axios.get(RUNTIME_MANIFEST_URL);
  const platformEntries = manifest[platformKey()];
  const entry = platformEntries?.[component]?.[0];
  if (!entry) {
    throw new Error(`No se encontró runtime Java para el componente "${component}" en esta plataforma.`);
  }

  const { data: fileList } = await axios.get(entry.manifest.url);
  const fileEntries = Object.entries(fileList.files).filter(([, meta]) => meta.type === 'file');

  await downloadQueue(
    fileEntries,
    async ([relPath, meta]) => {
      const dest = path.join(runtimeDir, relPath);
      await downloadFile(meta.downloads.raw.url, dest, meta.downloads.raw.sha1);
      if (meta.executable) fs.chmodSync(dest, 0o755);
    },
    12,
    ({ completed, total }) => onProgress?.({ stage: 'java-runtime', completed, total })
  );

  const finalPath = findJavaExecutable(runtimeDir, javaBin);
  if (!finalPath) throw new Error('La descarga del runtime de Java se completó pero no se encontró el ejecutable.');
  return finalPath;
}

function findJavaExecutable(dir, binName) {
  if (!fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === binName) return full;
    }
  }
  return null;
}

module.exports = { ensureJavaForVersion, platformKey };
